import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'; // supplied by the repository's pinned Wrangler
import { random, digest } from '../server/crypto.js';

test('workerd + real local D1: OAuth, replay, isolation, refresh lease, redirect refusal and native limits', async t => {
  const config = JSON.parse(await readFile('server/wrangler.jsonc', 'utf8'));
  const origin = config.vars.PUBLIC_ORIGIN;
  let calls = 0, mode = '', release, entered;
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: ['server/worker.js', 'server/crypto.js'].map(path => ({ type: 'ESModule', path })), compatibilityDate: config.compatibility_date,
    bindings: { ...config.vars, ENCRYPTION_KEY: random(), GOOGLE_CLIENT_SECRET: 'LOCAL-TEST-ONLY' },
    d1Databases: ['DB'], ratelimits: Object.fromEntries(config.ratelimits.map(({ name, ...v }) => [name, v])),
    outboundService: async request => {
      calls++;
      const url = new URL(request.url);
      if (url.hostname === 'oauth2.googleapis.com') {
        if (mode === 'gate') { entered?.(); await new Promise(resolve => { release = resolve; }); }
        if (mode === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://unexpected.test/steal' } });
        return Response.json({ access_token: 'local-access-' + calls, refresh_token: 'local-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' });
      }
      assert.equal(url.hostname, 'www.googleapis.com', 'credentials never reach an unexpected host');
      return Response.json({ user: { permissionId: 'owner', displayName: 'Local test' } });
    },
  }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const schema = await readFile('server/migrations/0001_sessions.sql', 'utf8');
  for (const sql of schema.split(';').filter(s => s.trim())) await db.prepare(sql).run();
  const req = (path, { method = 'GET', body, headers = {} } = {}) => mf.dispatchFetch(origin + path, {
    method, headers: { Origin: config.vars.APP_ORIGIN, 'CF-Connecting-IP': '192.0.2.1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual',
  });
  const verifier = random();
  const begun = await req('/v1/authorizations', { method: 'POST', body: { challenge: await digest(verifier), accountId: 'owner' } });
  assert.equal(begun.status, 200);
  const flow = await begun.json();
  const launched = await req('/oauth/launch?state=' + flow.id + '&ticket=' + flow.launchTicket);
  assert.equal(launched.status, 303);
  const cookie = launched.headers.get('Set-Cookie').split(';')[0];
  const next = await req('/oauth/continue?state=' + flow.id, { headers: { Cookie: cookie } });
  assert.equal(new URL(next.headers.get('Location')).hostname, 'accounts.google.com');
  const cb = '/oauth/callback?state=' + flow.id + '&code=local-code&iss=https%3A%2F%2Faccounts.google.com';
  await req(cb); assert.equal(calls, 0);
  assert.match(await (await req(cb, { headers: { Cookie: cookie } })).text(), /Conexión lista/);
  assert.equal(calls, 2);
  await req(cb, { headers: { Cookie: cookie } }); assert.equal(calls, 2);
  assert.equal((await req('/v1/authorizations/' + flow.id, { headers: { 'X-Guarda-Verification': random() } })).status, 401);
  const result = await (await req('/v1/authorizations/' + flow.id, { headers: { 'X-Guarda-Verification': verifier } })).json();
  const headers = { Authorization: 'Bearer ' + result.session };
  assert.equal((await req('/v1/access-token', { method: 'POST', headers, body: { accountId: 'other' } })).status, 409);
  const access = await req('/v1/access-token', { method: 'POST', headers, body: {} });
  assert.equal(access.status, 200); const oldHash = await digest((await access.json()).accessToken);
  mode = 'redirect';
  assert.equal((await req('/v1/access-token', { method: 'POST', headers, body: { force: true } })).status, 503);
  assert.equal(calls, 3, 'manual redirects do not follow or forward credentials');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM sessions').first()).n, 1);
  mode = 'gate'; const gate = new Promise(resolve => { entered = resolve; });
  const first = req('/v1/access-token', { method: 'POST', headers, body: { force: true } });
  await gate;
  const second = await req('/v1/access-token', { method: 'POST', headers, body: { force: true } });
  assert.equal(second.status, 503); assert.equal(second.headers.get('Retry-After'), '3');
  mode = ''; release(); assert.equal((await first).status, 200);
  const count = calls;
  assert.equal((await req('/v1/access-token', { method: 'POST', headers, body: { force: true, rejectedTokenHash: oldHash } })).status, 200);
  assert.equal(calls, count, 'a fresh token is reused across tabs');
  assert.equal((await req('/v1/session', { method: 'DELETE', headers })).status, 200);
  assert.equal((await req('/v1/access-token', { method: 'POST', headers, body: {} })).status, 401);
  for (let i = 0; i < 20; i++) assert.equal((await req('/v1/authorizations', { method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.2' }, body: { challenge: await digest(random()) } })).status, 200);
  const blocked = await req('/v1/authorizations', { method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.2' }, body: { challenge: await digest(random()) } });
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM rate_limits').first()).n, 0);
});
