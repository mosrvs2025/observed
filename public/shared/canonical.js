// Canonical JSON + hashing + base64url. Runs identically in the browser and in Node,
// so a record hashed on your phone can be re-hashed by anyone, anywhere.

export function canonicalize(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonicalize: non-finite number');
      return JSON.stringify(value);
    case 'string': return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
      const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
    }
    default: throw new Error('canonicalize: unsupported type ' + typeof value);
  }
}

const enc = new TextEncoder();

export function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? enc.encode(input) : input;
  return toHex(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

export async function hashRecord(record) {
  return sha256Hex(canonicalize(record));
}

export function b64uEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// An observer is a public key. Its short id is a hash of the key string "x.y".
export async function observerIdFromKey(key) {
  return (await sha256Hex(key)).slice(0, 12);
}

export async function importObserverKey(key) {
  const [x, y] = key.split('.');
  return globalThis.crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

// Verifies a record signature (ECDSA P-256 / SHA-256, IEEE-P1363 r||s encoding).
export async function verifyRecordSignature(record, signatureB64u) {
  try {
    const key = await importObserverKey(record.observer.key);
    return await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      b64uDecode(signatureB64u),
      enc.encode(canonicalize(record)),
    );
  } catch {
    return false;
  }
}

export const GENESIS_HASH = '0'.repeat(64);

export async function ledgerEntryHash({ seq, kind, ref, content_hash, received_ms, prev_hash }) {
  return sha256Hex(`${seq}|${kind}|${ref}|${content_hash}|${received_ms}|${prev_hash}`);
}
