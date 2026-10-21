import test from 'node:test';
import assert from 'node:assert/strict';
import { brokerFixture } from './helpers/drive-broker.mjs';
import { seal, unseal, random, digest } from '../server/crypto.js';

test('grant encryption authenticates both the record and the ciphertext', async () => {
  const key = random(), encrypted = await seal({ refreshToken: 'secret' }, key, 'session:one');
  assert.doesNotMatch(encrypted, /secret/); assert.deepEqual(await unseal(encrypted, key, 'session:one'), { refreshToken: 'secret' });
  await assert.rejects(unseal(encrypted, key, 'session:two'));
  await assert.rejects(unseal(encrypted, random(), 'session:one'));
});
test('OAuth uses offline access, PKCE, a first-party callback cookie and proof-protected delivery', async t => {
  const f = await brokerFixture(t), flow = await f.begin(), start = await f.start(flow);
  assert.equal(start.status, 303); const url = new URL(start.headers.get('Location'));
  assert.equal(url.origin, 'https://accounts.google.com'); assert.equal(url.searchParams.get('state'), flow.id);
  assert.equal(url.searchParams.get('access_type'), 'offline'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.match(start.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
  await f.callback(flow); assert.equal(f.calls.length, 0, 'a forwarded Google link cannot grant the initiating attacker access');
  const response = await f.callback(flow, start.headers.get('Set-Cookie').split(';')[0]); assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /google-access-|google-refresh-|google-one-use-code/);
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
  const wrong = await f.poll({ ...flow, verifier: random() }); assert.equal(wrong.status, 401);
  const delivery = await f.poll(flow), data = await delivery.json(); assert.match(data.session, /^[\w-]{43}$/); assert.equal(data.user.permissionId, 'owner');
  assert.doesNotMatch(JSON.stringify(data), /google-access|google-refresh|test-only-client-secret/);
  const row = f.sql.prepare('SELECT * FROM sessions').get(); assert.equal(row.token_hash, await digest(data.session));
  assert.doesNotMatch(JSON.stringify(row), /google-access|google-refresh|example.test/);
  const exchanges = f.calls.length; await f.callback(flow, start.headers.get('Set-Cookie').split(';')[0]); assert.equal(f.calls.length, exchanges);
  assert.equal(delivery.headers.get('Cache-Control'), 'no-store'); assert.equal(delivery.headers.get('Access-Control-Allow-Credentials'), null);
});
test('cross-site start, unknown sessions, oversized requests and unconfigured services fail closed', async t => {
  const f = await brokerFixture(t), flow = await f.begin();
  const hostile = await f.start(flow, 'https://attacker.test'); assert.equal(hostile.status, 403); assert.equal(hostile.headers.get('Access-Control-Allow-Origin'), null); assert.equal(hostile.headers.get('Set-Cookie'), null);
  assert.equal((await f.request('/v1/access-token', { method: 'POST', body: {}, session: random() })).status, 401);
  assert.equal((await f.request('/v1/authorizations', { method: 'POST', body: { challenge: 'x'.repeat(4000) } })).status, 413);
  const preflight = await f.request('/v1/access-token', { method: 'OPTIONS' }); assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), f.env.APP_ORIGIN);
  const missing = { ...f.env, GOOGLE_CLIENT_SECRET: '' }; const response = await f.worker.fetch(new Request(f.env.PUBLIC_ORIGIN + '/v1/config', { headers: { Origin: f.env.APP_ORIGIN } }), missing);
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret|Missing configuration/);
});
test('expired access renews automatically, rotates refresh tokens and keeps Google tokens off the browser disk', async t => {
  const f = await brokerFixture(t), data = await f.authorize();
  const initial = await (await f.request('/v1/access-token', { method: 'POST', body: { accountId: 'owner' }, session: data.session })).json(); assert.equal(initial.accessToken, 'google-access-1');
  f.advance(3600000);
  const renewed = await f.request('/v1/access-token', { method: 'POST', body: { accountId: 'owner' }, session: data.session }); assert.equal(renewed.status, 200); assert.equal((await renewed.json()).accessToken, 'google-access-2');
  const refresh = f.calls.find(call => new URLSearchParams(call.options.body).get('grant_type') === 'refresh_token');
  assert.equal(new URLSearchParams(refresh.options.body).get('refresh_token'), 'google-refresh-1');
  const row = f.sql.prepare('SELECT * FROM sessions').get(); assert.equal((await unseal(row.payload, f.env.ENCRYPTION_KEY, 'session:' + row.token_hash)).refreshToken, 'google-refresh-2');
  const calls = f.calls.length; assert.equal((await f.request('/v1/access-token', { method: 'POST', body: { accountId: 'other' }, session: data.session })).status, 409); assert.equal(f.calls.length, calls);
});
test('temporary failures preserve grants; genuine revocation removes only the affected session', async t => {
  const f = await brokerFixture(t), a = await f.authorize(), b = await f.authorize(); f.advance(3600000);
  for (const mode of ['temporary', 'network', 'invalid_client']) {
    f.mode(mode); const response = await f.request('/v1/access-token', { method: 'POST', body: {}, session: a.session });
    assert.equal(response.status, 503, mode); assert.equal(f.sql.prepare('SELECT count(*) AS n FROM sessions').get().n, 2);
  }
  f.mode('invalid_grant'); assert.equal((await f.request('/v1/access-token', { method: 'POST', body: {}, session: a.session })).status, 401);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
  f.mode(''); assert.equal((await f.request('/v1/access-token', { method: 'POST', body: {}, session: b.session })).status, 200);
});
test('account mismatch and missing offline permission never create a usable session', async t => {
  const f = await brokerFixture(t); f.owner('different');
  const mismatch = await f.authorize(); assert.equal(mismatch.error.code, 'DRIVE_ACCOUNT'); assert.equal(f.sql.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  f.owner('owner'); f.mode('no_refresh'); const missing = await f.authorize(); assert.equal(missing.error.code, 'DRIVE_AUTH');
  f.mode('scope'); const scope = await f.authorize(); assert.equal(scope.error.code, 'DRIVE_PERMISSION');
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
});
test('refresh leases serialize tabs and a concurrent disconnect cannot resurrect a session', async t => {
  const f = await brokerFixture(t), data = await f.authorize(); f.advance(3600000);
  let release; f.gate(new Promise(resolve => { release = resolve; }));
  const first = f.request('/v1/access-token', { method: 'POST', body: {}, session: data.session });
  for (let i = 0; i < 50 && f.calls.length < 3; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.request('/v1/access-token', { method: 'POST', body: {}, session: data.session })).status, 503);
  assert.equal((await f.request('/v1/session', { method: 'DELETE', session: data.session })).status, 200);
  release(); assert.equal((await first).status, 401); assert.equal(f.sql.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
});
test('expired authorizations and rate limits are enforced and cleaned without retaining identities', async t => {
  const f = await brokerFixture(t), flow = await f.begin(); f.advance(600001);
  assert.equal((await f.poll(flow)).status, 401);
  for (let i = 0; i < 10; i++) assert.equal((await f.begin()).status, 200);
  assert.equal((await f.begin()).status, 429);
  f.advance(600001); await f.worker.scheduled({}, f.env);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM authorizations').get().n, 0);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM rate_limits').get().n, 0);
});
test('an OAuth result abandoned before first device use cannot retain a renewable grant', async t => {
  const f = await brokerFixture(t), flow = await f.begin(), start = await f.start(flow);
  await f.callback(flow, start.headers.get('Set-Cookie').split(';')[0]);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
  f.advance(600001); await f.worker.scheduled({}, f.env);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
});
