import { random, digest, seal, unseal, decode } from './crypto.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TEN_MINUTES = 600000;
const YEAR = 365 * 86400000;
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });
const messages = {
  DRIVE_AUTH: 'Google necesita una nueva autorización. Tus notas siguen guardadas en este dispositivo.',
  DRIVE_ACCOUNT: 'Estas notas pertenecen a otra cuenta. Conectá la cuenta vinculada.',
  DRIVE_RETRYABLE: 'No se pudo renovar la conexión. Guarda volverá a intentarlo automáticamente.',
  DRIVE_PERMISSION: 'Google no concedió el acceso a los archivos de Guarda.',
};
const json = (value, status = 200) => Response.json(value, { status });
const fail = (status, code) => { throw failure(status, code, messages[code] || 'No se pudo completar la conexión.'); };

function configuration(env) {
  const app = new URL(env.APP_ORIGIN), server = new URL(env.PUBLIC_ORIGIN);
  if (app.protocol !== 'https:' || app.origin !== env.APP_ORIGIN || server.protocol !== 'https:' || server.origin !== env.PUBLIC_ORIGIN || !env.DB || !env.GOOGLE_CLIENT_SECRET || !/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID) || decode(env.ENCRYPTION_KEY).length !== 32) throw Error('Missing configuration');
  return { app: app.origin, server: server.origin, callback: server.origin + '/oauth/callback' };
}
async function readText(request, type) {
  if (!request.headers.get('Content-Type')?.startsWith(type)) throw failure(415, 'BAD_REQUEST', 'Solicitud inválida.');
  const reader = request.body?.getReader(); let size = 0, text = ''; const decoder = new TextDecoder();
  if (!reader) throw failure(400, 'BAD_REQUEST', 'Solicitud inválida.');
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 2048) { await reader.cancel(); throw failure(413, 'BAD_REQUEST', 'Solicitud demasiado grande.'); }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
async function body(request) {
  const text = await readText(request, 'application/json');
  try { const result = JSON.parse(text); if (!result || Array.isArray(result) || typeof result !== 'object') throw Error(); return result; }
  catch { throw failure(400, 'BAD_REQUEST', 'Solicitud inválida.'); }
}
async function google(url, options, fetcher) {
  let response;
  try { response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch { fail(503, 'DRIVE_RETRYABLE'); }
  let data; try { data = await response.json(); } catch { fail(503, 'DRIVE_RETRYABLE'); }
  if (!response.ok) {
    // Invalid client/configuration must never erase the user's saved grant.
    if (response.status >= 500 || response.status === 429 || ['invalid_client', 'temporarily_unavailable'].includes(data.error)) fail(503, 'DRIVE_RETRYABLE');
    if (data.error === 'invalid_grant' || response.status === 401) fail(401, 'DRIVE_AUTH');
    fail(403, 'DRIVE_PERMISSION');
  }
  return data;
}
async function exchange(parameters, env, fetcher) {
  const data = await google('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...parameters }).toString() }, fetcher);
  if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) < 60) fail(503, 'DRIVE_RETRYABLE');
  if (data.scope && !data.scope.split(' ').includes(SCOPE)) fail(403, 'DRIVE_PERMISSION');
  return data;
}
async function identity(access, fetcher) {
  const data = await google('https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress,displayName)', { headers: { Authorization: 'Bearer ' + access } }, fetcher);
  if (typeof data.user?.permissionId !== 'string' || !data.user.permissionId) fail(503, 'DRIVE_RETRYABLE');
  const { permissionId, emailAddress, displayName } = data.user;
  return { permissionId, emailAddress, displayName };
}
function callbackPage(success, explanation = '') {
  // Never reflect codes, OAuth errors, identities, or tokens in the page.
  const nonce = random();
  return new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Drive · Guarda</title><style nonce="${nonce}">body{max-width:32em;margin:15vh auto;padding:24px;font:18px/1.6 system-ui;background:#181b18;color:#f5f2e7}</style><h1>${success ? 'Conexión lista' : 'No se completó la conexión'}</h1><p>${success ? 'Podés cerrar esta ventana y volver a Guarda.' : explanation || 'Volvé a Guarda para revisar la conexión. Tus notas están guardadas en tu dispositivo.'}</p><script nonce="${nonce}">history.replaceState(null,'','/oauth/callback');${success ? 'window.close();' : ''}</script></html>`, { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` } });
}
async function begin(request, env, config, now) {
  const input = await body(request);
  if (!/^[\w-]{43}$/.test(input.challenge || '') || (input.accountId != null && (typeof input.accountId !== 'string' || input.accountId.length > 200)) || (input.hint != null && (typeof input.hint !== 'string' || input.hint.length > 254))) throw failure(400, 'BAD_REQUEST', 'Solicitud inválida.');
  const bucket = await digest(env.ENCRYPTION_KEY + ':' + (request.headers.get('CF-Connecting-IP') || 'unknown') + ':' + Math.floor(now / TEN_MINUTES));
  const rate = await env.DB.prepare('INSERT INTO rate_limits(bucket,count,expires) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(bucket, now + TEN_MINUTES).first();
  if (rate.count > 10) throw failure(429, 'DRIVE_RETRYABLE', 'Esperá unos minutos antes de volver a conectar.');
  const id = random(), verifier = random(), launchTicket = random();
  const payload = await seal({ verifier, accountId: input.accountId || null, hint: input.hint || '', launchHash: await digest(launchTicket) }, env.ENCRYPTION_KEY, 'authorization:' + id);
  await env.DB.prepare('INSERT INTO authorizations(id,challenge,payload,expires) VALUES(?,?,?,?)').bind(id, input.challenge, payload, now + TEN_MINUTES).run();
  return json({ id, launchTicket });
}
async function start(request, env, config, now) {
  // Top-level form POST from the app: a cross-site attacker cannot set the
  // required Origin in the victim's browser. Bind the callback to this popup
  // with a short-lived first-party cookie, never a third-party cookie.
  const input = new URLSearchParams(await readText(request, 'application/x-www-form-urlencoded'));
  const id = input.get('id'), verification = input.get('verification');
  if (!/^[\w-]{43}$/.test(id || '') || !/^[\w-]{43}$/.test(verification || '')) fail(401, 'DRIVE_AUTH');
  const row = await env.DB.prepare("SELECT * FROM authorizations WHERE id=? AND status='pending' AND expires>?").bind(id, now).first();
  if (!row || row.challenge !== await digest(verification)) fail(401, 'DRIVE_AUTH');
  const pending = await unseal(row.payload, env.ENCRYPTION_KEY, 'authorization:' + id), binding = random();
  pending.binding = await digest(binding);
  await env.DB.prepare("UPDATE authorizations SET payload=? WHERE id=? AND status='pending'").bind(await seal(pending, env.ENCRYPTION_KEY, 'authorization:' + id), id).run();
  // Navigate through our own first-party origin before leaving for Google.
  // This lets the browser commit the Secure, Lax cookie independently of a
  // cross-site POST -> Google redirect chain (notably fragile on iOS).
  return new Response(null, { status: 303, headers: { Location: config.server + '/oauth/continue?state=' + encodeURIComponent(id), 'Set-Cookie': `__Host-guarda-flow-${id}=${binding}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
}
// Open a real HTTPS page directly from the PWA's click event. iOS home-screen
// web apps can strand a synchronous about:blank window when a later HTML form
// targets it. The launch ticket can only navigate the browser to Google: it
// cannot read the resulting session, which still requires the private verifier.
async function launchAuthorization(request, url, env, config, now) {
  const id = url.searchParams.get('state'), ticket = url.searchParams.get('ticket');
  const unavailable = 'Esta solicitud de conexión no está disponible. Volvé a Guarda y tocá Conectar Google Drive nuevamente.';
  if (!/^[\w-]{43}$/.test(id || '') || !/^[\w-]{43}$/.test(ticket || '')) return callbackPage(false, unavailable);
  const row = await env.DB.prepare("SELECT * FROM authorizations WHERE id=? AND status='pending' AND expires>?").bind(id, now).first();
  if (!row) return callbackPage(false, unavailable);
  const pending = await unseal(row.payload, env.ENCRYPTION_KEY, 'authorization:' + id);
  if (!pending.launchHash || pending.binding || pending.launchHash !== await digest(ticket)) return callbackPage(false, unavailable);
  const binding = random();
  pending.binding = await digest(binding);
  delete pending.launchHash;
  // Atomic compare-and-swap: concurrent/replayed navigations cannot replace
  // the binding cookie of the first legitimate launch.
  const claimed = await env.DB.prepare("UPDATE authorizations SET payload=? WHERE id=? AND payload=? AND status='pending' RETURNING id")
    .bind(await seal(pending, env.ENCRYPTION_KEY, 'authorization:' + id), id, row.payload).first();
  if (!claimed) return callbackPage(false, unavailable);
  return new Response(null, { status: 303, headers: {
    Location: config.server + '/oauth/continue?state=' + encodeURIComponent(id),
    'Set-Cookie': `__Host-guarda-flow-${id}=${binding}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  } });
}
async function continueAuthorization(request, url, env, config, now) {
  const id = url.searchParams.get('state');
  if (!/^[\w-]{43}$/.test(id || '')) return callbackPage(false, 'No se encontró una solicitud de conexión válida. Volvé a Guarda y reintentá.');
  const row = await env.DB.prepare("SELECT * FROM authorizations WHERE id=? AND status='pending' AND expires>?").bind(id, now).first();
  if (!row) return callbackPage(false, 'La solicitud de conexión venció o ya fue utilizada. Volvé a Guarda y reintentá.');
  const pending = await unseal(row.payload, env.ENCRYPTION_KEY, 'authorization:' + id);
  const binding = request.headers.get('Cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`__Host-guarda-flow-${id}=`))?.split('=')[1];
  if (!/^[\w-]{43}$/.test(binding || '') || pending.binding !== await digest(binding)) {
    return callbackPage(false, 'El navegador no conservó la cookie temporal de autorización. Abrí Guarda en Safari o Chrome y permití las cookies del servicio de conexión. Tus notas están guardadas localmente.');
  }
  const googleUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleUrl.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: config.callback, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state: id, code_challenge: await digest(pending.verifier), code_challenge_method: 'S256', ...(pending.hint ? { login_hint: pending.hint } : {}) }).toString();
  return new Response(null, { status: 303, headers: { Location: googleUrl.href } });
}
async function callback(request, url, env, config, now, fetcher) {
  const id = url.searchParams.get('state');
  if (!/^[\w-]{43}$/.test(id || '')) return callbackPage(false, 'No se encontró una solicitud de conexión válida. Volvé a Guarda y reintentá.');
  const candidate = await env.DB.prepare("SELECT * FROM authorizations WHERE id=? AND status='pending' AND expires>?").bind(id, now).first();
  if (!candidate) return callbackPage(false, 'La solicitud de conexión venció o ya fue utilizada. Volvé a Guarda y reintentá.');
  const pending = await unseal(candidate.payload, env.ENCRYPTION_KEY, 'authorization:' + id);
  const binding = request.headers.get('Cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`__Host-guarda-flow-${id}=`))?.split('=')[1];
  if (!/^[\w-]{43}$/.test(binding || '') || pending.binding !== await digest(binding)) return callbackPage(false, 'El navegador no devolvió la cookie temporal al regresar de Google. Reintentá desde Safari o Chrome; tus notas siguen guardadas localmente.');
  // Claim once, before contacting Google; replay cannot mint another session.
  const row = await env.DB.prepare("UPDATE authorizations SET status='exchanging' WHERE id=? AND status='pending' AND expires>? RETURNING *").bind(id, now).first();
  if (!row) return callbackPage(false, 'Esta autorización ya fue procesada. Volvé a Guarda para comprobar la conexión.');
  let success = false, payload, explanation = '';
  try {
    if (url.searchParams.has('error')) fail(401, 'DRIVE_AUTH');
    const code = url.searchParams.get('code'); if (!code || code.length > 4096) fail(401, 'DRIVE_AUTH');
    const tokens = await exchange({ grant_type: 'authorization_code', code, redirect_uri: config.callback, code_verifier: pending.verifier }, env, fetcher);
    if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) fail(401, 'DRIVE_AUTH');
    const user = await identity(tokens.access_token, fetcher);
    if (pending.accountId && pending.accountId !== user.permissionId) fail(409, 'DRIVE_ACCOUNT');
    const session = random(), hash = await digest(session);
    const grant = await seal({ refreshToken: tokens.refresh_token, accessToken: tokens.access_token, accessExpires: now + (Number(tokens.expires_in) - 60) * 1000, user }, env.ENCRYPTION_KEY, 'session:' + hash);
    payload = await seal({ session, user }, env.ENCRYPTION_KEY, 'authorization:' + id);
    // Both writes commit together. D1 batch rolls back if either write fails.
    await env.DB.batch([
      env.DB.prepare('INSERT INTO sessions(token_hash,account_id,payload,expires) VALUES(?,?,?,?)').bind(hash, user.permissionId, grant, now + TEN_MINUTES),
      env.DB.prepare("UPDATE authorizations SET status='complete',payload=? WHERE id=?").bind(payload, id),
    ]);
    success = true;
  } catch (error) {
    const code = messages[error.code] ? error.code : 'DRIVE_RETRYABLE';
    explanation = messages[code];
    payload = await seal({ error: { code, message: messages[code] } }, env.ENCRYPTION_KEY, 'authorization:' + id);
    await env.DB.prepare("UPDATE authorizations SET status='failed',payload=? WHERE id=?").bind(payload, id).run();
  }
  const response = callbackPage(success, explanation);
  response.headers.set('Set-Cookie', `__Host-guarda-flow-${id}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return response;
}
async function poll(id, request, env, now) {
  const verifier = request.headers.get('X-Guarda-Verification');
  if (!/^[\w-]{43}$/.test(verifier || '')) fail(401, 'DRIVE_AUTH');
  const row = await env.DB.prepare('SELECT * FROM authorizations WHERE id=? AND expires>?').bind(id, now).first();
  if (!row || row.challenge !== await digest(verifier)) fail(401, 'DRIVE_AUTH');
  if (row.status !== 'complete' && row.status !== 'failed') return json({ pending: true });
  const data = await unseal(row.payload, env.ENCRYPTION_KEY, 'authorization:' + id);
  return json(data);
}
async function session(request, env, now) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([\w-]{43})$/)?.[1];
  if (!token) fail(401, 'DRIVE_AUTH');
  const hash = await digest(token);
  const row = await env.DB.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').bind(hash, now).first();
  if (!row) fail(401, 'DRIVE_AUTH');
  return { hash, row };
}
async function access(request, env, now, fetcher) {
  const input = await body(request), { hash, row } = await session(request, env, now);
  if (input.accountId && input.accountId !== row.account_id) fail(409, 'DRIVE_ACCOUNT');
  let data = await unseal(row.payload, env.ENCRYPTION_KEY, 'session:' + hash);
  if (input.force || data.accessExpires <= now + 15000) {
    const lock = await env.DB.prepare('UPDATE sessions SET refreshing_until=? WHERE token_hash=? AND refreshing_until<=? RETURNING token_hash').bind(now + 60000, hash, now).first();
    if (!lock) fail(503, 'DRIVE_RETRYABLE');
    try {
      // A different tab may have refreshed between SELECT and acquiring the lease.
      const current = await env.DB.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').bind(hash, now).first();
      if (!current) fail(401, 'DRIVE_AUTH');
      data = await unseal(current.payload, env.ENCRYPTION_KEY, 'session:' + hash);
      if (input.force || data.accessExpires <= now + 15000) {
        const tokens = await exchange({ grant_type: 'refresh_token', refresh_token: data.refreshToken }, env, fetcher);
        const user = await identity(tokens.access_token, fetcher);
        if (user.permissionId !== row.account_id) fail(409, 'DRIVE_ACCOUNT');
        data = { refreshToken: tokens.refresh_token || data.refreshToken, accessToken: tokens.access_token, accessExpires: now + (Number(tokens.expires_in) - 60) * 1000, user };
        const payload = await seal(data, env.ENCRYPTION_KEY, 'session:' + hash);
        const updated = await env.DB.prepare('UPDATE sessions SET payload=?,expires=? WHERE token_hash=? RETURNING token_hash').bind(payload, now + YEAR, hash).first();
        if (!updated) fail(401, 'DRIVE_AUTH'); // A concurrent disconnect wins.
      }
    } catch (error) {
      if (error.code === 'DRIVE_AUTH' || error.code === 'DRIVE_ACCOUNT') await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(hash).run();
      throw error;
    } finally {
      await env.DB.prepare('UPDATE sessions SET refreshing_until=0 WHERE token_hash=?').bind(hash).run();
    }
  }
  // Unclaimed OAuth results expire after ten minutes. Successful device use
  // activates/extends the session; abandoned popups cannot retain grants a year.
  if (row.expires <= now + 86400000) {
    const updated = await env.DB.prepare('UPDATE sessions SET expires=? WHERE token_hash=? RETURNING token_hash').bind(now + YEAR, hash).first();
    if (!updated) fail(401, 'DRIVE_AUTH');
  }
  return json({ accessToken: data.accessToken, expires: data.accessExpires, user: data.user });
}

export function createWorker({ fetcher = (...args) => fetch(...args), clock = Date.now } = {}) {
  return {
    async fetch(request, env) {
      let response, config; const origin = request.headers.get('Origin');
      try {
        config = configuration(env); const url = new URL(request.url), now = clock();
        if (url.origin !== config.server) throw failure(400, 'BAD_REQUEST', 'Dirección inválida.');
        if (url.pathname === '/oauth/callback' && request.method === 'GET') response = await callback(request, url, env, config, now, fetcher);
        else if (url.pathname === '/oauth/launch' && request.method === 'GET') response = await launchAuthorization(request, url, env, config, now);
        else if (url.pathname === '/oauth/continue' && request.method === 'GET') response = await continueAuthorization(request, url, env, config, now);
        else {
          if (origin !== config.app) throw failure(403, 'ORIGIN', 'Origen no autorizado.');
          if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
          else if (url.pathname === '/oauth/start' && request.method === 'POST') response = await start(request, env, config, now);
          else if (url.pathname === '/v1/config' && request.method === 'GET') response = json({ clientId: env.GOOGLE_CLIENT_ID, persistent: true });
          else if (url.pathname === '/v1/authorizations' && request.method === 'POST') response = await begin(request, env, config, now);
          else if (/^\/v1\/authorizations\/[\w-]{43}$/.test(url.pathname) && request.method === 'GET') response = await poll(url.pathname.split('/').at(-1), request, env, now);
          else if (url.pathname === '/v1/access-token' && request.method === 'POST') response = await access(request, env, now, fetcher);
          else if (url.pathname === '/v1/session' && request.method === 'DELETE') {
            const { hash } = await session(request, env, now);
            await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(hash).run(); response = json({ disconnected: true });
          } else response = json({ error: { code: 'NOT_FOUND', message: 'Solicitud desconocida.' } }, 404);
        }
      } catch (error) {
        response = json({ error: { code: error.code || 'DRIVE_RETRYABLE', message: error.status ? error.message : messages.DRIVE_RETRYABLE } }, error.status || 503);
      }
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store'); headers.set('Pragma', 'no-cache'); headers.set('Referrer-Policy', 'no-referrer'); headers.set('X-Content-Type-Options', 'nosniff'); headers.set('X-Frame-Options', 'DENY'); headers.set('Vary', 'Origin');
      if (config && origin === config.app) {
        headers.set('Access-Control-Allow-Origin', origin); headers.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS'); headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Guarda-Verification');
      }
      return new Response(response.body, { status: response.status, headers });
    },
    async scheduled(_event, env) {
      const now = clock();
      await env.DB.batch(['authorizations', 'sessions', 'rate_limits'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE expires<=?`).bind(now)));
    },
  };
}
export default createWorker();
