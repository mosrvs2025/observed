// Append-only evidence store. SQLite triggers make every evidence table immutable at the database
// level; every accepted record is also appended to a SHA-256 hash-chained ledger and receipted with
// a server signature. Corrections are new rows that point at the old ones — nothing is edited.

import { DatabaseSync } from 'node:sqlite';
import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify, createPublicKey, createPrivateKey } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize, verifyRecordSignature, GENESIS_HASH } from '../public/shared/canonical.js';
import { observerName } from '../public/shared/names.js';
import { CHALLENGE_TYPES } from './validate.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const PREFIX = { observation: 'obs', prediction: 'prd', model: 'mdl', challenge: 'chl', vote: 'vot', amendment: 'amd' };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ledger (
  seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, content_hash TEXT NOT NULL,
  received_ms INTEGER NOT NULL, prev_hash TEXT NOT NULL, entry_hash TEXT NOT NULL, server_sig TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, experiment TEXT, observer_id TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE, record TEXT NOT NULL, signature TEXT NOT NULL,
  received_ms INTEGER NOT NULL, ledger_seq INTEGER NOT NULL UNIQUE,
  -- denormalised, immutable query helpers
  target TEXT, synthetic INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS records_kind_exp ON records(kind, experiment);
CREATE INDEX IF NOT EXISTS records_target ON records(target);
CREATE TABLE IF NOT EXISTS anchors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, head_seq INTEGER NOT NULL, head_hash TEXT NOT NULL, ts_ms INTEGER NOT NULL,
  server_sig TEXT NOT NULL, external_ref TEXT
);
CREATE TABLE IF NOT EXISTS intents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, experiment TEXT NOT NULL, target TEXT, observer_id TEXT NOT NULL, ts_ms INTEGER NOT NULL,
  UNIQUE(experiment, target, observer_id)
);
CREATE TABLE IF NOT EXISTS interest (experiment TEXT NOT NULL, observer_id TEXT NOT NULL, ts_ms INTEGER NOT NULL, PRIMARY KEY (experiment, observer_id));
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS records_no_update BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT, 'records are append-only'); END;
CREATE TRIGGER IF NOT EXISTS records_no_delete BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT, 'records are append-only'); END;
CREATE TRIGGER IF NOT EXISTS anchors_no_update BEFORE UPDATE ON anchors BEGIN SELECT RAISE(ABORT, 'anchors are append-only'); END;
CREATE TRIGGER IF NOT EXISTS anchors_no_delete BEFORE DELETE ON anchors BEGIN SELECT RAISE(ABORT, 'anchors are append-only'); END;
`;

export class Store {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.dir = dir;
    this.db = new DatabaseSync(dir === ':memory:' ? ':memory:' : join(dir, 'observed.db'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec(SCHEMA);
    this.#loadKey();
    this.listeners = new Set();
  }

  #loadKey() {
    const f = join(this.dir, 'server-key.json');
    let jwk;
    if (existsSync(f)) jwk = JSON.parse(readFileSync(f, 'utf8'));
    else {
      const { privateKey } = generateKeyPairSync('ed25519');
      jwk = privateKey.export({ format: 'jwk' });
      writeFileSync(f, JSON.stringify(jwk), { mode: 0o600 });
    }
    this.privateKey = createPrivateKey({ key: jwk, format: 'jwk' });
    this.publicJwk = { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
    this.publicKey = createPublicKey({ key: this.publicJwk, format: 'jwk' });
  }

  signServer(hex) {
    return edSign(null, Buffer.from(hex, 'hex'), this.privateKey).toString('base64url');
  }
  verifyServer(hex, sig) {
    return edVerify(null, Buffer.from(hex, 'hex'), this.publicKey, Buffer.from(sig, 'base64url'));
  }

  head() {
    return this.db.prepare('SELECT seq, entry_hash, received_ms FROM ledger ORDER BY seq DESC LIMIT 1').get() || { seq: 0, entry_hash: GENESIS_HASH, received_ms: 0 };
  }

  // The only write path for evidence. `verified` = signature already checked by the caller.
  append(kind, record, signature) {
    const content_hash = sha256(canonicalize(record));
    const db = this.db;
    const existing = db.prepare('SELECT id, ledger_seq FROM records WHERE content_hash = ?').get(content_hash);
    if (existing) return { duplicate: true, id: existing.id, ledger_seq: existing.ledger_seq };
    const id = `${PREFIX[kind]}_${content_hash.slice(0, 12)}`;
    db.exec('BEGIN IMMEDIATE');
    try {
      const h = this.head();
      const seq = h.seq + 1;
      const received_ms = Math.max(Date.now(), h.received_ms); // monotonic ledger clock
      const entry_hash = sha256(`${seq}|${kind}|${id}|${content_hash}|${received_ms}|${h.entry_hash}`);
      const server_sig = this.signServer(entry_hash);
      db.prepare('INSERT INTO ledger (seq, kind, ref, content_hash, received_ms, prev_hash, entry_hash, server_sig) VALUES (?,?,?,?,?,?,?,?)').run(seq, kind, id, content_hash, received_ms, h.entry_hash, entry_hash, server_sig);
      // what this record points at — derived from the record itself so it can never be forgotten
      const target = kind === 'amendment' ? record.obs_id : kind === 'vote' ? record.challenge_id : kind === 'challenge' ? record.target.id : kind === 'observation' ? record.replicates ?? null : null;
      db.prepare('INSERT INTO records (id, kind, experiment, observer_id, content_hash, record, signature, received_ms, ledger_seq, target, synthetic) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
        id, kind, record.experiment ?? null, record.observer.id, content_hash, JSON.stringify(record), signature, received_ms, seq, target, record.synthetic ? 1 : 0,
      );
      db.exec('COMMIT');
      const receipt = { id, kind, content_hash, ledger_seq: seq, received_ms, prev_hash: h.entry_hash, entry_hash, server_sig };
      for (const l of this.listeners) { try { l(kind, id, record, receipt); } catch { /* ignore */ } }
      return receipt;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  receiptFor(id) {
    const r = this.db.prepare('SELECT l.* FROM ledger l JOIN records r ON r.ledger_seq = l.seq WHERE r.id = ?').get(id);
    return r ? { id, kind: r.kind, content_hash: r.content_hash, ledger_seq: r.seq, received_ms: r.received_ms, prev_hash: r.prev_hash, entry_hash: r.entry_hash, server_sig: r.server_sig } : null;
  }

  // ── reads ──
  row(id) {
    const r = this.db.prepare('SELECT * FROM records WHERE id = ?').get(id);
    return r ? this.#hydrate(r) : null;
  }
  list(kind, experiment, { limit = 1000 } = {}) {
    const rows = experiment
      ? this.db.prepare('SELECT * FROM records WHERE kind = ? AND experiment = ? ORDER BY ledger_seq LIMIT ?').all(kind, experiment, limit)
      : this.db.prepare('SELECT * FROM records WHERE kind = ? ORDER BY ledger_seq LIMIT ?').all(kind, limit);
    return rows.map((r) => this.#hydrate(r));
  }
  byTarget(kind, target) {
    return this.db.prepare('SELECT * FROM records WHERE kind = ? AND target = ? ORDER BY ledger_seq').all(kind, target).map((r) => this.#hydrate(r));
  }
  #hydrate(r) {
    return { id: r.id, kind: r.kind, experiment: r.experiment, observer_id: r.observer_id, content_hash: r.content_hash, record: JSON.parse(r.record), signature: r.signature, received_ms: r.received_ms, ledger_seq: r.ledger_seq, target: r.target, synthetic: !!r.synthetic };
  }

  // Observation with amendments applied. The original is always kept and returned alongside.
  effective(obsRow) {
    const amends = this.byTarget('amendment', obsRow.id).filter((a) => a.observer_id === obsRow.observer_id);
    let rec = obsRow.record;
    for (const a of amends) rec = { ...rec, measurements: { ...rec.measurements, ...a.record.changes.measurements } };
    return { record: rec, amendments: amends };
  }

  // Challenge status is *derived* from the votes — never stored.
  challengeState(ch) {
    const votes = this.byTarget('vote', ch.id);
    const target = ch.record.target;
    let targetObserver = null;
    if (target.type === 'observation') targetObserver = this.row(target.id)?.observer_id ?? null;
    const seen = new Map(); // append-only: one vote per observer, the first wins
    for (const v of votes) if (!seen.has(v.observer_id)) seen.set(v.observer_id, v);
    let support = 0, dispute = 0, concession = false;
    for (const v of seen.values()) {
      if (v.observer_id === ch.observer_id) continue;
      if (v.record.stance === 'support') { support++; if (v.observer_id === targetObserver) concession = true; } else dispute++;
    }
    let status = 'open';
    if (concession || support - dispute >= 3) status = 'upheld';
    else if (dispute - support >= 3) status = 'rejected';
    return { status, support, dispute, concession, votes: [...seen.values()].map((v) => ({ id: v.id, observer_id: v.observer_id, stance: v.record.stance, note: v.record.note || '', received_ms: v.received_ms })) };
  }

  challengesFor(experiment) {
    return this.list('challenge', experiment).map((c) => ({ ...c, ...this.challengeState(c), effect: c.record.effect, challenge_type: c.record.challenge_type, target: c.record.target }));
  }

  hasMeasured(observerId, experiment) {
    return !!this.db.prepare("SELECT 1 FROM records WHERE kind='observation' AND observer_id=? AND experiment=? LIMIT 1").get(observerId, experiment);
  }

  // Everything an analysis needs, in the shape shared/analysis.js expects.
  analysisInput(slug) {
    const challenges = this.challengesFor(slug);
    const adjMap = new Map();
    const add = (id, key, eff, reason) => {
      const a = adjMap.get(id) || { exclude: false, inflate: 1, reasons: [], whatif: { exclude: false, inflate: 1 } };
      const tgt = key === 'applied' ? a : a.whatif;
      if (eff.kind === 'exclude') tgt.exclude = true;
      if (eff.kind === 'inflate') tgt.inflate = Math.max(tgt.inflate, eff.factor);
      if (key === 'applied') a.reasons.push(reason);
      adjMap.set(id, a);
    };
    for (const c of challenges) {
      if (c.target.type !== 'observation' || c.effect.kind === 'note') continue;
      if (c.status === 'upheld') add(c.target.id, 'applied', c.effect, CHALLENGE_TYPES[c.challenge_type].label);
      else if (c.status === 'open') add(c.target.id, 'whatif', c.effect);
    }
    const observations = [], failed = [];
    for (const o of this.list('observation', slug, { limit: 100000 })) {
      const eff = this.effective(o);
      const item = { id: o.id, observer_id: o.observer_id, received_ms: o.received_ms, synthetic: o.synthetic, record: eff.record, replicates: eff.record.replicates, adj: adjMap.get(o.id) || { exclude: false, inflate: 1, reasons: [], whatif: { exclude: false, inflate: 1 } } };
      (eff.record.outcome === 'measured' ? observations : failed).push(item);
    }
    const models = this.list('model', slug).map((m) => ({ id: m.id, name: m.record.name, family: m.record.family, params: m.record.params, rationale: m.record.rationale, observer_id: m.observer_id, registered_ms: m.received_ms, synthetic: m.synthetic, ledger_seq: m.ledger_seq, content_hash: m.content_hash }));
    return { observations, attempts: failed, models, challenges };
  }

  // ── integrity ──
  verifyChain({ from = 1, limit = 1e9 } = {}) {
    const rows = this.db.prepare('SELECT * FROM ledger WHERE seq >= ? ORDER BY seq LIMIT ?').all(from, limit);
    const errors = [];
    let prev = from > 1 ? this.db.prepare('SELECT entry_hash FROM ledger WHERE seq = ?').get(from - 1)?.entry_hash : GENESIS_HASH;
    for (const r of rows) {
      if (r.prev_hash !== prev) errors.push({ seq: r.seq, error: 'prev_hash mismatch' });
      const eh = sha256(`${r.seq}|${r.kind}|${r.ref}|${r.content_hash}|${r.received_ms}|${r.prev_hash}`);
      if (eh !== r.entry_hash) errors.push({ seq: r.seq, error: 'entry_hash mismatch' });
      if (!this.verifyServer(r.entry_hash, r.server_sig)) errors.push({ seq: r.seq, error: 'server signature invalid' });
      const rec = this.db.prepare('SELECT record, content_hash FROM records WHERE ledger_seq = ?').get(r.seq);
      if (!rec) errors.push({ seq: r.seq, error: 'ledger entry has no record' });
      else if (sha256(canonicalize(JSON.parse(rec.record))) !== r.content_hash) errors.push({ seq: r.seq, error: 'record content does not match ledger hash' });
      prev = r.entry_hash;
    }
    return { ok: errors.length === 0, checked: rows.length, head: rows.at(-1)?.entry_hash ?? prev, errors };
  }

  async verifyAllSignatures() {
    const rows = this.db.prepare('SELECT * FROM records ORDER BY ledger_seq').all();
    const bad = [];
    for (const r of rows) if (!(await verifyRecordSignature(JSON.parse(r.record), r.signature))) bad.push(r.id);
    return { checked: rows.length, bad };
  }

  anchor(external_ref = null) {
    const h = this.head();
    const last = this.db.prepare('SELECT * FROM anchors ORDER BY id DESC LIMIT 1').get();
    if (last && last.head_seq === h.seq && !external_ref) return last;
    const ts_ms = Date.now();
    const server_sig = this.signServer(sha256(`anchor|${h.seq}|${h.entry_hash}|${ts_ms}`));
    this.db.prepare('INSERT INTO anchors (head_seq, head_hash, ts_ms, server_sig, external_ref) VALUES (?,?,?,?,?)').run(h.seq, h.entry_hash, ts_ms, server_sig, external_ref);
    return this.db.prepare('SELECT * FROM anchors ORDER BY id DESC LIMIT 1').get();
  }
  anchors() { return this.db.prepare('SELECT * FROM anchors ORDER BY id DESC LIMIT 50').all(); }

  stats() {
    const q = (sql, ...a) => this.db.prepare(sql).get(...a);
    return {
      records: q('SELECT COUNT(*) n FROM records').n,
      observations: q("SELECT COUNT(*) n FROM records WHERE kind='observation'").n,
      observers: q("SELECT COUNT(DISTINCT observer_id) n FROM records WHERE kind='observation'").n,
      real_observations: q("SELECT COUNT(*) n FROM records WHERE kind='observation' AND synthetic=0").n,
      real_observers: q("SELECT COUNT(DISTINCT observer_id) n FROM records WHERE kind='observation' AND synthetic=0").n,
      head: this.head(),
    };
  }
}

export { observerName };
