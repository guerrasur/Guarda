// Retry-After accepts seconds or an HTTP date. Never retry before the server's
// deadline; cap only local exponential backoff, not a valid provider deadline.
export function retryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}
export function retryDelay(attempt, minimum = 0, random = Math.random) {
  const base = Math.min(60000, 3000 * 2 ** Math.min(6, Math.max(0, attempt - 1)));
  return Math.max(minimum || 0, base) + Math.floor(random() * base * 0.25);
}

export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
export async function readBackupResponse(response) {
  if (Number(response.headers.get('Content-Length')) > MAX_BACKUP_BYTES) throw Error('La copia supera 200 MB. Conservá el archivo y dividilo antes de importarlo.');
  const reader = response.body?.getReader();
  if (!reader) throw Error('No se pudo leer la copia de Drive.');
  const decoder = new TextDecoder(); let bytes = 0, text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BACKUP_BYTES) throw Error('La copia supera 200 MB. Conservá el archivo y dividilo antes de importarlo.');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
