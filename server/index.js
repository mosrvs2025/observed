// OBSERVED server — zero dependencies. Static front-end + JSON API + SSE live stream.

import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { seedIfEmpty } from './seed.js';
import { validateRecord, CHALLENGE_TYPES } from './validate.js';
import { verifyRecordSignature, hashRecord } from '../public/shared/canonical.js';
import { EXPERIMENTS, PROPOSED } from '../public/shared/experiments.js';
import { FAMILIES, predictWith } from '../public/shared/models.js';
import { analyze, reduceShadow, reduceSunset, challengeSensitivity, DEFAULT_OPTS } from '../public/shared/analysis.js';
import { sunPosition, elevationAngle } from '../public/shared/sun.js';
import { observerName } from '../public/shared/names.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = process.env.OBSERVED_DATA || join(ROOT, 'data');
const PORT = Number(process.env.PORT || 3000);

export async function createServer({ dataDir = DATA, seed = process.env.OBSERVED_SEED !== '0' } = {}) {
  const store = new Store(dataDir);
  const mediaDir = join(dataDir, 'media');
  await mkdir(mediaDir, { recursive: true });
  const protocolHashes = {};
  for (const [slug, def] of Object.entries(EXPERIMENTS)) protocolHashes[slug] = (await hashRecord(def)).slice(0, 16);
  if (seed) await seedIfEmpty(store);
  store.anchor();

  // ── SSE ──
  const streams = new Set();
  store.listeners.add((kind, id, rec, receipt) => {
    const msg = JSON.stringify({ kind, id, experiment: rec.experiment ?? null, observer_id: rec.observer.id, synthetic: !!rec.synthetic, captured_ms: rec.captured_ms ?? null, lat: rec.location?.lat ?? null, lon: rec.location?.lon ?? null, outcome: rec.outcome ?? null, ledger_seq: receipt.ledger_seq });
    for (const res of streams) res.write(`event: record\ndata: ${msg}\n\n`);
  });

  // ── rate limiting (per IP, per minute) ──
  const hits = new Map();
  const limited = (ip, max = 90) => {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
    arr.push(now); hits.set(ip, arr);
    return arr.length > max;
  };

  const pub = (row) => ({ id: row.id, observer: { id: row.observer_id, name: row.record.observer.name || observerName(row.observer_id) }, received_ms: row.received_ms, ledger_seq: row.ledger_seq, content_hash: row.content_hash, synthetic: row.synthetic });

  function observationView(row) {
    const eff = store.effective(row);
    return { ...pub(row), experiment: row.experiment, captured_ms: row.record.captured_ms, record: eff.record, original: eff.amendments.length ? row.record : null, amendments: eff.amendments.map((a) => ({ ...pub(a), changes: a.record.changes, reason: a.record.reason })), signature: row.signature };
  }

  function experimentSummary(slug) {
    const def = EXPERIMENTS[slug];
    const rows = store.list('observation', slug, { limit: 100000 });
    const measured = rows.filter((r) => store.effective(r).record.outcome === 'measured');
    const observers = new Set(measured.map((r) => r.observer_id));
    const real = measured.filter((r) => !r.synthetic);
    const challenges = store.challengesFor(slug);
    const lats = measured.map((r) => r.record.location.lat), lons = measured.map((r) => r.record.location.lon);
    return {
      slug, title: def.title, kicker: def.kicker, question: def.question, summary: def.summary, version: def.version, protocol_hash: protocolHashes[slug], tags: def.tags,
      counts: { measured: measured.length, failed: rows.length - measured.length, observers: observers.size, real: real.length, real_observers: new Set(real.map((r) => r.observer_id)).size, models: store.list('model', slug).length, open_challenges: challenges.filter((c) => c.status === 'open').length, upheld_challenges: challenges.filter((c) => c.status === 'upheld').length, intents: store.db.prepare('SELECT COUNT(*) n FROM intents WHERE experiment = ?').get(slug).n },
      span: measured.length ? { lat: [Math.min(...lats), Math.max(...lats)], lon: [Math.min(...lons), Math.max(...lons)] } : null,
      last_ms: rows.at(-1)?.received_ms ?? null,
    };
  }

  function trustSignals(view, row) {
    const r = view.record, d = r.device || {}, loc = r.location;
    const lag = row.received_ms - r.captured_ms;
    const t = r.captured_ms - (d.clock_offset_ms || 0);
    const out = [];
    out.push({ key: 'signed', ok: true, label: 'Signed by device key', detail: `Verified at receipt · observer ${row.observer_id}` });
    out.push({ key: 'ledger', ok: true, label: 'In the hash-chained ledger', detail: `Entry #${row.ledger_seq}` });
    out.push({ key: 'gps', ok: loc.source === 'gps' && (loc.accuracy_m ?? 1e9) <= 50, label: loc.source === 'gps' ? `GPS accuracy ±${Math.round(loc.accuracy_m ?? 0)} m` : 'Position entered by hand', detail: loc.source === 'gps' ? ((loc.accuracy_m ?? 0) <= 50 ? 'Good fix' : 'Weak fix — fine for a shadow, poor for fine geometry') : 'Unverifiable; shown as lower trust' });
    out.push({ key: 'clock', ok: d.clock_offset_ms != null && Math.abs(d.clock_offset_ms) < 2000, label: d.clock_offset_ms != null ? `Phone clock ${d.clock_offset_ms >= 0 ? '+' : ''}${d.clock_offset_ms} ms vs server` : 'Clock not checked', detail: d.clock_offset_ms != null ? `Measured by handshake (RTT ${d.clock_rtt_ms ?? '?'} ms) and corrected` : 'Times taken at face value' });
    out.push({ key: 'sensors', ok: !!(d.sensors?.level || d.sensors?.compass), label: d.sensors?.level || d.sensors?.compass ? 'Phone sensors used (level / compass)' : 'No sensor assist', detail: 'Tilt and heading come from the device, not typed in' });
    out.push({ key: 'photo', ok: (r.media?.length || 0) > 0, label: (r.media?.length || 0) ? `${r.media.length} photo hash${r.media.length > 1 ? 'es' : ''} bound to the record` : 'No photo attached', detail: 'A photo lets anyone inspect the shadow themselves' });
    out.push({ key: 'lag', ok: lag < 15 * 60000, label: lag < 15 * 60000 ? 'Submitted live' : `Uploaded ${humanDur(lag)} after capture`, detail: lag < 15 * 60000 ? 'Captured and sealed in one session' : 'Offline / delayed capture — the capture time is self-reported' });
    if (r.outcome === 'measured' && r.experiment === 'shadow-angle') {
      const el = elevationAngle(loc.lat, loc.lon, t);
      out.push({ key: 'plausible', ok: el > 0, label: el > 0 ? 'Sun was above the horizon there' : 'Implausible: Sun below horizon at that place and time', detail: `Ephemeris elevation ${el.toFixed(1)}° at capture (a plausibility check only)` });
    }
    return out;
  }

  function observationDetail(id) {
    const row = store.row(id);
    if (!row || row.kind !== 'observation') return null;
    const view = observationView(row);
    const slug = row.experiment;
    const input = store.analysisInput(slug);
    const o = input.observations.find((x) => x.id === id);
    const reduce = slug === 'shadow-angle' ? reduceShadow : reduceSunset;
    const derived = o ? reduce(o) : null;
    let predictions = [];
    if (derived) {
      predictions = input.models.map((m) => {
        const ctx = { lat: derived.lat, lon: derived.lon, t: derived.t, eye_m: derived.eye_m };
        const p = predictWith(m, ctx);
        const pv = slug === 'shadow-angle' ? p.zenith_deg : p.sunset_ms;
        const diff = slug === 'shadow-angle' ? derived.value - pv : pv == null ? null : (derived.t - pv) / 1000;
        return { model_id: m.id, name: m.name, family: m.family, params: m.params, predicted: pv, residual: diff, registered_ms: m.registered_ms, blind: row.received_ms > m.registered_ms };
      });
    }
    const challenges = store.challengesFor(slug).filter((c) => c.target.type === 'observation' && c.target.id === id).map((c) => ({ id: c.id, observer: { id: c.observer_id, name: c.record.observer.name || observerName(c.observer_id) }, type: c.challenge_type, type_label: CHALLENGE_TYPES[c.challenge_type].label, body: c.record.body, effect: c.effect, status: c.status, support: c.support, dispute: c.dispute, concession: c.concession, votes: c.votes, received_ms: c.received_ms, ledger_seq: c.ledger_seq, sensitivity: c.effect.kind === 'note' ? null : challengeSensitivity(slug, { ...input, opts: DEFAULT_OPTS }, { target: c.target, effect: c.effect }) }));
    const reps = store.byTarget('observation', id).map((r) => ({ ...pub(r), captured_ms: r.record.captured_ms, lat: r.record.location.lat, lon: r.record.location.lon }));
    const full = analyze(slug, { ...input, opts: { ...DEFAULT_OPTS, bootstrapN: 50 } });
    const links = full.links.filter((l) => l.original === id || l.replication === id);
    let prediction = null;
    if (row.record.prediction_id) {
      const p = store.row(row.record.prediction_id);
      if (p) prediction = { id: p.id, value: p.record.value, made_ms: p.record.made_ms, received_ms: p.received_ms, ledger_seq: p.ledger_seq, content_hash: p.content_hash, preregistered: p.received_ms <= row.record.captured_ms - (row.record.device?.clock_offset_ms || 0) + 5000, note: p.record.note || '' };
    }
    return {
      observation: view, derived, predictions, challenges, replications: reps, links, prediction,
      trust: trustSignals(view, row), receipt: store.receiptFor(id),
      intents: store.db.prepare('SELECT COUNT(*) n FROM intents WHERE target = ?').get(id).n,
      sun: derived ? sunPosition(derived.t) : null,
    };
  }

  // ── POST handlers ──
  async function submit(kind, body, ip) {
    if (!body || typeof body.record !== 'object' || typeof body.signature !== 'string') return [400, { error: 'expected {record, signature}' }];
    const err = await validateRecord(kind, body.record);
    if (err) return [422, { error: err }];
    if (!(await verifyRecordSignature(body.record, body.signature))) return [401, { error: 'signature does not verify against observer.key' }];
    const r = body.record;
    if (kind === 'observation') {
      if (r.protocol.hash !== protocolHashes[r.experiment]) return [422, { error: 'protocol hash mismatch — reload the app to get the current protocol' }];
      if (r.prediction_id) {
        const p = store.row(r.prediction_id);
        if (!p || p.kind !== 'prediction' || p.observer_id !== r.observer.id || p.experiment !== r.experiment) return [422, { error: 'prediction_id must be your own earlier prediction for this experiment' }];
      }
      if (r.replicates) {
        const o = store.row(r.replicates);
        if (!o || o.kind !== 'observation' || o.experiment !== r.experiment) return [422, { error: 'replicates must reference an existing observation of this experiment' }];
        if (store.effective(o).record.outcome !== 'measured') return [422, { error: 'cannot replicate a failed attempt' }];
      }
    }
    if (kind === 'challenge') {
      if (r.target.type === 'observation') { const o = store.row(r.target.id); if (!o || o.experiment !== r.experiment) return [422, { error: 'target observation not found in this experiment' }]; }
      if (r.target.type === 'model') { const m = store.row(r.target.id); if (!m || m.kind !== 'model' || m.experiment !== r.experiment) return [422, { error: 'target model not found' }]; }
    }
    if (kind === 'vote') {
      const c = store.row(r.challenge_id);
      if (!c || c.kind !== 'challenge') return [422, { error: 'challenge not found' }];
      if (c.observer_id === r.observer.id) return [422, { error: 'you cannot vote on your own challenge' }];
      if (!store.hasMeasured(r.observer.id, c.experiment)) return [403, { error: 'only observers who have submitted an observation to this experiment can vote on its challenges' }];
    }
    if (kind === 'amendment') {
      const o = store.row(r.obs_id);
      if (!o || o.kind !== 'observation') return [422, { error: 'observation not found' }];
      if (o.observer_id !== r.observer.id) return [403, { error: 'only the original observer can amend; everyone else should file a challenge' }];
      if (store.effective(o).record.outcome !== 'measured') return [422, { error: 'only measured observations can be amended' }];
      const e = EXPERIMENTS[o.experiment];
      const err2 = (await import('./validate.js')).observationMeasurements(o.experiment, { ...o.record.measurements, ...r.changes.measurements }, o.record.captured_ms);
      if (err2) return [422, { error: 'amended measurements invalid: ' + err2 }];
      if (!e) return [422, { error: 'unknown experiment' }];
    }
    if (kind === 'prediction' || kind === 'model') { /* validated above */ }
    const receipt = store.append(kind, r, body.signature);
    return [receipt.duplicate ? 200 : 201, receipt];
  }

  const KIND_ROUTES = { '/api/observations': 'observation', '/api/predictions': 'prediction', '/api/models': 'model', '/api/challenges': 'challenge', '/api/votes': 'vote', '/api/amendments': 'amendment' };

  // ── HTTP plumbing ──
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
  const SEC = {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(self), camera=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self), microphone=()',
  };
  const send = (res, code, body, headers = {}) => { res.writeHead(code, { ...SEC, ...headers }); res.end(body); };
  const json = (res, code, obj, headers = {}) => send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

  async function readBody(req, max) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error('payload too large'), { status: 413 }); chunks.push(c); }
    return Buffer.concat(chunks);
  }

  async function serveStatic(res, pathname) {
    let rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    if (rel === '/' || rel === '\\') rel = '/index.html';
    const file = resolve(join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden');
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error('nf');
      const ext = extname(file);
      const immutable = ext === '.woff2' || file.includes('/data/');
      send(res, 200, await readFile(file), { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    } catch {
      send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
    }
  }

  const server = http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress || 'x';
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (!p.startsWith('/api/')) return await serveStatic(res, p);

      if (req.method === 'POST') {
        if (limited(ip)) return json(res, 429, { error: 'slow down' });
        if (p === '/api/media') {
          const buf = await readBody(req, 2.5 * 1024 * 1024);
          const mime = buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'image/jpeg' : buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'image/png' : null;
          if (!mime) return json(res, 415, { error: 'only JPEG or PNG' });
          const sha256 = createHash('sha256').update(buf).digest('hex');
          const f = join(mediaDir, sha256);
          if (!existsSync(f)) { await writeFile(f, buf); await writeFile(f + '.mime', mime); }
          return json(res, 201, { sha256, mime, bytes: buf.length });
        }
        const body = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8') || 'null');
        if (KIND_ROUTES[p]) { const [code, out] = await submit(KIND_ROUTES[p], body, ip); return json(res, code, out); }
        if (p === '/api/intents') {
          if (!EXPERIMENTS[body?.experiment] || !/^[0-9a-f]{12}$/.test(body?.observer_id || '')) return json(res, 422, { error: 'bad intent' });
          const tgt = body.target ?? body.experiment;
          if (body.target && !store.row(body.target)) return json(res, 422, { error: 'unknown target' });
          store.db.prepare('INSERT OR IGNORE INTO intents (experiment, target, observer_id, ts_ms) VALUES (?,?,?,?)').run(body.experiment, tgt, body.observer_id, Date.now());
          return json(res, 201, { ok: true, count: store.db.prepare('SELECT COUNT(*) n FROM intents WHERE target = ?').get(tgt).n });
        }
        if (p === '/api/interest') {
          if (!PROPOSED.some((x) => x.slug === body?.experiment) || !/^[0-9a-f]{12}$/.test(body?.observer_id || '')) return json(res, 422, { error: 'bad interest' });
          store.db.prepare('INSERT OR IGNORE INTO interest (experiment, observer_id, ts_ms) VALUES (?,?,?)').run(body.experiment, body.observer_id, Date.now());
          return json(res, 201, { ok: true });
        }
        return json(res, 404, { error: 'not found' });
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });

      if (p === '/api/time') return json(res, 200, { now_ms: Date.now() });
      if (p === '/api/overview') {
        const interest = Object.fromEntries(store.db.prepare('SELECT experiment, COUNT(*) n FROM interest GROUP BY experiment').all().map((r) => [r.experiment, r.n]));
        return json(res, 200, { stats: store.stats(), experiments: Object.keys(EXPERIMENTS).map(experimentSummary), proposed: PROPOSED.map((x) => ({ ...x, interest: interest[x.slug] || 0 })), server_time: Date.now() });
      }
      let m;
      if ((m = p.match(/^\/api\/experiments\/([\w-]+)$/))) {
        const def = EXPERIMENTS[m[1]];
        if (!def) return json(res, 404, { error: 'unknown experiment' });
        return json(res, 200, { ...def, protocol_hash: protocolHashes[m[1]], summary_stats: experimentSummary(m[1]), families: Object.fromEntries(Object.entries(FAMILIES).filter(([, f]) => f.experiments.includes(m[1])).map(([k, f]) => [k, { name: f.name, short: f.short, blurb: f.blurb, params: f.params }])), challenge_types: CHALLENGE_TYPES });
      }
      if ((m = p.match(/^\/api\/experiments\/([\w-]+)\/data$/))) {
        if (!EXPERIMENTS[m[1]]) return json(res, 404, { error: 'unknown experiment' });
        const input = store.analysisInput(m[1]);
        const origMap = new Map(store.list('observation', m[1], { limit: 1e6 }).map((r) => [r.id, r]));
        return json(res, 200, {
          observations: input.observations.map((o) => { const r = origMap.get(o.id); return { id: o.id, observer_id: o.observer_id, received_ms: o.received_ms, synthetic: o.synthetic, record: o.record, replicates: o.replicates, adj: o.adj, amended: JSON.stringify(o.record.measurements) !== JSON.stringify(r.record.measurements), ledger_seq: r.ledger_seq, content_hash: r.content_hash }; }),
          attempts: input.attempts.map((o) => ({ id: o.id, observer_id: o.observer_id, received_ms: o.received_ms, synthetic: o.synthetic, record: o.record })),
          models: input.models,
          challenges: input.challenges.map((c) => ({ id: c.id, observer_id: c.observer_id, observer_name: c.record.observer.name || observerName(c.observer_id), type: c.challenge_type, type_label: CHALLENGE_TYPES[c.challenge_type].label, target: c.target, body: c.record.body, effect: c.effect, status: c.status, support: c.support, dispute: c.dispute, concession: c.concession, received_ms: c.received_ms, ledger_seq: c.ledger_seq, synthetic: c.synthetic })),
        });
      }
      if ((m = p.match(/^\/api\/experiments\/([\w-]+)\/analysis$/))) {
        if (!EXPERIMENTS[m[1]]) return json(res, 404, { error: 'unknown experiment' });
        const q = url.searchParams;
        const opts = {};
        if (q.has('sigmaSys')) opts.sigmaSys = Math.min(5, Math.max(0, Number(q.get('sigmaSys'))));
        if (q.has('sigmaSysSec')) opts.sigmaSysSec = Math.min(600, Math.max(0, Number(q.get('sigmaSysSec'))));
        if (q.has('includeSynthetic')) opts.includeSynthetic = q.get('includeSynthetic') !== '0';
        if (q.has('challengeMode') && ['upheld', 'none', 'all'].includes(q.get('challengeMode'))) opts.challengeMode = q.get('challengeMode');
        const input = store.analysisInput(m[1]);
        const a = analyze(m[1], { ...input, opts });
        a.derived = a.derived.map(({ adj, ...d }) => d);
        a.score.perModel.forEach((pm) => { pm.points = pm.points.slice(0, 5000); });
        return json(res, 200, a);
      }
      if ((m = p.match(/^\/api\/observations\/(obs_[0-9a-f]{12})$/))) {
        const d = observationDetail(m[1]);
        return d ? json(res, 200, d) : json(res, 404, { error: 'not found' });
      }
      if ((m = p.match(/^\/api\/observers\/([0-9a-f]{12})$/))) {
        const rows = store.db.prepare("SELECT id FROM records WHERE kind='observation' AND observer_id = ? ORDER BY ledger_seq DESC").all(m[1]).map((r) => observationView(store.row(r.id)));
        return json(res, 200, { id: m[1], name: observerName(m[1]), observations: rows, predictions: store.db.prepare("SELECT COUNT(*) n FROM records WHERE kind='prediction' AND observer_id = ?").get(m[1]).n });
      }
      if ((m = p.match(/^\/api\/predictions\/(prd_[0-9a-f]{12})$/))) {
        const r = store.row(m[1]);
        return r ? json(res, 200, { ...pub(r), record: r.record, signature: r.signature, receipt: store.receiptFor(r.id) }) : json(res, 404, { error: 'not found' });
      }
      if (p === '/api/ledger/head') return json(res, 200, { ...store.head(), server_key: store.publicJwk });
      if (p === '/api/ledger/verify') {
        const chain = store.verifyChain();
        const sigs = await store.verifyAllSignatures();
        return json(res, 200, { chain, signatures: sigs, ok: chain.ok && sigs.bad.length === 0, verified_ms: Date.now() });
      }
      if (p === '/api/ledger') {
        const limit = Math.min(200, Number(url.searchParams.get('limit') || 50));
        const before = Number(url.searchParams.get('before') || 1e12);
        const rows = store.db.prepare('SELECT * FROM ledger WHERE seq < ? ORDER BY seq DESC LIMIT ?').all(before, limit);
        return json(res, 200, { head: store.head(), entries: rows.map((e) => { const r = store.row(e.ref); return { ...e, synthetic: r?.synthetic ?? false, experiment: r?.experiment ?? null, observer_id: r?.observer_id ?? null }; }) });
      }
      if (p === '/api/ledger/range') { // for client-side chain verification
        const from = Number(url.searchParams.get('from') || 1), limit = Math.min(1000, Number(url.searchParams.get('limit') || 500));
        return json(res, 200, { entries: store.db.prepare('SELECT seq, kind, ref, content_hash, received_ms, prev_hash, entry_hash, server_sig FROM ledger WHERE seq >= ? ORDER BY seq LIMIT ?').all(from, limit) });
      }
      if (p === '/api/anchors') return json(res, 200, { anchors: store.anchors(), server_key: store.publicJwk });
      if ((m = p.match(/^\/api\/export\/([\w-]+)$/))) {
        if (!EXPERIMENTS[m[1]]) return json(res, 404, { error: 'unknown experiment' });
        const records = ['model', 'prediction', 'observation', 'amendment', 'challenge', 'vote'].flatMap((k) => (k === 'amendment' || k === 'vote' ? store.list(k, null) : store.list(k, m[1]))).filter((r) => r.experiment === m[1] || r.experiment == null).map((r) => ({ id: r.id, kind: r.kind, record: r.record, signature: r.signature, receipt: store.receiptFor(r.id) }));
        return json(res, 200, { experiment: m[1], protocol_hash: protocolHashes[m[1]], exported_ms: Date.now(), server_key: store.publicJwk, how_to_verify: 'sha256(canonical_json(record)) must equal receipt.content_hash; verify record.observer.key ECDSA P-256 signature over canonical_json(record); chain entry_hash = sha256(seq|kind|ref|content_hash|received_ms|prev_hash). See /method.', records }, { 'Content-Disposition': `attachment; filename="observed-${m[1]}.json"` });
      }
      if ((m = p.match(/^\/api\/media\/([0-9a-f]{64})$/))) {
        try {
          const mime = (await readFile(join(mediaDir, m[1] + '.mime'), 'utf8')).trim();
          return send(res, 200, await readFile(join(mediaDir, m[1])), { 'Content-Type': mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
        } catch { return json(res, 404, { error: 'not found' }); }
      }
      if (p === '/api/stream') {
        res.writeHead(200, { ...SEC, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write('retry: 3000\n\n');
        streams.add(res);
        const ka = setInterval(() => res.write(': ka\n\n'), 25000);
        req.on('close', () => { clearInterval(ka); streams.delete(res); });
        return;
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof SyntaxError) return json(res, 400, { error: 'invalid JSON' });
      if (e.status) return json(res, e.status, { error: e.message });
      console.error(e);
      return json(res, 500, { error: 'internal error' });
    }
  });

  const anchorTimer = setInterval(() => store.anchor(), 6 * 3600 * 1000);
  anchorTimer.unref();
  return { server, store, close: () => { clearInterval(anchorTimer); for (const r of streams) r.end(); server.close(); } };
}

function humanDur(ms) {
  const m = Math.round(ms / 60000);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = await createServer();
  server.listen(PORT, () => console.log(`OBSERVED listening on http://localhost:${PORT}`));
}
