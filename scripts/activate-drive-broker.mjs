import { readFile, writeFile } from 'node:fs/promises';
import { GOOGLE_CLIENT_ID } from '../src/drive-config.js';

// No credentials: this command only verifies the public configuration and pins
// the deployed origin in the next frontend build. It does not deploy anything.
const value = process.argv[2];
let url; try { url = new URL(value); } catch { throw Error('Uso: npm run broker:activate -- https://guarda-drive.TU-SUBDOMINIO.workers.dev'); }
if (url.protocol !== 'https:' || url.origin !== value.replace(/\/$/, '')) throw Error('Usá solamente el origen HTTPS del servicio, sin rutas ni parámetros.');
const response = await fetch(url.origin + '/v1/config', { headers: { Origin: 'https://guerrasur.github.io' }, redirect: 'error', signal: AbortSignal.timeout(20000), cache: 'no-store' });
if (!response.ok || response.headers.get('Access-Control-Allow-Origin') !== 'https://guerrasur.github.io') throw Error('El servicio no está listo o no permite el origen de Guarda.');
const config = await response.json();
if (config.clientId !== GOOGLE_CLIENT_ID || config.persistent !== true) throw Error('El servicio no corresponde al cliente de Google de Guarda.');
const file = new URL('../src/drive-config.js', import.meta.url), source = await readFile(file, 'utf8');
await writeFile(file, source.replace(/export const DRIVE_BROKER_URL = '[^']*';/, `export const DRIVE_BROKER_URL = '${url.origin}';`));
console.log('Conexión persistente configurada para el próximo build. Falta incrementar la versión, verificar y publicar el frontend.');
