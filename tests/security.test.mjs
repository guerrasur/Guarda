import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { brokerFixture } from './helpers/drive-broker.mjs';
import { random, digest } from '../server/crypto.js';
import { retryAfterMs, retryDelay, readBackupResponse, MAX_BACKUP_BYTES } from '../src/retry.js';

test('all routes reject malformed requests before D1, including spoofed allowed Origins', async t => {
  const f = await brokerFixture(t); let queries = 0;
  const prepare = f.env.DB.prepare; f.env.DB.prepare = sql => { queries++; return prepare(sql); };
  for (const [path, options, status] of [
    ['/v1/access-token', { method: 'PUT' }, 405],
    ['/v1/authorizations', { method: 'POST', body: { challenge: random(), extra: true } }, 400],
    ['/v1/access-token', { method: 'POST', session: random(), body: { force: 'yes' } }, 400],
    ['/v1/config?secret=x', {}, 400],
    ['/oauth/callback?state=' + random(), {}, 400],
    ['/oauth/callback?state=' + random() + '&state=' + random(), {}, 400],
    ['/v1/authorizations/' + random(), {}, 401],
    ['/v1/session', { method: 'DELETE' }, 401],
    ['/v1/authorizations', { method: 'POST', body: { challenge: 'a'.repeat(3000) } }, 413],
  ]) assert.equal((await f.request(path, options)).status, status, path);
  assert.equal(queries, 0);
});
test('maintenance stops D1 access; pausing new connections still allows existing sessions', async t => {
  const f = await brokerFixture(t), session = (await f.authorize()).session;
  f.env.DRIVE_NEW_CONNECTIONS = 'paused';
  assert.equal((await f.begin()).status, 503);
  assert.equal((await f.request('/v1/access-token', { method: 'POST', session, body: {} })).status, 200);
  const prepare = f.env.DB.prepare;
  f.env.DB.prepare = () => { throw Error('D1 must not be accessed in maintenance'); };
  f.env.DRIVE_MAINTENANCE = '1';
  for (const path of ['/v1/config', '/oauth/callback?state=' + random() + '&code=x']) {
    const r = await f.request(path); assert.equal(r.status, 503); assert.equal(r.headers.get('Retry-After'), '300');
    assert.equal((await r.json()).error.code, 'DRIVE_MAINTENANCE');
  }
  f.env.DRIVE_MAINTENANCE = '0'; f.env.DB.prepare = prepare;
  assert.equal((await f.request('/v1/access-token', { method: 'POST', session, body: {} })).status, 200);
});
test('native admission limits perform no security writes; one session cannot exhaust another session allowance', async t => {
  const f = await brokerFixture(t), a = await f.authorize(), b = await f.authorize();
  for (let i = 0; i < 29; i++) assert.equal((await f.request('/v1/access-token', { method: 'POST', session: a.session, body: {} })).status, 200);
  const blocked = await f.request('/v1/access-token', { method: 'POST', session: a.session, body: {} });
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal((await f.request('/v1/access-token', { method: 'POST', session: b.session, body: {} })).status, 200);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM rate_limits').get().n, 0);
  f.advance(61000);
  assert.equal((await f.request('/v1/access-token', { method: 'POST', session: a.session, body: {} })).status, 200);
});
test('legacy start is one-use and forced refresh of an already replaced token reuses the latest token', async t => {
  const f = await brokerFixture(t), flow = await f.begin();
  const start = await f.start(flow); assert.equal(start.status, 303);
  assert.equal((await f.start(flow)).status, 401);
  await f.callback(flow, start.headers.get('Set-Cookie').split(';')[0]);
  const { session } = await (await f.poll(flow)).json();
  const first = await (await f.request('/v1/access-token', { method: 'POST', session, body: {} })).json();
  const body = { force: true, rejectedTokenHash: await digest(first.accessToken) };
  const next = await (await f.request('/v1/access-token', { method: 'POST', session, body })).json();
  f.advance(61000); const calls = f.calls.length;
  const repeated = await (await f.request('/v1/access-token', { method: 'POST', session, body })).json();
  assert.equal(repeated.accessToken, next.accessToken); assert.equal(calls, f.calls.length);
});
test('D1 outages open a bounded in-memory circuit and recover without deleting grants', async t => {
  const f = await brokerFixture(t), { session } = await f.authorize(), prepare = f.env.DB.prepare;
  let attempts = 0; f.env.DB.prepare = () => { attempts++; throw Error('D1_ERROR: daily quota exceeded private SQL'); };
  const call = () => f.request('/v1/access-token', { method: 'POST', session, body: {} });
  const response = await call(); assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'DRIVE_QUOTA');
  await call(); assert.equal(attempts, 1);
  f.env.DB.prepare = prepare; f.advance(900001);
  assert.equal((await call()).status, 200); assert.equal(f.sql.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
});
test('missing limit bindings fail closed without falling back to D1 counters', async t => {
  const f = await brokerFixture(t); delete f.env.IP_LIMIT;
  assert.equal((await f.begin()).status, 503);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM authorizations').get().n, 0);
});
test('Retry-After supports dates and jitter never shortens a server deadline', () => {
  assert.equal(retryAfterMs('120'), 120000);
  assert.equal(retryAfterMs('Thu, 22 Oct 2026 12:02:00 GMT', Date.parse('2026-10-22T12:00:00Z')), 120000);
  assert.equal(retryAfterMs('bad'), 0);
  assert.equal(retryDelay(2, 900000, () => 0.5), 900750);
});
test('backup streams reject oversized metadata before allocation and parse ordinary backups', async () => {
  await assert.rejects(readBackupResponse(new Response('{}', { headers: { 'Content-Length': MAX_BACKUP_BYTES + 1 } })), /200 MB/);
  assert.deepEqual(await readBackupResponse(Response.json({ notes: [] })), { notes: [] });
});
test('Pages CSP permits only the exact bootstrap script and ships retry code offline', async () => {
  const html = await readFile('index.html', 'utf8'), inline = html.match(/<script>(.*?)<\/script>/s)[1];
  const hash = createHash('sha256').update(inline).digest('base64');
  assert.ok(html.includes("'sha256-" + hash + "'"));
  assert.match(html, /object-src 'none'; base-uri 'none'/);
  assert.doesNotMatch(html.match(/script-src ([^;]+)/)[1], /unsafe-inline|unsafe-eval/);
  assert.match(await readFile('sw.js', 'utf8'), /src\/retry.js/);
});
