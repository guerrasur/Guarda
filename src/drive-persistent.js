import { DriveClient } from './drive-client.js';
import { GOOGLE_CLIENT_ID } from './drive-config.js';

const SESSION = 'drive-broker-session', REVOCATIONS = 'drive-broker-revocations';
const error = (message, code = 'DRIVE_RETRYABLE') => Object.assign(new Error(message), { code });
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export class PersistentDriveClient extends DriveClient {
  constructor({ store, brokerUrl, env = globalThis }) {
    super({ env }); this.store = store; this.persistent = true; this.clientId = GOOGLE_CLIENT_ID; this.generation = 0;
    const url = new URL(brokerUrl);
    if (url.protocol !== 'https:' || url.origin !== brokerUrl.replace(/\/$/, '')) throw Error('Dirección del servicio de conexión inválida.');
    this.brokerUrl = url.origin;
  }
  // Google tokens remain in page memory. Only Guarda's revocable device session
  // is durable, under a drive-* key excluded from backup/import/synchronization.
  session() { return null; }
  async api(path, { method = 'GET', body, credential, verifier, signal } = {}) {
    const controller = new this.env.AbortController();
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = this.env.setTimeout(abort, 25000);
    try {
      const response = await this.env.fetch(this.brokerUrl + path, {
        method, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(credential ? { Authorization: 'Bearer ' + credential.session } : {}), ...(verifier ? { 'X-Guarda-Verification': verifier } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw error(data.error?.message || 'No se pudo recuperar la conexión de Google Drive.', ['DRIVE_AUTH', 'DRIVE_ACCOUNT', 'DRIVE_PERMISSION'].includes(data.error?.code) ? data.error.code : 'DRIVE_RETRYABLE');
      return data;
    } catch (cause) {
      if (typeof cause.code === 'string' && cause.code.startsWith('DRIVE_')) throw cause;
      throw error('No se pudo recuperar la conexión. Se volverá a intentar cuando haya internet.');
    } finally { this.env.clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async prepare(clientId) {
    const config = await this.api('/v1/config');
    if (!config.persistent || config.clientId !== clientId) throw error('La configuración de Google no coincide con el servicio de Guarda.', 'DRIVE_PERMISSION');
    this.clientId = clientId; await this.flushRevocations();
  }
  valid(credential) {
    return credential?.broker === this.brokerUrl && credential.clientId === this.clientId && /^[\w-]{43}$/.test(credential.session || '') && typeof credential.accountId === 'string' && !!credential.accountId;
  }
  flushRevocations() {
    if (this.revocationFlight) return this.revocationFlight;
    this.revocationFlight = this.revokeQueued().finally(() => { this.revocationFlight = null; });
    return this.revocationFlight;
  }
  async revokeQueued() {
    if (this.env.navigator?.onLine === false) return;
    const queued = await this.store.getSetting(REVOCATIONS, []), removed = new Set();
    for (const credential of queued) {
      if (!this.valid(credential)) continue;
      try { await this.api('/v1/session', { method: 'DELETE', credential }); removed.add(credential.session); }
      catch (cause) { if (cause.code === 'DRIVE_AUTH') removed.add(credential.session); }
    }
    if (removed.size) {
      const current = await this.store.getSetting(REVOCATIONS, []);
      await this.store.setSetting(REVOCATIONS, current.filter(credential => !removed.has(credential.session)));
    }
  }
  async resumeSession({ accountId, clientId = this.clientId } = {}) {
    this.clientId = clientId;
    const saved = await this.store.getSetting(SESSION, null);
    if (!this.valid(saved)) return false;
    if (accountId && saved.accountId !== accountId) throw error('Estas notas están vinculadas a otra cuenta de Google.', 'DRIVE_ACCOUNT');
    await this.ensureAccess(); return this.connected;
  }
  ensureAccess(force = false) {
    if (this.tokenFlight) return this.tokenFlight;
    const generation = this.generation;
    this.tokenFlight = this.getAccess(force, generation).finally(() => { this.tokenFlight = null; });
    return this.tokenFlight;
  }
  async getAccess(force, generation) {
    const saved = await this.store.getSetting(SESSION, null);
    if (!this.valid(saved)) { this.expire(); throw error('Conectá Google Drive para activar el guardado automático.', 'DRIVE_AUTH'); }
    if (this.user && this.user.permissionId !== saved.accountId) { this.expire(); throw error('Estas notas pertenecen a otra cuenta.', 'DRIVE_ACCOUNT'); }
    if (!force && this.hasToken && this.currentSession === saved.session) return;
    let data;
    try { data = await this.api('/v1/access-token', { method: 'POST', credential: saved, body: { force, accountId: saved.accountId } }); }
    catch (cause) {
      if (generation !== this.generation) throw error('Conexión cancelada.', 'DRIVE_AUTH');
      if (cause.code === 'DRIVE_AUTH') {
        const current = await this.store.getSetting(SESSION, null);
        if (current?.session === saved.session) await this.store.setSetting(SESSION, null);
        this.expire();
      }
      throw cause;
    }
    const current = await this.store.getSetting(SESSION, null);
    if (generation !== this.generation || current?.session !== saved.session) throw error('La conexión cambió. Se volverá a comprobar.', 'DRIVE_RETRYABLE');
    if (data.user?.permissionId !== saved.accountId) { this.expire(); throw error('La cuenta de Google no coincide con las notas vinculadas.', 'DRIVE_ACCOUNT'); }
    if (typeof data.accessToken !== 'string' || !data.accessToken || !Number.isFinite(data.expires) || data.expires <= Date.now() + 15000) throw error('Google no devolvió un acceso vigente. Se volverá a intentar.');
    this.token = data.accessToken; this.expires = data.expires; this.user = data.user; this.identityVerified = true; this.currentSession = saved.session;
  }
  async request(path, options) {
    await this.ensureAccess();
    try { return await super.request(path, options); }
    catch (cause) {
      if (cause.code !== 'DRIVE_AUTH') throw cause;
      await this.ensureAccess(true); return super.request(path, options);
    }
  }
  connect({ accountId = null, hint = '' } = {}) {
    if (this.pending) return Promise.reject(error('La conexión ya está en curso.'));
    // Open before the first await, preserving Safari's user activation.
    const name = 'guarda-drive-' + this.env.crypto.randomUUID(), popup = this.env.open?.('', name);
    if (!popup) return Promise.reject(error('Permití las ventanas emergentes o abrí Guarda desde Safari para conectar Google.', 'DRIVE_INTERACTION'));
    try { popup.opener = null; popup.document.title = 'Conectando Google Drive…'; } catch {}
    const pending = { popup, name, controller: new this.env.AbortController(), generation: this.generation };
    this.pending = pending;
    return this.authorize(pending, accountId, hint).finally(() => {
      this.env.clearTimeout(pending.timer); try { popup.close(); } catch {}
      if (this.pending === pending) this.pending = null;
    });
  }
  async authorize(pending, accountId, hint) {
    const verifier = encode(this.env.crypto.getRandomValues(new Uint8Array(32)));
    const challenge = encode(await this.env.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const start = await this.api('/v1/authorizations', { method: 'POST', body: { challenge, accountId, hint }, signal: pending.controller.signal });
    if (!/^[\w-]{43}$/.test(start.id || '')) throw error('El servicio devolvió una autorización inválida.', 'DRIVE_PERMISSION');
    if (this.pending !== pending || pending.generation !== this.generation) throw error('Conexión cancelada.', 'DRIVE_AUTH');
    const form = this.env.document.createElement('form');
    form.method = 'POST'; form.action = this.brokerUrl + '/oauth/start'; form.target = pending.name; form.hidden = true;
    for (const [name, value] of Object.entries({ id: start.id, verification: verifier })) {
      const input = this.env.document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input);
    }
    this.env.document.body.append(form);
    try { form.submit(); } finally { form.remove(); }
    const deadline = Date.now() + 600000;
    let closedOnPreviousPoll = false;
    while (Date.now() < deadline) {
      if (this.pending !== pending || pending.controller.signal.aborted) throw error('Conexión cancelada.', 'DRIVE_AUTH');
      let data;
      try { data = await this.api('/v1/authorizations/' + start.id, { verifier, signal: pending.controller.signal }); }
      catch (cause) { if (cause.code !== 'DRIVE_RETRYABLE') throw cause; }
      if (data?.error) throw error(data.error.message, data.error.code);
      if (data?.session) {
        if (accountId && data.user?.permissionId !== accountId) throw error('Estas notas pertenecen a otra cuenta. Conectá la cuenta vinculada.', 'DRIVE_ACCOUNT');
        const credential = { broker: this.brokerUrl, clientId: this.clientId, session: data.session, accountId: data.user?.permissionId };
        if (!this.valid(credential)) throw error('Google no devolvió una cuenta válida.');
        const previous = await this.store.getSetting(SESSION, null);
        if (this.pending !== pending || pending.generation !== this.generation) throw error('Conexión cancelada.', 'DRIVE_AUTH');
        await this.store.setSetting(SESSION, credential);
        if (this.pending !== pending || pending.generation !== this.generation) {
          const current = await this.store.getSetting(SESSION, null);
          if (current?.session === credential.session) await this.store.setSetting(SESSION, null);
          await this.queueRevocation(credential); throw error('Conexión cancelada.', 'DRIVE_AUTH');
        }
        this.expire(); this.user = data.user;
        if (this.valid(previous) && previous.session !== credential.session) await this.queueRevocation(previous);
        return this.user;
      }
      // A pending response may have been read before the callback committed and
      // closed the popup. Poll again after observing closure before cancelling.
      if (pending.popup.closed && closedOnPreviousPoll && data?.pending) throw error('Se cerró la ventana de Google. Podés volver a conectar.', 'DRIVE_INTERACTION');
      closedOnPreviousPoll = !!pending.popup.closed;
      await new Promise(resolve => { pending.wake = resolve; pending.timer = this.env.setTimeout(resolve, this.env.document?.hidden ? 5000 : 1500); });
    }
    throw error('Google no respondió. Volvé a conectar para reintentarlo.', 'DRIVE_INTERACTION');
  }
  async queueRevocation(credential) {
    const queued = await this.store.getSetting(REVOCATIONS, []);
    if (!queued.some(value => value.session === credential.session)) await this.store.setSetting(REVOCATIONS, [...queued, credential]);
  }
  async disconnect() {
    ++this.generation; const pending = this.pending; this.pending = null;
    pending?.controller.abort(); if (pending) { this.env.clearTimeout(pending.timer); pending.wake?.(); try { pending.popup.close(); } catch {} }
    this.expire(); this.user = null; this.folder = null;
    const saved = await this.store.getSetting(SESSION, null);
    // Durably queue revocation before forgetting the local credential.
    if (this.valid(saved)) await this.queueRevocation(saved);
    await this.store.setSetting(SESSION, null);
    await this.flushRevocations();
  }
}
