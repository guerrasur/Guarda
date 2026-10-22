import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createWorker } from '../../server/worker.js';
import { random, digest } from '../../server/crypto.js';
import { GOOGLE_CLIENT_ID } from '../../src/drive-config.js';

export async function brokerFixture(t) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  sql.exec(await readFile(new URL('../../server/migrations/0001_sessions.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(query) {
      return { bind(...values) { return { first: async () => sql.prepare(query).get(...values) || null, run: async () => sql.prepare(query).run(...values) }; } };
    },
    async batch(queries) {
      sql.exec('BEGIN');
      try { const result = []; for (const query of queries) result.push(await query.run()); sql.exec('COMMIT'); return result; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  let now = Date.now(), mode = '', owner = 'owner', gate, accessCount = 0;
  const calls = [];
  const env = { DB: db, ENCRYPTION_KEY: random(), GOOGLE_CLIENT_SECRET: 'test-only-client-secret', GOOGLE_CLIENT_ID, APP_ORIGIN: 'https://guerrasur.github.io', PUBLIC_ORIGIN: 'https://guarda-drive.test' };
  const fetcher = async (url, options) => {
    // Match the edge runtime, which rejects redirect:error before network I/O.
    if (!['follow', 'manual'].includes(options.redirect)) throw new TypeError('Invalid redirect value');
    calls.push({ url, options });
    if (url === 'https://oauth2.googleapis.com/token') {
      const parameters = new URLSearchParams(options.body);
      if (parameters.get('grant_type') === 'refresh_token') { if (gate) await gate; }
      if (mode === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://unexpected.example.test/' } });
      if (mode === 'network') throw new TypeError('Offline');
      if (mode === 'invalid_grant') return Response.json({ error: 'invalid_grant' }, { status: 400 });
      if (mode === 'invalid_client') return Response.json({ error: 'invalid_client' }, { status: 401 });
      if (mode === 'temporary') return Response.json({ error: 'temporarily_unavailable' }, { status: 503 });
      return Response.json({ access_token: 'google-access-' + ++accessCount, expires_in: 3600, scope: mode === 'scope' ? 'profile' : 'https://www.googleapis.com/auth/drive.file', ...(mode === 'no_refresh' ? {} : { refresh_token: 'google-refresh-' + accessCount }) });
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/about')) return Response.json({ user: { permissionId: owner, emailAddress: owner + '@example.test', displayName: owner } });
    throw Error('Unexpected Google request: ' + url);
  };
  const worker = createWorker({ fetcher, clock: () => now });
  const request = (path, { method = 'GET', body, origin = env.APP_ORIGIN, headers = {}, session } = {}) => worker.fetch(new Request(env.PUBLIC_ORIGIN + path, { method, headers: { ...(origin ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Authorization: 'Bearer ' + session } : {}), ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }), env);
  async function begin(accountId = 'owner') {
    const verifier = random(), response = await request('/v1/authorizations', { method: 'POST', body: { challenge: await digest(verifier), accountId } });
    const data = await response.json();
    return { ...data, verifier, status: response.status };
  }
  async function start(flow, origin = env.APP_ORIGIN) {
    return request('/oauth/start', { method: 'POST', origin, body: new URLSearchParams({ id: flow.id, verification: flow.verifier }).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  }
  const poll = flow => request('/v1/authorizations/' + flow.id, { headers: { 'X-Guarda-Verification': flow.verifier } });
  const callback = (flow, cookie, extra = '') => request('/oauth/callback?state=' + flow.id + '&code=google-one-use-code' + extra, { origin: null, headers: cookie ? { Cookie: cookie } : {} });
  async function authorize(accountId = 'owner') {
    const flow = await begin(accountId), redirect = await start(flow), cookie = redirect.headers.get('Set-Cookie')?.split(';')[0];
    await callback(flow, cookie); const result = await (await poll(flow)).json();
    if (result.session) await request('/v1/access-token', { method: 'POST', body: { accountId }, session: result.session });
    return { ...result, flow, redirect, cookie };
  }
  return { env, sql, worker, calls, request, begin, start, callback, poll, authorize, advance: ms => { now += ms; }, mode: value => { mode = value; }, owner: value => { owner = value; }, gate: value => { gate = value; } };
}
