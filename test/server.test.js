import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';
import { createServer } from '../server/index.js';
import { canonicalize, b64uEncode, observerIdFromKey, hashRecord } from '../public/shared/canonical.js';
import { EXPERIMENTS } from '../public/shared/experiments.js';

async function boot() {
  const app = await createServer({ dataDir: mkdtempSync(join(tmpdir(), 'obs-')), seed: false });
  await new Promise((r) => app.server.listen(0, r));
  return { app, base: `http://localhost:${app.server.address().port}` };
}
async function observer() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const j = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const key = `${j.x}.${j.y}`;
  return { kp, key, id: await observerIdFromKey(key) };
}
const sign = async (o, rec) => b64uEncode(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, o.kp.privateKey, new TextEncoder().encode(canonicalize(rec)))));
const post = (base, path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

async function obsRecord(o, over = {}) {
  return { v: 1, kind: 'observation', experiment: 'shadow-angle', protocol: { version: 1, hash: (await hashRecord(EXPERIMENTS['shadow-angle'])).slice(0, 16) }, observer: { key: o.key, id: o.id }, captured_ms: Date.now() - 1000, outcome: 'measured',
    location: { lat: 35.68, lon: 139.65, alt_m: 10, accuracy_m: 8, alt_accuracy_m: null, source: 'gps', rounding_deg: 0.01 },
    measurements: { stick_cm: 100, shadow_cm: 55, shadow_dir: 'N', tilt_deg: 0.5 }, device: { ua: 't', platform: 't', sensors: { geolocation: true }, clock_offset_ms: 5, clock_rtt_ms: 40, app_version: 't' }, media: [], prediction_id: null, replicates: null, notes: '', ...over };
}

test('signed observation is accepted, chained, and verifiable', async () => {
  const { app, base } = await boot();
  try {
    const o = await observer();
    const rec = await obsRecord(o);
    const res = await post(base, '/api/observations', { record: rec, signature: await sign(o, rec) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.ledger_seq, 1);
    const dup = await post(base, '/api/observations', { record: rec, signature: await sign(o, rec) });
    assert.equal(dup.status, 200); // idempotent
    const v = await fetch(base + '/api/ledger/verify').then((r) => r.json());
    assert.equal(v.ok, true);
    const detail = await fetch(`${base}/api/observations/${res.body.id}`).then((r) => r.json());
    assert.ok(Math.abs(detail.derived.value - 28.8) < 0.2);
  } finally { app.close(); }
});

test('forged signature, wrong protocol, bad data and unknown fields are rejected', async () => {
  const { app, base } = await boot();
  try {
    const a = await observer(), b = await observer();
    const rec = await obsRecord(a);
    assert.equal((await post(base, '/api/observations', { record: rec, signature: await sign(b, rec) })).status, 401);
    const bad = await obsRecord(a, { protocol: { version: 1, hash: 'deadbeef' } });
    assert.equal((await post(base, '/api/observations', { record: bad, signature: await sign(a, bad) })).status, 422);
    const stuff = await obsRecord(a, { measurements: { stick_cm: 100, shadow_cm: 99999, shadow_dir: 'N' } });
    assert.equal((await post(base, '/api/observations', { record: stuff, signature: await sign(a, stuff) })).status, 422);
    const extra = { ...(await obsRecord(a)), is_admin: true };
    assert.equal((await post(base, '/api/observations', { record: extra, signature: await sign(a, extra) })).status, 422);
    const future = await obsRecord(a, { captured_ms: Date.now() + 3600e3 });
    assert.equal((await post(base, '/api/observations', { record: future, signature: await sign(a, future) })).status, 422);
  } finally { app.close(); }
});

test('database refuses edits; tampering is detected even if triggers are bypassed', async () => {
  const { app, base } = await boot();
  try {
    const o = await observer();
    for (let i = 0; i < 3; i++) { const rec = await obsRecord(o, { captured_ms: Date.now() - 1000 - i }); assert.equal((await post(base, '/api/observations', { record: rec, signature: await sign(o, rec) })).status, 201); }
    const db = app.store.db;
    assert.throws(() => db.exec("UPDATE records SET record = '{}' WHERE ledger_seq = 2"), /append-only/);
    assert.throws(() => db.exec('DELETE FROM ledger WHERE seq = 2'), /append-only/);
    // an attacker with raw file access drops the trigger and edits a measurement
    db.exec('DROP TRIGGER records_no_update');
    const row = db.prepare('SELECT record FROM records WHERE ledger_seq = 2').get();
    db.prepare('UPDATE records SET record = ? WHERE ledger_seq = 2').run(row.record.replace('"shadow_cm":55', '"shadow_cm":10'));
    const v = await fetch(base + '/api/ledger/verify').then((r) => r.json());
    assert.equal(v.ok, false);
    assert.ok(v.chain.errors.some((e) => e.seq === 2 && /content/.test(e.error)));
    assert.ok(v.signatures.bad.length >= 1);
  } finally { app.close(); }
});

test('amendments only by the original observer; challenges resolve by votes', async () => {
  const { app, base } = await boot();
  try {
    const o = await observer(), other = await observer();
    const rec = await obsRecord(o);
    const { body: r } = await post(base, '/api/observations', { record: rec, signature: await sign(o, rec) });
    const am = (who) => ({ v: 1, kind: 'amendment', observer: { key: who.key, id: who.id }, made_ms: Date.now(), obs_id: r.id, changes: { measurements: { shadow_cm: 60 } }, reason: 'typo in the tape reading' });
    const forged = am(other); assert.equal((await post(base, '/api/amendments', { record: forged, signature: await sign(other, forged) })).status, 403);
    const ok = am(o); assert.equal((await post(base, '/api/amendments', { record: ok, signature: await sign(o, ok) })).status, 201);
    const det = await fetch(`${base}/api/observations/${r.id}`).then((x) => x.json());
    assert.equal(det.observation.record.measurements.shadow_cm, 60);
    assert.equal(det.observation.original.measurements.shadow_cm, 55);
    // challenge + votes
    const ch = { v: 1, kind: 'challenge', experiment: 'shadow-angle', observer: { key: other.key, id: other.id }, made_ms: Date.now(), target: { type: 'observation', id: r.id }, challenge_type: 'incorrect_measurement', body: 'The stick looks leaning in the photo, please check.', effect: { kind: 'inflate', factor: 3 } };
    const { body: c } = await post(base, '/api/challenges', { record: ch, signature: await sign(other, ch) });
    const concede = { v: 1, kind: 'vote', observer: { key: o.key, id: o.id }, made_ms: Date.now(), challenge_id: c.id, stance: 'support' };
    assert.equal((await post(base, '/api/votes', { record: concede, signature: await sign(o, concede) })).status, 201);
    const d2 = await fetch(`${base}/api/experiments/shadow-angle/data`).then((x) => x.json());
    assert.equal(d2.challenges[0].status, 'upheld'); // the observer conceded
    assert.equal(d2.observations[0].adj.inflate, 3);
    const stranger = await observer();
    const sv = { v: 1, kind: 'vote', observer: { key: stranger.key, id: stranger.id }, made_ms: Date.now(), challenge_id: c.id, stance: 'dispute' };
    assert.equal((await post(base, '/api/votes', { record: sv, signature: await sign(stranger, sv) })).status, 403); // never contributed
  } finally { app.close(); }
});
