const encoder = new TextEncoder();
export const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
export const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async value => encode(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
async function key(secret) {
  const bytes = decode(secret);
  if (bytes.length !== 32) throw Error('Invalid encryption key');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
// Record-specific authenticated data prevents moving ciphertext between records.
export async function seal(value, secret, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, await key(secret), encoder.encode(JSON.stringify(value)));
  return encode(iv) + '.' + encode(data);
}
export async function unseal(value, secret, context) {
  const [iv, data] = value.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: encoder.encode(context) }, await key(secret), decode(data));
  return JSON.parse(new TextDecoder().decode(plain));
}
