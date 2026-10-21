import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { PersistentDriveClient } from '../src/drive-persistent.js';
import { GOOGLE_CLIENT_ID } from '../src/drive-config.js';
import { brokerFixture } from './helpers/drive-broker.mjs';

async function fixture(t, saved = true) {
  const broker = await brokerFixture(t), values = new Map(), calls = [], popups = [], forms = [];
  const { document } = parseHTML('<html><body></body></html>');
  const store = { getSetting: async (key, fallback) => values.has(key) ? values.get(key) : fallback, setSetting: async (key, value) => { values.set(key, value); } };
  const env = {
    crypto, AbortController, document, navigator: { onLine: true }, clearTimeout,
    setTimeout: (fn, ms) => setTimeout(fn, ms === 1500 || ms === 5000 ? 0 : ms),
    open(url, name) { const popup = { closed: false, document: {}, close() { this.closed = true; }, name }; popups.push(popup); return popup; },
    async fetch(url, options) {
      calls.push({ url, options });
      if (url.startsWith(broker.env.PUBLIC_ORIGIN)) return broker.worker.fetch(new Request(url, { ...options, headers: { ...options.headers, Origin: broker.env.APP_ORIGIN } }), broker.env);
      if (url.startsWith('https://www.googleapis.com/drive/v3/')) return Response.json({ files: [] });
      throw Error('Unexpected browser request: ' + url);
    },
  };
  let formWork;
  const createElement = document.createElement.bind(document);
  document.createElement = name => {
    const element = createElement(name);
    if (name === 'form') element.submit = () => {
      forms.push(element);
      const flow = Object.fromEntries([...element.querySelectorAll('input')].map(input => [input.name, input.value]));
      formWork = (async () => {
        const start = await broker.start({ id: flow.id, verifier: flow.verification });
        await broker.callback({ id: flow.id }, start.headers.get('Set-Cookie').split(';')[0]);
        popups.at(-1).closed = true;
      })();
    };
    return element;
  };
  const makeClient = () => new PersistentDriveClient({ store, brokerUrl: broker.env.PUBLIC_ORIGIN, env });
  if (saved) {
    const data = await broker.authorize();
    values.set('drive-broker-session', { broker: broker.env.PUBLIC_ORIGIN, clientId: GOOGLE_CLIENT_ID, session: data.session, accountId: 'owner' });
  }
  return { broker, env, document, store, calls, popups, forms, values, makeClient, formWork: () => formWork, client: makeClient() };
}
test('a fresh page restores durable authorization, renews expired access and sends notes directly to Google', async t => {
  const f = await fixture(t); assert.equal(f.client.token, null);
  assert.equal(await f.client.resumeSession({ accountId: 'owner' }), true); assert.equal(f.popups.length, 0);
  assert.deepEqual(await f.client.listSnapshots(), []);
  const page = f.makeClient(); f.broker.advance(3600000);
  assert.equal(await page.resumeSession({ accountId: 'owner' }), true); assert.equal(page.token, 'google-access-2'); assert.equal(f.popups.length, 0);
  const snapshot = JSON.stringify([...f.values]); assert.doesNotMatch(snapshot, /google-access|google-refresh/);
  for (const call of f.calls) assert.equal(call.options.credentials === 'include', false);
  assert.ok(f.calls.some(call => call.url.startsWith('https://www.googleapis.com/drive/v3/files?')));
});
test('one authorization from a click establishes a durable session without persisting Google tokens', async t => {
  const f = await fixture(t, false); await f.client.prepare(GOOGLE_CLIENT_ID);
  const connecting = f.client.connect({ accountId: 'owner' }); assert.equal(f.popups.length, 1, 'window opens synchronously');
  const user = await connecting; await f.formWork(); assert.equal(user.permissionId, 'owner');
  assert.equal(f.forms[0].method, 'POST'); assert.equal(f.forms[0].action, f.broker.env.PUBLIC_ORIGIN + '/oauth/start'); assert.equal(f.popups[0].opener, null);
  assert.equal(f.client.pending, null); assert.equal(f.popups[0].closed, true);
  assert.equal(await f.makeClient().resumeSession({ accountId: 'owner' }), true);
  assert.doesNotMatch(JSON.stringify([...f.values]), /google-access|google-refresh/);
});
test('a stale pending poll arriving after the callback closes the popup still completes authorization', async t => {
  const f = await fixture(t, false), callback = f.broker.callback, fetcher = f.env.fetch;
  let releaseCallback;
  const gate = new Promise(resolve => { releaseCallback = resolve; });
  f.broker.callback = async (...args) => { await gate; return callback(...args); };
  let stalePending = false;
  f.env.fetch = async (url, options) => {
    const response = await fetcher(url, options);
    if (!stalePending && url.includes('/v1/authorizations/') && (await response.clone().json()).pending) {
      stalePending = true; releaseCallback(); await f.formWork();
      assert.equal(f.popups[0].closed, true);
    }
    return response;
  };
  await f.client.prepare(GOOGLE_CLIENT_ID);
  const user = await f.client.connect({ accountId: 'owner' });
  assert.equal(stalePending, true); assert.equal(user.permissionId, 'owner');
  assert.equal(await f.makeClient().resumeSession({ accountId: 'owner' }), true);
});
test('blocked popups do not start authorization and cannot leave a stuck pending state', async t => {
  const f = await fixture(t, false); f.env.open = () => null;
  await assert.rejects(f.client.connect(), cause => cause.code === 'DRIVE_INTERACTION'); assert.equal(f.client.pending, null); assert.equal(f.calls.length, 0);
});
test('network loss retains the durable session; revoked permission requires authorization only once', async t => {
  const f = await fixture(t), fetcher = f.env.fetch;
  f.env.fetch = async () => { throw new DOMException('Timeout', 'AbortError'); };
  await assert.rejects(f.client.resumeSession({ accountId: 'owner' }), cause => cause.code === 'DRIVE_RETRYABLE'); assert.ok(f.values.get('drive-broker-session'));
  f.env.fetch = fetcher; f.broker.advance(3600000); f.broker.mode('temporary');
  await assert.rejects(f.client.resumeSession({ accountId: 'owner' }), cause => cause.code === 'DRIVE_RETRYABLE'); assert.ok(f.values.get('drive-broker-session'));
  f.broker.mode(''); await f.client.resumeSession({ accountId: 'owner' }); assert.equal(f.popups.length, 0);
  f.client.expires = 0; f.broker.advance(3600000); f.broker.mode('invalid_grant');
  await assert.rejects(f.client.resumeSession({ accountId: 'owner' }), cause => cause.code === 'DRIVE_AUTH'); assert.equal(f.values.get('drive-broker-session'), null);
  assert.equal(await f.client.resumeSession({ accountId: 'owner' }), false); assert.equal(f.popups.length, 0);
});
test('wrong bound accounts and credentials from a different broker never reach Drive', async t => {
  const f = await fixture(t);
  await assert.rejects(f.client.resumeSession({ accountId: 'different' }), cause => cause.code === 'DRIVE_ACCOUNT'); assert.equal(f.calls.length, 0);
  f.values.get('drive-broker-session').broker = 'https://another.test';
  assert.equal(await f.client.resumeSession({ accountId: 'owner' }), false); assert.equal(f.calls.length, 0);
});
test('concurrent Drive operations share renewal, and a real Google 401 triggers one automatic retry', async t => {
  const f = await fixture(t); f.broker.advance(3600000);
  await Promise.all([f.client.listSnapshots(), f.client.listSnapshots()]);
  assert.equal(f.calls.filter(call => call.url.endsWith('/v1/access-token')).length, 1);
  const original = f.env.fetch; let rejected = false;
  f.env.fetch = async (url, options) => {
    if (!rejected && url.startsWith('https://www.googleapis.com/')) { rejected = true; return Response.json({}, { status: 401 }); }
    return original(url, options);
  };
  await f.client.listSnapshots(); assert.equal(f.client.connected, true); assert.equal(f.popups.length, 0); assert.equal(f.client.token, 'google-access-3');
});
test('offline disconnect immediately disables every local tab and later revokes the server session', async t => {
  const f = await fixture(t); await f.client.resumeSession({ accountId: 'owner' });
  const tab = f.makeClient(); await tab.resumeSession({ accountId: 'owner' });
  const saved = structuredClone(f.values.get('drive-broker-session')); f.env.navigator.onLine = false; await f.client.disconnect();
  assert.equal(f.client.connected, false); assert.equal(f.values.get('drive-broker-session'), null); assert.equal(f.values.get('drive-broker-revocations').length, 1);
  const count = f.calls.length; await assert.rejects(tab.listSnapshots(), cause => cause.code === 'DRIVE_AUTH'); assert.equal(f.calls.length, count);
  f.env.navigator.onLine = true; await f.makeClient().flushRevocations(); assert.equal(f.values.get('drive-broker-revocations').length, 0);
  assert.equal((await f.broker.request('/v1/access-token', { method: 'POST', body: {}, session: saved.session })).status, 401);
});
test('a late token response after disconnect cannot revive the client or recreate its durable session', async t => {
  const f = await fixture(t), original = f.env.fetch; let release;
  f.env.fetch = async (url, options) => { const response = await original(url, options); if (url.endsWith('/v1/access-token')) await new Promise(resolve => { release = resolve; }); return response; };
  const connecting = f.client.resumeSession({ accountId: 'owner' });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await f.client.disconnect(); release(); await assert.rejects(connecting, cause => ['DRIVE_AUTH', 'DRIVE_RETRYABLE'].includes(cause.code));
  assert.equal(f.client.connected, false); assert.equal(f.values.get('drive-broker-session'), null);
});
test('a broker cannot switch the account of an existing set of notes', async t => {
  const f = await fixture(t), original = f.env.fetch;
  f.env.fetch = async (url, options) => url.endsWith('/v1/access-token') ? Response.json({ accessToken: 'wrong-account', expires: Date.now() + 3600000, user: { permissionId: 'another' } }) : original(url, options);
  await assert.rejects(f.client.listSnapshots(), cause => cause.code === 'DRIVE_ACCOUNT');
  assert.equal(f.client.connected, false); assert.equal(f.client.token, null); assert.equal(f.popups.length, 0);
});
