// Strict validation of signed records. Unknown keys are rejected so a canonical record means one thing.

import { EXPERIMENTS } from '../public/shared/experiments.js';
import { FAMILIES, validateModelParams } from '../public/shared/models.js';
import { observerIdFromKey } from '../public/shared/canonical.js';
import { validLatLon } from '../public/shared/geo.js';

const HEX64 = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/;

export const CHALLENGE_TYPES = {
  incorrect_measurement: { label: 'Incorrect measurement', blurb: 'The stick wasn’t vertical, the tip was misread, the units were mixed up…', defaultEffect: { kind: 'inflate', factor: 3 }, targets: ['observation'] },
  poor_gps: { label: 'Poor GPS / position', blurb: 'Reported position is too uncertain or implausible for this claim.', defaultEffect: { kind: 'inflate', factor: 1.5 }, targets: ['observation'] },
  refraction: { label: 'Atmospheric refraction not considered', blurb: 'The Sun/horizon is low enough that refraction could change the result.', defaultEffect: { kind: 'inflate', factor: 2 }, targets: ['observation', 'model'] },
  unclear_horizon: { label: 'Unclear horizon', blurb: 'Hills, buildings, haze or cloud bank hide the true horizon.', defaultEffect: { kind: 'inflate', factor: 2 }, targets: ['observation'] },
  time_unsynchronized: { label: 'Clock not synchronised', blurb: 'The recorded time is unreliable.', defaultEffect: { kind: 'inflate', factor: 2 }, targets: ['observation'] },
  wrong_calculation: { label: 'Wrong calculation', blurb: 'The analysis step is mathematically or logically incorrect.', defaultEffect: { kind: 'note' }, targets: ['experiment', 'model'] },
  alternative_hypothesis: { label: 'Alternative hypothesis', blurb: 'A different model explains the data and should be registered and tested.', defaultEffect: { kind: 'note' }, targets: ['experiment', 'model'] },
  insufficient_evidence: { label: 'Insufficient evidence', blurb: 'The data can’t support the stated confidence.', defaultEffect: { kind: 'note' }, targets: ['experiment', 'observation'] },
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v, max = 200) => typeof v === 'string' && v.length <= max;
const opt = (v, f) => v === null || v === undefined || f(v);
const keysOk = (obj, allowed) => obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).every((k) => allowed.includes(k));

async function checkObserver(rec, now) {
  const o = rec.observer;
  if (!keysOk(o, ['key', 'id', 'name']) || !KEY.test(o.key || '')) return 'observer.key must be an ECDSA P-256 public key (x.y)';
  if ((await observerIdFromKey(o.key)) !== o.id) return 'observer.id does not match key';
  if (!opt(o.name, (n) => isStr(n, 24))) return 'observer.name too long';
  return null;
}

export async function validateRecord(kind, rec, now = Date.now()) {
  if (!rec || typeof rec !== 'object' || rec.v !== 1 || rec.kind !== kind) return 'bad record envelope';
  const bad = await checkObserver(rec, now);
  if (bad) return bad;
  // `synthetic: true` is allowed on every kind (simulated demo data) and lives inside the signed record.
  const { synthetic, ...rest } = rec;
  if (synthetic !== undefined && synthetic !== true) return 'bad synthetic flag';
  return validators[kind]?.(rest, now) ?? 'unknown kind';
}

function checkLocation(l, requireAcc = true) {
  if (!keysOk(l, ['lat', 'lon', 'alt_m', 'accuracy_m', 'alt_accuracy_m', 'source', 'rounding_deg'])) return 'bad location';
  if (!isNum(l.lat) || !isNum(l.lon) || !validLatLon(l.lat, l.lon)) return 'invalid lat/lon';
  if (!opt(l.alt_m, (v) => isNum(v) && v > -500 && v < 9000)) return 'invalid altitude';
  if (!opt(l.accuracy_m, (v) => isNum(v) && v >= 0 && v < 1e6)) return 'invalid accuracy';
  if (!['gps', 'manual', 'map'].includes(l.source)) return 'invalid location source';
  if (!opt(l.rounding_deg, (v) => [0.001, 0.01, 0.1, 1].includes(v))) return 'invalid rounding';
  return null;
}

const validators = {
  async observation(r, now) {
    const exp = EXPERIMENTS[r.experiment];
    if (!exp) return 'unknown experiment';
    if (!keysOk(r, ['v', 'kind', 'experiment', 'protocol', 'observer', 'captured_ms', 'outcome', 'failure_reason', 'location', 'measurements', 'device', 'media', 'prediction_id', 'replicates', 'notes'])) return 'unknown fields in observation';
    if (!keysOk(r.protocol, ['version', 'hash']) || r.protocol.version !== exp.version) return 'protocol version mismatch';
    if (!isNum(r.captured_ms) || r.captured_ms > now + 120000 || r.captured_ms < now - 30 * 86400000) return 'captured_ms outside accepted window (30 days back, 2 min ahead)';
    if (!['measured', 'failed'].includes(r.outcome)) return 'invalid outcome';
    const loc = checkLocation(r.location);
    if (loc) return loc;
    if (!isStr(r.notes ?? '', 500)) return 'notes too long';
    if (!opt(r.prediction_id, (v) => /^prd_[0-9a-f]{12}$/.test(v))) return 'bad prediction_id';
    if (!opt(r.replicates, (v) => /^obs_[0-9a-f]{12}$/.test(v))) return 'bad replicates id';
    const d = r.device;
    if (!keysOk(d, ['ua', 'platform', 'sensors', 'clock_offset_ms', 'clock_rtt_ms', 'app_version'])) return 'bad device';
    if (!isStr(d.ua ?? '', 300) || !isStr(d.platform ?? '', 80)) return 'device strings too long';
    if (!opt(d.clock_offset_ms, (v) => isNum(v) && Math.abs(v) < 3600000 * 24)) return 'bad clock offset';
    if (!opt(d.clock_rtt_ms, (v) => isNum(v) && v >= 0 && v < 60000)) return 'bad rtt';
    if (!opt(d.sensors, (s) => keysOk(s, ['geolocation', 'orientation', 'camera', 'compass', 'level']) && Object.values(s).every((x) => typeof x === 'boolean'))) return 'bad sensors';
    if (!Array.isArray(r.media ?? []) || (r.media ?? []).length > 4) return 'too many media';
    for (const m of r.media ?? []) if (!keysOk(m, ['sha256', 'mime', 'bytes']) || !HEX64.test(m.sha256) || !['image/jpeg', 'image/png'].includes(m.mime) || !isNum(m.bytes)) return 'bad media entry';
    if (r.outcome === 'failed') {
      if (!isStr(r.failure_reason || '', 200) || !r.failure_reason) return 'failure_reason required';
      if (r.measurements && Object.keys(r.measurements).length) return 'failed attempts carry no measurements';
      return null;
    }
    return observationMeasurements(r.experiment, r.measurements, r.captured_ms);
  },

  async prediction(r, now) {
    if (!EXPERIMENTS[r.experiment]) return 'unknown experiment';
    if (!keysOk(r, ['v', 'kind', 'experiment', 'observer', 'made_ms', 'location', 'value', 'note'])) return 'unknown fields in prediction';
    if (!isNum(r.made_ms) || Math.abs(r.made_ms - now) > 10 * 60000) return 'made_ms must be within 10 minutes of server time';
    const loc = checkLocation(r.location);
    if (loc) return loc;
    if (r.experiment === 'shadow-angle') {
      if (!keysOk(r.value, ['zenith_deg']) || !isNum(r.value.zenith_deg) || r.value.zenith_deg < 0 || r.value.zenith_deg > 95) return 'zenith_deg must be 0–95';
    } else if (r.experiment === 'sunset-sync') {
      if (!keysOk(r.value, ['sunset_ms']) || !isNum(r.value.sunset_ms) || Math.abs(r.value.sunset_ms - now) > 36 * 3600000) return 'sunset_ms must be within 36 h';
    }
    if (!isStr(r.note ?? '', 300)) return 'note too long';
    return null;
  },

  async model(r, now) {
    if (!EXPERIMENTS[r.experiment]) return 'unknown experiment';
    if (!keysOk(r, ['v', 'kind', 'experiment', 'observer', 'made_ms', 'family', 'params', 'name', 'rationale'])) return 'unknown fields in model';
    if (!isNum(r.made_ms) || Math.abs(r.made_ms - now) > 10 * 60000) return 'made_ms must be within 10 minutes of server time';
    if (!FAMILIES[r.family]?.experiments.includes(r.experiment)) return 'family not valid for this experiment';
    const p = validateModelParams(r.family, r.params);
    if (typeof p === 'string') return p;
    if (JSON.stringify(Object.keys(p.ok).sort()) !== JSON.stringify(Object.keys(r.params).sort())) return 'unexpected params';
    if (!isStr(r.name, 60) || r.name.length < 3) return 'name must be 3–60 characters';
    if (!isStr(r.rationale ?? '', 600)) return 'rationale too long';
    return null;
  },

  async challenge(r) {
    if (!EXPERIMENTS[r.experiment]) return 'unknown experiment';
    if (!keysOk(r, ['v', 'kind', 'experiment', 'observer', 'made_ms', 'target', 'challenge_type', 'body', 'effect'])) return 'unknown fields in challenge';
    const ct = CHALLENGE_TYPES[r.challenge_type];
    if (!ct) return 'unknown challenge type';
    if (!keysOk(r.target, ['type', 'id']) || !ct.targets.includes(r.target.type)) return 'challenge type does not apply to this target';
    if (r.target.type === 'observation' && !/^obs_[0-9a-f]{12}$/.test(r.target.id)) return 'bad target id';
    if (r.target.type === 'model' && !/^mdl_[0-9a-f]{12}$/.test(r.target.id)) return 'bad target id';
    if (r.target.type === 'experiment' && r.target.id !== r.experiment) return 'bad target id';
    if (!isStr(r.body, 1200) || r.body.trim().length < 20) return 'explain the challenge in at least 20 characters';
    const e = r.effect;
    if (!keysOk(e, ['kind', 'factor']) || !['exclude', 'inflate', 'note'].includes(e.kind)) return 'bad effect';
    if (e.kind === 'inflate' && !(isNum(e.factor) && e.factor >= 1.2 && e.factor <= 10)) return 'inflate factor must be 1.2–10';
    if (e.kind !== 'note' && r.target.type !== 'observation') return 'only observations can be down-weighted';
    return null;
  },

  async vote(r) {
    if (!keysOk(r, ['v', 'kind', 'observer', 'made_ms', 'challenge_id', 'stance', 'note'])) return 'unknown fields in vote';
    if (!/^chl_[0-9a-f]{12}$/.test(r.challenge_id)) return 'bad challenge id';
    if (!['support', 'dispute'].includes(r.stance)) return 'bad stance';
    if (!isStr(r.note ?? '', 300)) return 'note too long';
    return null;
  },

  async amendment(r) {
    if (!keysOk(r, ['v', 'kind', 'observer', 'made_ms', 'obs_id', 'changes', 'reason'])) return 'unknown fields in amendment';
    if (!/^obs_[0-9a-f]{12}$/.test(r.obs_id)) return 'bad obs id';
    if (!keysOk(r.changes, ['measurements']) || !r.changes.measurements || typeof r.changes.measurements !== 'object') return 'amendments may only change measurements';
    if (!isStr(r.reason, 400) || r.reason.trim().length < 10) return 'give a reason (≥ 10 characters)';
    return null;
  },
};

function observationMeasurements(exp, m, capturedMs) {
  if (exp === 'shadow-angle') {
    if (!keysOk(m, ['stick_cm', 'shadow_cm', 'shadow_dir', 'tilt_deg', 'heading_deg'])) return 'bad shadow measurements';
    if (!isNum(m.stick_cm) || m.stick_cm < 10 || m.stick_cm > 1000) return 'stick_cm must be 10–1000';
    if (!isNum(m.shadow_cm) || m.shadow_cm < 0 || m.shadow_cm > 60 * m.stick_cm) return 'shadow_cm implausible for this stick';
    if (!['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].includes(m.shadow_dir)) return 'shadow_dir must be a compass point';
    if (!opt(m.tilt_deg, (v) => isNum(v) && v >= 0 && v <= 45)) return 'tilt_deg 0–45';
    if (!opt(m.heading_deg, (v) => isNum(v) && v >= 0 && v < 360)) return 'heading_deg 0–360';
    return null;
  }
  if (exp === 'sunset-sync') {
    if (!keysOk(m, ['sunset_ms', 'eye_height_m', 'horizon', 'sky'])) return 'bad sunset measurements';
    if (!isNum(m.sunset_ms) || Math.abs(m.sunset_ms - capturedMs) > 3600000) return 'sunset_ms must be within 1 h of captured_ms';
    if (!isNum(m.eye_height_m) || m.eye_height_m < 0 || m.eye_height_m > 3000) return 'eye_height_m 0–3000';
    if (!['sea', 'flat', 'hills'].includes(m.horizon)) return 'bad horizon';
    if (!['clear', 'haze', 'cloud'].includes(m.sky)) return 'bad sky';
    return null;
  }
  return 'no measurement schema';
}

export { observationMeasurements };
