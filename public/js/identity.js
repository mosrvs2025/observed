// Your device is your identity: an ECDSA P-256 key pair created in the browser, private key
// non-extractable and kept in IndexedDB. No accounts, no passwords. Every record you submit is
// signed with it, so the server (and anyone else) can prove it came from the same device.

import { canonicalize, b64uEncode, observerIdFromKey } from '/shared/canonical.js';
import { observerName } from '/shared/names.js';
import { api } from './api.js';

const DB = 'observed', STORE = 'keys';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const idbGet = async (k) => { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
const idbPut = async (k, v) => { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction(STORE, 'readwrite').objectStore(STORE).put(v, k); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); };

let cached = null;

export async function getIdentity() {
  if (cached) return cached;
  let rec = null;
  try { rec = await idbGet('device'); } catch { /* private mode */ }
  if (!rec) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
    rec = { privateKey: kp.privateKey, key: `${jwk.x}.${jwk.y}`, created_ms: Date.now() };
    try { await idbPut('device', rec); } catch { /* keep in memory for this session */ }
  }
  const id = await observerIdFromKey(rec.key);
  const nick = localStorage.getItem('observed.nick') || '';
  cached = { ...rec, id, nick, name: nick || observerName(id) };
  return cached;
}

export function setNick(n) {
  const v = (n || '').trim().slice(0, 24);
  if (v) localStorage.setItem('observed.nick', v); else localStorage.removeItem('observed.nick');
  cached = null;
}

export async function observerBlock() {
  const me = await getIdentity();
  const o = { key: me.key, id: me.id };
  if (me.nick) o.name = me.nick;
  return o;
}

export async function signRecord(record) {
  const me = await getIdentity();
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, me.privateKey, new TextEncoder().encode(canonicalize(record)));
  return b64uEncode(new Uint8Array(sig));
}

// Remember what this device submitted (ids only) so "My observations" works offline-first.
export function rememberMine(id, experiment) {
  const list = JSON.parse(localStorage.getItem('observed.mine') || '[]');
  if (!list.find((x) => x.id === id)) list.unshift({ id, experiment, ts: Date.now() });
  localStorage.setItem('observed.mine', JSON.stringify(list.slice(0, 500)));
}
export const mine = () => JSON.parse(localStorage.getItem('observed.mine') || '[]');

// NTP-lite handshake: estimate phone-clock − server-clock using the lowest-RTT of a few pings.
export async function syncClock(n = 5) {
  let best = null;
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    try {
      const { now_ms } = await api.get('/api/time');
      const t1 = Date.now();
      const rtt = t1 - t0;
      const offset = (t0 + t1) / 2 - now_ms; // positive = phone is ahead
      if (!best || rtt < best.rtt) best = { offset: Math.round(offset), rtt };
    } catch { /* ignore */ }
  }
  return best ? { clock_offset_ms: best.offset, clock_rtt_ms: best.rtt } : { clock_offset_ms: null, clock_rtt_ms: null };
}

export function deviceInfo(sensors, clock) {
  return {
    ua: navigator.userAgent.slice(0, 300),
    platform: (navigator.userAgentData?.platform || navigator.platform || '').slice(0, 80),
    sensors,
    clock_offset_ms: clock?.clock_offset_ms ?? null,
    clock_rtt_ms: clock?.clock_rtt_ms ?? null,
    app_version: '0.1.0',
  };
}

// Server's clock now (ms), used to stamp predictions/models so a wrong phone clock can't matter.
export async function serverNow() {
  const t0 = Date.now();
  const { now_ms } = await api.get('/api/time');
  return Math.round(now_ms + (Date.now() - t0) / 2);
}
