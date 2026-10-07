// The math. Runs on the server for the default result and in *your browser* whenever you move a
// knob on the Evidence page — so every number can be reproduced from the raw observations.
//
// Pipeline per experiment:  raw record → reduced observation (value ± uncertainty budget)
//                           → model predictions → residuals → scores → bootstrap → evidence rubric.

import { rad, deg, KM_PER_DEG, angularDistanceDeg, distanceKm } from './geo.js';
import { sunPosition, solarNoon, refractionDeg, elevationAngle, sunsetElevationDeg } from './sun.js';
import { FAMILIES, predictWith } from './models.js';

export const DEFAULT_OPTS = {
  sigmaSys: 0.5, // degrees (shadow) — floor for effects nobody modelled
  sigmaSysSec: 20, // seconds (sunset)
  includeSynthetic: true,
  challengeMode: 'upheld', // 'upheld' | 'none' | 'all' (what-if: treat every open challenge as upheld)
  blindOnly: false,
  bootstrapN: 400,
};

// ───────────────────────── helpers ─────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : NaN);
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];

function adjFor(o, opts) {
  const a = o.adj || {};
  const src = opts.challengeMode === 'none' ? null : opts.challengeMode === 'all' ? { exclude: a.exclude || a.whatif?.exclude, inflate: Math.max(a.inflate || 1, a.whatif?.inflate || 1) } : a;
  return { exclude: !!src?.exclude, inflate: src?.inflate || 1 };
}

function selectObservations(observations, opts) {
  return observations.filter((o) => (opts.includeSynthetic || !o.synthetic));
}

// ───────────────────────── shadow experiment ─────────────────────────

// One observation → value ± uncertainty budget (all in degrees).
export function reduceShadow(o) {
  const r = o.record;
  if (r.outcome !== 'measured') return null;
  const { stick_cm: h, shadow_cm: L, tilt_deg, shadow_dir, heading_deg } = r.measurements;
  if (!(h > 0) || !(L >= 0)) return null;
  const clockOffset = r.device?.clock_offset_ms || 0;
  const t = r.captured_ms - clockOffset;

  const thetaApp = deg(Math.atan2(L, h));
  const sigL = Math.hypot(0.3, 0.0047 * L); // ruler + penumbra (Sun's ½° disc blurs the tip by ~0.47 % of L)
  const sigH = 0.3;
  const den = h * h + L * L;
  const rulers = deg(Math.hypot((h / den) * sigL, (L / den) * sigH));
  const tiltKnown = typeof tilt_deg === 'number';
  const tilt = tiltKnown ? Math.max(0.2, Math.abs(tilt_deg)) : 1.5;
  const elevApp = 90 - thetaApp;
  const refr = refractionDeg(elevApp);
  const refrUnc = 0.15 * refr + (elevApp < 5 ? 0.25 : 0);
  const sigma = Math.hypot(rulers, tilt, refrUnc);
  const thetaTrue = thetaApp + refr;

  const sun = sunPosition(t);
  const noon = solarNoon(r.location.lon, t);
  return {
    id: o.id,
    observer_id: o.observer_id,
    received_ms: o.received_ms,
    synthetic: !!o.synthetic,
    adj: o.adj,
    replicates: o.replicates || null,
    lat: r.location.lat,
    lon: r.location.lon,
    gps_accuracy: r.location.accuracy_m ?? null,
    t,
    value: thetaTrue,
    value_app: thetaApp,
    sigma,
    budget: { rulers, tilt, tilt_assumed: !tiltKnown, refraction: refrUnc, refraction_applied: refr },
    shadow_dir: shadow_dir || null,
    heading_deg: heading_deg ?? null,
    sun: { decl: sun.decl, subLon: sun.subLon },
    ref: angularDistanceDeg(r.location.lat, r.location.lon, sun.subLat, sun.subLon),
    noon_offset_min: (t - noon) / 60000,
    has_photo: (r.media?.length || 0) > 0,
  };
}

function scoreCore(derived, models, opts, unit, predictFn, sigmaSys) {
  // Build per-observation, per-model residuals.
  const rows = [];
  for (const d of derived) {
    const a = adjFor(d, opts);
    if (a.exclude) continue;
    const sig = Math.hypot(d.sigma, sigmaSys) * a.inflate;
    const preds = models.map((m) => predictFn(m, d));
    rows.push({ d, sig, preds });
  }
  const perModel = models.map((m, k) => {
    const items = rows.filter((r) => r.preds[k] != null && Number.isFinite(r.preds[k]));
    const res = items.map((r) => r.d.value - r.preds[k]);
    const z = items.map((r, i) => res[i] / r.sig);
    const chi2 = sum(z.map((v) => v * v));
    const blindItems = items.filter((r) => r.d.received_ms > m.registered_ms);
    const blindRes = blindItems.map((r) => r.d.value - r.preds[k]);
    const blindChi2 = sum(blindItems.map((r) => ((r.d.value - r.preds[k]) / r.sig) ** 2));
    return {
      model: m,
      n: items.length,
      chi2,
      chi2_red: items.length ? chi2 / items.length : NaN,
      rms: Math.sqrt(mean(res.map((v) => v * v))),
      bias: mean(res),
      within2: items.length ? z.filter((v) => Math.abs(v) <= 2).length / items.length : NaN,
      blind: { n: blindItems.length, chi2: blindChi2, rms: Math.sqrt(mean(blindRes.map((v) => v * v))) },
      points: items.map((r, i) => ({ id: r.d.id, pred: r.preds[k], value: r.d.value, sigma: r.sig, res: res[i], z: z[i], synthetic: r.d.synthetic, lat: r.d.lat, lon: r.d.lon, observer_id: r.d.observer_id, ref: r.d.ref })),
    };
  });

  const best = perModel.reduce((a, b) => (b.n && (!a || b.chi2 < a.chi2) ? b : a), null);
  for (const p of perModel) {
    p.dchi2 = best ? p.chi2 - best.chi2 : NaN;
    p.log10_lr_vs_best = best ? -p.dchi2 / 2 / Math.LN10 : NaN;
  }

  // Bootstrap over *observers* (resampling people, not rows: one enthusiast shouldn't count as many).
  const groups = new Map();
  rows.forEach((r) => {
    if (!groups.has(r.d.observer_id)) groups.set(r.d.observer_id, []);
    groups.get(r.d.observer_id).push(r);
  });
  const G = [...groups.values()].map((items) => ({
    n: items.length,
    chi2: models.map((_, k) => sum(items.map((r) => (r.preds[k] == null ? 0 : ((r.d.value - r.preds[k]) / r.sig) ** 2)))),
    r2: models.map((_, k) => sum(items.map((r) => (r.preds[k] == null ? 0 : (r.d.value - r.preds[k]) ** 2)))),
  }));
  let boot = null;
  if (G.length >= 3 && models.length) {
    const rng = mulberry32(20260922);
    const wins = models.map(() => 0);
    const rmsS = models.map(() => []);
    const B = opts.bootstrapN;
    for (let b = 0; b < B; b++) {
      const c = models.map(() => 0), q = models.map(() => 0);
      let n = 0;
      for (let i = 0; i < G.length; i++) {
        const g = G[Math.floor(rng() * G.length)];
        n += g.n;
        for (let k = 0; k < models.length; k++) { c[k] += g.chi2[k]; q[k] += g.r2[k]; }
      }
      let bk = 0;
      for (let k = 1; k < models.length; k++) if (c[k] < c[bk]) bk = k;
      wins[bk]++;
      for (let k = 0; k < models.length; k++) rmsS[k].push(Math.sqrt(q[k] / n));
    }
    boot = {
      B,
      winner_freq: wins.map((w) => w / B),
      rms_ci: rmsS.map((s) => { s.sort((x, y) => x - y); return [pct(s, 0.05), pct(s, 0.95)]; }),
    };
    perModel.forEach((p, k) => { p.winner_freq = boot.winner_freq[k]; p.rms_ci = boot.rms_ci[k]; });
  }

  return { perModel, bestId: best?.model.id ?? null, boot, nObservers: groups.size, nUsed: rows.length };
}

// Post-hoc fit of the flat model's Sun height. Labelled "after the fact" in the UI.
export function bestFitFlatHeight(derived, opts) {
  const fam = FAMILIES.flat_sun;
  let best = null;
  const rows = derived.filter((d) => !adjFor(d, opts).exclude);
  if (rows.length < 3) return null;
  for (let i = 0; i <= 240; i++) {
    const H = 300 * Math.pow(100000 / 300, i / 240);
    let chi2 = 0, ss = 0;
    for (const d of rows) {
      const a = adjFor(d, opts);
      const sig = Math.hypot(d.sigma, opts.sigmaSys) * a.inflate;
      const p = fam.predict({ lat: d.lat, lon: d.lon, t: d.t }, { height_km: H }).zenith_deg;
      chi2 += ((d.value - p) / sig) ** 2; ss += (d.value - p) ** 2;
    }
    if (!best || chi2 < best.chi2) best = { height_km: H, chi2, rms: Math.sqrt(ss / rows.length), n: rows.length };
  }
  return best;
}

// Classic Eratosthenes: observations taken near *their own* local solar noon. The sun is then due
// north/south, so z = ±shadow angle and (round Earth) z_A − z_B = lat_A − lat_B. No ephemeris is
// used for the angles; it is only used to check that each shot was taken near noon.
export function noonPairs(derived, opts, { windowMin = 12, maxDtHours = 36, minDlat = 4 } = {}) {
  const noon = [];
  for (const d of derived) {
    const a = adjFor(d, opts);
    if (a.exclude) continue;
    if (Math.abs(d.noon_offset_min) > windowMin) continue;
    const dir = d.shadow_dir || '';
    const sign = dir.includes('N') ? 1 : dir.includes('S') ? -1 : 0;
    if (!sign) continue;
    const w = rad((d.noon_offset_min * 15) / 60);
    const sigNoon = deg(0.5 * w * w * Math.cos(rad(d.lat)) * Math.cos(rad(d.sun.decl)) / Math.max(Math.sin(rad(d.value)), 0.3));
    const sig = Math.hypot(d.sigma, sigNoon) * a.inflate;
    noon.push({ d, z: sign * d.value, sig });
  }
  const pairs = [];
  for (let i = 0; i < noon.length; i++) {
    for (let j = i + 1; j < noon.length; j++) {
      const A = noon[i], B = noon[j];
      if (A.d.observer_id === B.d.observer_id) continue;
      const dt = Math.abs(A.d.t - B.d.t) / 3600000;
      if (dt > maxDtHours) continue;
      const dlat = A.d.lat - B.d.lat;
      if (Math.abs(dlat) < minDlat) continue;
      const dz = A.z - B.z;
      const sigDecl = 0.4 * (dt / 24); // worst-case daily change of solar declination
      const sigDz = Math.hypot(A.sig, B.sig, sigDecl);
      const consistent = Math.sign(dz) === Math.sign(dlat) && Math.abs(dz) > sigDz;
      const dKm = Math.abs(dlat) * KM_PER_DEG;
      const R = consistent ? dKm / rad(Math.abs(dz)) : null;
      const sigR = consistent ? R * (sigDz / Math.abs(dz)) : null;
      let Hs = null, sigH = null;
      if (consistent) {
        const tA = Math.tan(rad(A.z)), tB = Math.tan(rad(B.z));
        const dtan = Math.abs(tA - tB);
        if (dtan > 1e-6) {
          Hs = dKm / dtan;
          const sA = (rad(A.sig) / Math.cos(rad(A.z)) ** 2), sB = (rad(B.sig) / Math.cos(rad(B.z)) ** 2);
          sigH = Hs * (Math.hypot(sA, sB, rad(sigDecl) / Math.cos(rad(A.z)) ** 2) / dtan);
        }
      }
      pairs.push({ a: A.d.id, b: B.d.id, dlat, dKm, dz, sigDz, dtHours: dt, consistent, R, sigR, H: Hs, sigH });
    }
  }
  const summarise = (key, sigKey) => {
    const v = pairs.filter((p) => p[key] != null && Number.isFinite(p[key]) && p[sigKey] > 0);
    if (!v.length) return null;
    const w = v.map((p) => 1 / (p[sigKey] * p[sigKey]));
    const wm = sum(v.map((p, i) => p[key] * w[i])) / sum(w);
    const chi2 = sum(v.map((p, i) => ((p[key] - wm) ** 2) * w[i]));
    return { n: v.length, wmean: wm, wsigma: 1 / Math.sqrt(sum(w)), median: median(v.map((p) => p[key])), chi2_red: v.length > 1 ? chi2 / (v.length - 1) : NaN, min: Math.min(...v.map((p) => p[key])), max: Math.max(...v.map((p) => p[key])) };
  };
  return { nNoon: noon.length, pairs, R: summarise('R', 'sigR'), H: summarise('H', 'sigH') };
}

// Replication agreement: compare reduced residuals against the reference model — a common yardstick
// that is not assumed true; two honest measurements of the same place/time must give the same residual.
export function replicationLinks(derived, refPredict, sigmaSys) {
  const byId = new Map(derived.map((d) => [d.id, d]));
  const out = [];
  for (const d of derived) {
    if (!d.replicates) continue;
    const orig = byId.get(d.replicates);
    if (!orig) continue;
    const rA = orig.value - refPredict(orig), rB = d.value - refPredict(d);
    const sig = Math.hypot(orig.sigma, d.sigma);
    const z = (rB - rA) / sig;
    out.push({ original: orig.id, replication: d.id, same_observer: orig.observer_id === d.observer_id, distance_km: distanceKm(orig.lat, orig.lon, d.lat, d.lon), delta: rB - rA, sigma: sig, z, agree: Math.abs(z) <= 2 });
  }
  return out;
}

// What an honest "how much should I trust this?" looks like: a checklist, never a single magic number.
export function evidenceRubric({ derived, nObservers, blindN, openChallenges, links, realN }) {
  const lats = derived.map((d) => d.lat), lons = derived.map((d) => d.lon);
  const latSpan = lats.length ? Math.max(...lats) - Math.min(...lats) : 0;
  const lonSpan = lons.length ? Math.max(...lons) - Math.min(...lons) : 0;
  const hemis = new Set(lats.map((l) => (l >= 0 ? 'N' : 'S')));
  const photoShare = derived.length ? derived.filter((d) => d.has_photo).length / derived.length : 0;
  const items = [
    { key: 'real', pass: realN >= 5, label: 'Real-device data', detail: `${realN} observation${realN === 1 ? '' : 's'} from real phones (need ≥ 5). Simulated demo data never counts as evidence.` },
    { key: 'observers', pass: nObservers >= 8, label: 'Independent observers', detail: `${nObservers} distinct observers (need ≥ 8)` },
    { key: 'geo', pass: latSpan >= 40 && lonSpan >= 120 && hemis.size === 2, label: 'Geographic spread', detail: `latitude span ${latSpan.toFixed(0)}° (need ≥ 40°), longitude span ${lonSpan.toFixed(0)}° (need ≥ 120°), ${hemis.size === 2 ? 'both hemispheres' : 'one hemisphere'}` },
    { key: 'replication', pass: links.length >= 2 && links.every((l) => l.agree), label: 'Replicated', detail: links.length ? `${links.filter((l) => l.agree).length} of ${links.length} replications agree` : 'No replications yet (need ≥ 2 agreeing)' },
    { key: 'blind', pass: blindN >= 5, label: 'Blind predictions scored', detail: `${blindN} observations arrived after the models were locked (need ≥ 5)` },
    { key: 'media', pass: photoShare >= 0.3, label: 'Photographic evidence', detail: `${(photoShare * 100).toFixed(0)} % of observations include a photo (need ≥ 30 %)` },
    { key: 'challenges', pass: openChallenges === 0, label: 'Challenges resolved', detail: openChallenges ? `${openChallenges} open challenge${openChallenges === 1 ? '' : 's'}` : 'No open challenges' },
  ];
  const score = items.filter((i) => i.pass).length;
  let label = score <= 2 ? 'Preliminary' : score <= 5 ? 'Developing' : 'Well supported';
  if (realN < 5) label = 'Demonstration only';
  return { items, score, outOf: items.length, label };
}

const refShadowModel = { family: 'sphere_parallel', params: {} };

export function analyzeShadow({ observations, models, challenges = [], attempts = [], opts: o = {} }) {
  const opts = { ...DEFAULT_OPTS, ...o };
  const obs = selectObservations(observations, opts);
  const derived = obs.map(reduceShadow).filter(Boolean);
  const mods = models.filter((m) => FAMILIES[m.family]?.experiments.includes('shadow-angle'));
  const predictFn = (m, d) => predictWith(m, { lat: d.lat, lon: d.lon, t: d.t }).zenith_deg;
  const score = scoreCore(derived, mods, opts, 'deg', predictFn, opts.sigmaSys);
  const links = replicationLinks(derived, (d) => predictWith(refShadowModel, { lat: d.lat, lon: d.lon, t: d.t }).zenith_deg, opts.sigmaSys);
  const bestFlat = bestFitFlatHeight(derived, opts);
  const pairs = noonPairs(derived, opts);
  const realN = derived.filter((d) => !d.synthetic).length;
  const blindN = Math.max(0, ...score.perModel.map((p) => p.blind.n));
  const openChallenges = challenges.filter((c) => c.status === 'open').length;
  const rubric = evidenceRubric({ derived, nObservers: score.nObservers, blindN, openChallenges, links, realN });
  const fails = attempts.filter((a) => (opts.includeSynthetic || !a.synthetic));
  return {
    experiment: 'shadow-angle',
    opts,
    derived,
    score,
    bestFlat,
    pairs,
    links,
    rubric,
    attempts: { total: derived.length + fails.length, measured: derived.length, failed: fails.length, reasons: fails.map((f) => ({ id: f.id, reason: f.record.failure_reason || 'unspecified', synthetic: !!f.synthetic })) },
    headline: shadowHeadline({ score, pairs, rubric, derived, opts }),
  };
}

function fmtLR(x) {
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  return a > 6 ? '10^' + Math.round(a) : (10 ** a).toFixed(a < 1 ? 1 : 0);
}
export { fmtLR };

function shadowHeadline({ score, pairs, rubric, derived, opts }) {
  const ok = score.perModel.filter((p) => p.n);
  if (derived.length < 3 || !ok.length) return 'Not enough observations yet to compare models. The first few measurements are the most valuable ones.';
  const best = ok.find((p) => p.model.id === score.bestId);
  const others = ok.filter((p) => p !== best);
  const sims = derived.filter((d) => d.synthetic).length;
  let s = `Across ${score.nObservers} observers (${derived.length} measurements), the best-scoring model is “${best.model.name}” — RMS misfit ${best.rms.toFixed(2)}°`;
  if (others.length) s += ` versus ${others.map((p) => `${p.rms.toFixed(1)}° for “${p.model.name}”`).join(' and ')}`;
  s += '.';
  if (best.winner_freq != null) s += ` It scored best in ${(best.winner_freq * 100).toFixed(0)} % of ${score.boot.B} resamples of the observers.`;
  if (pairs.R && pairs.H) s += ` The ephemeris-free Eratosthenes pairs give a radius of ${Math.round(pairs.R.wmean).toLocaleString('en')} ± ${Math.round(pairs.R.wsigma).toLocaleString('en')} km (pairs agree with each other: χ²/ν = ${pairs.R.chi2_red.toFixed(1)}), while the same pairs imply Sun heights from ${Math.round(pairs.H.min).toLocaleString('en')} to ${Math.round(pairs.H.max).toLocaleString('en')} km (χ²/ν = ${pairs.H.chi2_red.toFixed(1)}).`;
  s += ` Evidence status: ${rubric.label} (${rubric.score}/${rubric.outOf} checks).`;
  if (sims) s += ` ${sims} of these measurements are simulated demo data.`;
  return s;
}

// ───────────────────────── sunset experiment ─────────────────────────

export function reduceSunset(o) {
  const r = o.record;
  if (r.outcome !== 'measured') return null;
  const m = r.measurements;
  const reaction = 400; // ms, assumption
  const offset = r.device?.clock_offset_ms || 0;
  const t = m.sunset_ms - offset - reaction;
  const rtt = r.device?.clock_rtt_ms ?? 400;
  const judge = m.sky === 'clear' ? 8 : m.sky === 'haze' ? 20 : 30;
  const horizonExtra = m.horizon === 'hills' ? 120 : m.horizon === 'sea' ? 0 : 10;
  const sigma = Math.hypot(0.25, rtt / 2000, judge, horizonExtra);
  const eye = m.eye_height_m ?? 1.7;
  const elev = elevationAngle(r.location.lat, r.location.lon, t); // geometric elevation when it vanished
  const dip = sunsetElevationDeg(eye) - sunsetElevationDeg(0);
  return {
    id: o.id, observer_id: o.observer_id, received_ms: o.received_ms, synthetic: !!o.synthetic, adj: o.adj, replicates: o.replicates || null,
    lat: r.location.lat, lon: r.location.lon, gps_accuracy: r.location.accuracy_m ?? null,
    t, eye_m: eye, value: t, sigma, // value in ms, sigma in seconds (scaled below)
    elev_at_vanish: elev - dip, // elevation referred to a sea-level horizon
    sky: m.sky, horizon: m.horizon, has_photo: (r.media?.length || 0) > 0,
    budget: { judgement: judge, horizon: horizonExtra, clock: rtt / 2000, reaction: 0.25 },
  };
}

export function analyzeSunset({ observations, models, challenges = [], attempts = [], opts: o = {} }) {
  const opts = { ...DEFAULT_OPTS, ...o };
  const obs = selectObservations(observations, opts);
  const derivedMs = obs.map(reduceSunset).filter(Boolean);
  // Work in seconds relative to each model's prediction.
  const mods = models.filter((m) => FAMILIES[m.family]?.experiments.includes('sunset-sync'));
  const derived = derivedMs.map((d) => ({ ...d }));
  const predictFn = (m, d) => {
    const p = predictWith(m, { lat: d.lat, lon: d.lon, t: d.t, eye_m: d.eye_m }).sunset_ms;
    return p == null ? null : p;
  };
  // scoreCore wants value/pred in the same unit; use seconds by mapping.
  const toSec = derived.map((d) => ({ ...d, value: d.t / 1000 }));
  const predSec = (m, d) => { const p = predictFn(m, { ...d, t: d.t }); return p == null ? null : p / 1000; };
  const score = scoreCore(toSec, mods, opts, 's', (m, d) => predSec(m, { ...d, t: d.value * 1000 }), opts.sigmaSysSec);
  // Post-hoc best e0 (with dip applied), grid in degrees.
  let bestE0 = null;
  const used = derived.filter((d) => !adjFor(d, opts).exclude);
  if (used.length >= 3) {
    const ref = mods.find((m) => m.family === 'sunset_elevation') || { family: 'sunset_elevation', params: { e0_deg: -0.833, use_dip: true } };
    for (let e = -2; e <= 1.0001; e += 0.01) {
      let chi2 = 0, n = 0;
      for (const d of used) {
        const p = predictWith({ family: 'sunset_elevation', params: { e0_deg: e, use_dip: true } }, { lat: d.lat, lon: d.lon, t: d.t, eye_m: d.eye_m }).sunset_ms;
        if (p == null) continue;
        const sig = Math.hypot(d.sigma, opts.sigmaSysSec) * adjFor(d, opts).inflate;
        chi2 += ((d.t - p) / 1000 / sig) ** 2; n++;
      }
      if (n && (!bestE0 || chi2 < bestE0.chi2)) bestE0 = { e0_deg: e, chi2, n };
    }
    // 1σ interval: Δχ² = max(1, χ²/ν) — widened when the scatter is larger than the stated errors.
    if (bestE0) {
      const scale = Math.max(1, bestE0.chi2 / Math.max(1, bestE0.n - 1));
      bestE0.scale = scale;
      const lo = [], hi = [];
      for (let e = -2; e <= 1.0001; e += 0.01) {
        let chi2 = 0;
        for (const d of used) {
          const p = predictWith({ family: 'sunset_elevation', params: { e0_deg: e, use_dip: true } }, { lat: d.lat, lon: d.lon, t: d.t, eye_m: d.eye_m }).sunset_ms;
          if (p == null) continue;
          const sig = Math.hypot(d.sigma, opts.sigmaSysSec) * adjFor(d, opts).inflate;
          chi2 += ((d.t - p) / 1000 / sig) ** 2;
        }
        if (chi2 - bestE0.chi2 <= scale) { lo.push(e); }
      }
      bestE0.lo = Math.min(...lo); bestE0.hi = Math.max(...lo);
    }
  }
  const refModel = mods.find((m) => m.family === 'sunset_elevation' && Math.abs(m.params.e0_deg + 0.833) < 0.01) || mods[0];
  const links = refModel ? replicationLinks(derived.map((d) => ({ ...d, value: d.t / 1000, sigma: d.sigma })), (d) => (predSec(refModel, { ...d, t: d.value * 1000 }) ?? d.value), opts.sigmaSysSec) : [];
  const realN = derived.filter((d) => !d.synthetic).length;
  const blindN = Math.max(0, ...score.perModel.map((p) => p.blind.n));
  const openChallenges = challenges.filter((c) => c.status === 'open').length;
  const rubric = evidenceRubric({ derived, nObservers: score.nObservers, blindN, openChallenges, links, realN });
  const fails = attempts.filter((a) => (opts.includeSynthetic || !a.synthetic));
  const best = score.perModel.find((p) => p.model.id === score.bestId);
  let headline = 'Not enough sunset observations yet.';
  if (derived.length >= 3 && best) {
    headline = `${derived.length} sunsets from ${score.nObservers} observers. Best-scoring model: “${best.model.name}” (RMS ${best.rms.toFixed(0)} s). ` +
      (bestE0 ? `After the fact, the data prefer the Sun to vanish at e₀ = ${bestE0.e0_deg.toFixed(2)}° (1σ range ${bestE0.lo.toFixed(2)}° to ${bestE0.hi.toFixed(2)}°) — a post-hoc fit, not a prediction. ` : '') +
      `Evidence status: ${rubric.label} (${rubric.score}/${rubric.outOf} checks).` +
      (derived.some((d) => d.synthetic) ? ` ${derived.filter((d) => d.synthetic).length} of these are simulated demo data.` : '');
  }
  return { experiment: 'sunset-sync', opts, derived, score, bestE0, links, rubric, pairs: null, bestFlat: null, attempts: { total: derived.length + fails.length, measured: derived.length, failed: fails.length, reasons: fails.map((f) => ({ id: f.id, reason: f.record.failure_reason || 'unspecified', synthetic: !!f.synthetic })) }, headline };
}

export function analyze(slug, input) {
  if (slug === 'shadow-angle') return analyzeShadow(input);
  if (slug === 'sunset-sync') return analyzeSunset(input);
  throw new Error('unknown experiment ' + slug);
}

// What-if sensitivity for a challenge: recompute the headline stat with the challenge applied.
export function challengeSensitivity(slug, input, challenge) {
  const base = analyze(slug, { ...input, opts: { ...input.opts, challengeMode: 'none', bootstrapN: 60 } });
  const obsId = challenge.target?.id;
  if (!obsId) return null;
  const patched = input.observations.map((o) => (o.id === obsId ? { ...o, adj: { exclude: challenge.effect.kind === 'exclude', inflate: challenge.effect.kind === 'inflate' ? challenge.effect.factor : 1 } } : o));
  const alt = analyze(slug, { ...input, observations: patched, opts: { ...input.opts, challengeMode: 'upheld', bootstrapN: 60 } });
  const pick = (r) => r.score.perModel.map((p) => ({ id: p.model.id, name: p.model.name, rms: p.rms, chi2_red: p.chi2_red }));
  return { before: pick(base), after: pick(alt) };
}
