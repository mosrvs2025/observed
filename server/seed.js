// Demo seed: a *simulated* equinox campaign so the product is alive on first run.
//
// Honesty rules:
//  • Every record carries `synthetic: true` INSIDE the signed payload — it can't be stripped later.
//  • The UI labels simulated data everywhere and every analysis can exclude it.
//  • Simulated data is generated from the round-Earth ephemeris plus realistic instrument error,
//    deliberately including mess: unit mistakes, a bad outlier, failed attempts, poor GPS.
// Models are registered first, so observations that arrive afterwards are genuinely "blind".

import { webcrypto as crypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { validateRecord } from './validate.js';
import { canonicalize, b64uEncode, observerIdFromKey, hashRecord } from '../public/shared/canonical.js';
import { EXPERIMENTS } from '../public/shared/experiments.js';
import { sunPosition, zenithAngle, solarNoon, refractionDeg, sunAzimuth, sunsetTime, sunsetElevationDeg } from '../public/shared/sun.js';

function rng(seed) {
  let a = seed >>> 0;
  const u = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
  return { u, n };
}

async function newObserver() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const key = `${jwk.x}.${jwk.y}`;
  return { kp, key, id: await observerIdFromKey(key) };
}
async function sign(o, record) {
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, o.kp.privateKey, new TextEncoder().encode(canonicalize(record)));
  return b64uEncode(new Uint8Array(sig));
}

const SITES = [
  ['London', 51.507, -0.128], ['Reykjavik', 64.147, -21.94], ['Oslo', 59.914, 10.752], ['Madrid', 40.417, -3.704], ['Cairo', 30.044, 31.236],
  ['Nairobi', -1.286, 36.817], ['Quito', -0.18, -78.468], ['Singapore', 1.352, 103.82], ['Cape Town', -33.925, 18.424], ['Johannesburg', -26.204, 28.047],
  ['Sydney', -33.869, 151.209], ['Perth', -31.95, 115.86], ['Auckland', -36.848, 174.763], ['Tokyo', 35.676, 139.65], ['Delhi', 28.614, 77.209],
  ['Dubai', 25.205, 55.271], ['Honolulu', 21.307, -157.858], ['San Francisco', 37.775, -122.419], ['Los Angeles', 34.052, -118.244], ['Mexico City', 19.433, -99.133],
  ['Denver', 39.739, -104.99], ['New York', 40.713, -74.006], ['São Paulo', -23.55, -46.633], ['Buenos Aires', -34.604, -58.382], ['Santiago', -33.449, -70.669],
  ['Ushuaia', -54.801, -68.303], ['Anchorage', 61.218, -149.9], ['Lagos', 6.524, 3.379],
];
const ALT = { Quito: 2850, Denver: 1609, 'Mexico City': 2240, Johannesburg: 1753, Nairobi: 1795, Reykjavik: 12, Delhi: 216, Madrid: 667 };
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass8 = (az) => DIRS[Math.round(az / 45) % 8];

const DEVICES = [
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1', 'iPhone'],
  ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', 'Android'],
  ['Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36', 'Android'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15', 'MacIntel'],
];

export async function seedIfEmpty(store, { log = console.log } = {}) {
  if (store.head().seq > 0) return false;
  const R = rng(20260923);
  const protocol = (slug) => ({ version: EXPERIMENTS[slug].version, hash: protocolHashes[slug] });
  const protocolHashes = {};
  for (const [slug, def] of Object.entries(EXPERIMENTS)) protocolHashes[slug] = (await hashRecord(def)).slice(0, 16);
  const push = async (kind, rec, o, nowForValidation) => {
    const err = await validateRecord(kind, rec, nowForValidation ?? Date.now());
    if (err) throw new Error(`seed ${kind} rejected: ${err}`);
    return store.append(kind, rec, await sign(o, rec));
  };

  // ── 1. models, registered BEFORE any observation ──
  const registrar = await newObserver();
  const mkModel = (experiment, family, params, name, rationale) => ({ v: 1, kind: 'model', experiment, observer: { key: registrar.key, id: registrar.id, name: 'OBSERVED seed' }, made_ms: Date.now(), family, params, name, rationale, synthetic: true });
  const models = {};
  models.sphere = await push('model', mkModel('shadow-angle', 'sphere_parallel', {}, 'Round Earth · distant Sun', 'Standard model. Sun at ~150 million km; rays arrive parallel. Parameter-free: it predicts every shadow angle from the ephemeris alone.'), registrar);
  models.flat48 = await push('model', mkModel('shadow-angle', 'flat_sun', { height_km: 4800 }, 'Flat Earth · Sun at 4,800 km', 'Commonly stated flat-Earth figure (~3,000 miles). North-pole-centred map, Sun circles at fixed height.'), registrar);
  models.flat90 = await push('model', mkModel('shadow-angle', 'flat_sun', { height_km: 9000 }, 'Flat Earth · Sun at 9,000 km', 'A higher Sun flattens the angle curve. Registered as a fairer-to-flat alternative before seeing any data.'), registrar);
  models.std = await push('model', mkModel('sunset-sync', 'sunset_elevation', { e0_deg: -0.833, use_dip: true }, 'Standard: e₀ = −0.833° + horizon dip', 'Upper limb vanishes at −(16′ solar radius + 34′ refraction) below the geometric horizon, lowered further by horizon dip for eye height.'), registrar);
  models.geo = await push('model', mkModel('sunset-sync', 'sunset_elevation', { e0_deg: 0, use_dip: false }, 'Geometric horizon: e₀ = 0°', 'No refraction, no solar radius, no dip. Sunset when the Sun’s centre crosses the geometric horizon.'), registrar);
  await new Promise((r) => setTimeout(r, 15)); // ensure observations are strictly after models

  // ── 2. observers & shadow observations (equinox 2026-09-23) ──
  const base = Date.UTC(2026, 8, 23, 12, 0, 0);
  const observers = [];
  const obsRows = {};
  const sitesUsed = SITES.map(([name, lat, lon]) => ({ name, lat, lon }));
  for (const site of sitesUsed) {
    const o = await newObserver();
    const dev = DEVICES[Math.floor(R.u() * DEVICES.length)];
    observers.push({ ...o, site, dev, gpsAcc: R.u() < 0.12 ? 600 + R.u() * 2500 : 4 + R.u() * 25 });
  }

  const shadowRecord = (ob, tMs, extra = {}) => {
    const { site } = ob;
    const h = [100, 100, 120, 150, 80, 200, 100][Math.floor(R.u() * 7)];
    const lat = site.lat + (R.u() - 0.5) * 0.04, lon = site.lon + (R.u() - 0.5) * 0.04;
    const zTrue = zenithAngle(lat, lon, tMs);
    // invert refraction: find apparent zenith such that apparent elevation + R(apparent) = true elevation
    let eApp = 90 - zTrue;
    for (let i = 0; i < 6; i++) eApp = 90 - zTrue - refractionDeg(eApp);
    const tilt = Math.max(0.1, Math.abs(1 + R.n() * 0.7));
    const thetaApp = 90 - eApp + R.n() * tilt * 0.5 + (extra.thetaBias || 0);
    const hMeas = h + R.n() * 0.25;
    let L = hMeas * Math.tan((thetaApp * Math.PI) / 180) + R.n() * Math.hypot(0.3, 0.0047 * h * Math.tan((thetaApp * Math.PI) / 180));
    L = Math.max(0.2, Math.round(L * 10) / 10);
    const az = (sunAzimuth(lat, lon, tMs) + 180) % 360;
    const rounding = 0.01;
    const dev = ob.dev;
    return {
      v: 1, kind: 'observation', experiment: 'shadow-angle', protocol: protocol('shadow-angle'),
      observer: { key: ob.key, id: ob.id }, captured_ms: Math.round(tMs), outcome: 'measured',
      location: { lat: Math.round(lat / rounding) * rounding, lon: Math.round(lon / rounding) * rounding, alt_m: ALT[site.name] ?? Math.round(R.u() * 80), accuracy_m: Math.round(ob.gpsAcc), alt_accuracy_m: null, source: 'gps', rounding_deg: rounding },
      measurements: { stick_cm: Math.round(hMeas * 10) / 10, shadow_cm: extra.shadow_cm ?? L, shadow_dir: compass8(az), tilt_deg: extra.tilt_deg === undefined ? (R.u() < 0.7 ? Math.round(tilt * 10) / 10 : null) : extra.tilt_deg, heading_deg: R.u() < 0.6 ? Math.round(az) % 360 : null },
      device: { ua: dev[0], platform: dev[1], sensors: { geolocation: true, orientation: dev[1] !== 'MacIntel', camera: false, compass: dev[1] !== 'MacIntel', level: dev[1] !== 'MacIntel' }, clock_offset_ms: Math.round(R.n() * 250), clock_rtt_ms: Math.round(60 + R.u() * 300), app_version: '0.1.0' },
      media: [], prediction_id: null, replicates: null, notes: extra.notes || '', synthetic: true,
    };
  };

  const noonOf = (lon) => solarNoon(lon, base);
  const submit = async (ob, rec) => {
    const r = await push('observation', rec, ob, rec.captured_ms + 60000);
    return r;
  };
  const byName = Object.fromEntries(observers.map((o) => [o.site.name, o]));
  const ids = {};

  for (const ob of observers) {
    const noon = noonOf(ob.site.lon);
    const name = ob.site.name;
    let extra = {};
    if (name === 'Ushuaia') extra = { thetaBias: 4.2, tilt_deg: null, notes: 'Windy; stick leaned a bit I think.' };
    if (name === 'Denver') extra = { tilt_deg: 5.9, notes: 'Uneven pavement. Tilt measured with phone: 5.9°.' };
    if (name === 'Delhi') extra = { notes: 'Measured in a hurry on a roof.' };
    if (name === 'Oslo' || name === 'Mexico City') {
      // a failed attempt first
      const rec = shadowRecord(ob, noon - 40 * 60000 + R.u() * 6e5);
      rec.outcome = 'failed'; rec.failure_reason = name === 'Oslo' ? 'Overcast — no sharp shadow edge.' : 'Gusting wind; could not keep the stick vertical.'; rec.measurements = {};
      await submit(ob, rec);
    }
    const tNoon = noon + (R.u() - 0.5) * 16 * 60000; // within ±8 min of local solar noon
    const rec = shadowRecord(ob, tNoon, extra);
    if (name === 'Delhi') rec.measurements.shadow_cm = Math.round(rec.measurements.shadow_cm / 2.54 * 10) / 10; // typed inches by mistake
    const r = await submit(ob, rec);
    ids[name] = r.id;
    // many also take a non-noon measurement
    if (R.u() < 0.45 && !['Ushuaia', 'Denver', 'Delhi', 'Anchorage'].includes(name)) {
      for (let k = 0; k < 40; k++) {
        const dtH = (R.u() < 0.5 ? -1 : 1) * (1.5 + R.u() * 3);
        const t = noon + dtH * 3600000;
        if (90 - zenithAngle(ob.site.lat, ob.site.lon, t) > 8) { await submit(ob, shadowRecord(ob, t, { shadow_dir_free: true })); break; }
      }
    }
    if (name === 'Reykjavik') { // a low-sun measurement where refraction matters
      for (let k = 0; k < 60; k++) {
        const t = noon + (3 + k * 0.05) * 3600000;
        const el = 90 - zenithAngle(ob.site.lat, ob.site.lon, t);
        if (el < 9 && el > 5) { ids.ReykjavikLow = (await submit(ob, shadowRecord(ob, t, { notes: 'Late-afternoon, sun low.' }))).id; break; }
      }
    }
  }

  // Replications: independent observers near London and Tokyo, same day.
  for (const [city, n] of [['London', 2], ['Tokyo', 1]]) {
    const orig = byName[city];
    for (let i = 0; i < n; i++) {
      const o = await newObserver();
      const ob = { ...o, site: { ...orig.site, name: city + ' (replication)' }, dev: DEVICES[(i + 1) % DEVICES.length], gpsAcc: 6 + R.u() * 10 };
      const rec = shadowRecord(ob, solarNoon(orig.site.lon, base) + (R.u() - 0.5) * 20 * 60000, { notes: `Replicating ${orig.id.slice(0, 4).toUpperCase()}'s measurement.` });
      rec.replicates = ids[city];
      await submit(ob, rec);
    }
  }

  // ── 3. amendment (units) and challenges ──
  const delhi = byName.Delhi;
  const delhiRow = store.row(ids.Delhi);
  const goodL = (() => {
    const t = delhiRow.record.captured_ms, h = delhiRow.record.measurements.stick_cm;
    return Math.round(h * Math.tan((zenithAngle(28.614, 77.209, t) * Math.PI) / 180) * 10) / 10;
  })();
  await push('amendment', { v: 1, kind: 'amendment', observer: { key: delhi.key, id: delhi.id }, made_ms: Date.now(), obs_id: ids.Delhi, changes: { measurements: { shadow_cm: goodL } }, reason: 'I typed the shadow length in inches by mistake; the tape reads 38.1 in = ' + goodL + ' cm.', synthetic: true }, delhi);

  const challenger = observers.find((o) => o.site.name === 'Cairo');
  const mkChal = (o, target, challenge_type, body, effect, experiment = 'shadow-angle') => push('challenge', { v: 1, kind: 'challenge', experiment, observer: { key: o.key, id: o.id }, made_ms: Date.now(), target, challenge_type, body, effect, synthetic: true }, o);
  const ch1 = await mkChal(challenger, { type: 'observation', id: ids.Ushuaia }, 'incorrect_measurement', 'Reported angle is ~4° off every neighbour in the southern hemisphere and tilt was not measured. The note says the stick leaned in wind — likely the cause. Propose inflating the uncertainty ×4.', { kind: 'inflate', factor: 4 });
  for (const n of ['Santiago', 'Buenos Aires', 'Cape Town']) { const o = byName[n]; await push('vote', { v: 1, kind: 'vote', observer: { key: o.key, id: o.id }, made_ms: Date.now(), challenge_id: ch1.id, stance: 'support', note: 'Agree — compare with my own nearby measurement.', synthetic: true }, o); }
  await mkChal(byName.Madrid, { type: 'observation', id: ids.ReykjavikLow }, 'refraction', 'Sun was only ~7° above the horizon. Refraction there is ~0.1° and varies with temperature and pressure; the correction applied (standard atmosphere) may be off by more than the stated uncertainty.', { kind: 'inflate', factor: 2 });
  await mkChal(byName.Singapore, { type: 'experiment', id: 'shadow-angle' }, 'alternative_hypothesis', 'Neither registered flat model lets the Sun height vary with season. A model with the Sun at a different height near each solstice would make a different prediction in June and December — worth registering before then.', { kind: 'note' });

  // ── 4. sunset campaign (same day) ──
  const sunsetSites = observers.filter((o) => ['London', 'Reykjavik', 'Madrid', 'Cairo', 'Nairobi', 'Singapore', 'Cape Town', 'Sydney', 'Perth', 'Auckland', 'Tokyo', 'Delhi', 'Dubai', 'Honolulu', 'San Francisco', 'Los Angeles', 'New York', 'São Paulo', 'Buenos Aires', 'Anchorage', 'Lagos', 'Santiago'].includes(o.site.name));
  for (const ob of sunsetSites) {
    const { site } = ob;
    const eye = ['Reykjavik', 'San Francisco', 'Los Angeles', 'Auckland'].includes(site.name) ? 60 + R.u() * 120 : [0.5, 1.7, 2, 3, 12][Math.floor(R.u() * 5)];
    const sky = R.u() < 0.65 ? 'clear' : R.u() < 0.6 ? 'haze' : 'cloud';
    const horizon = eye > 50 ? 'sea' : R.u() < 0.35 ? 'sea' : R.u() < 0.8 ? 'flat' : 'hills';
    const weather = R.n() * 0.07 + (horizon === 'hills' ? 0.5 : 0) + (sky === 'cloud' ? 0.25 : 0); // refraction scatter / obstruction
    const e0 = sunsetElevationDeg(eye) - weather;
    const noonDay = solarNoon(site.lon, base);
    const tSet = sunsetTime(site.lat, site.lon, noonDay, e0);
    if (tSet == null) continue;
    const judge = sky === 'clear' ? 8 : sky === 'haze' ? 20 : 30;
    const offTrue = Math.round(R.n() * 250);
    const offReported = offTrue + Math.round(R.n() * 80);
    const pressed = Math.round(tSet + R.n() * judge * 1000 + 400 + offTrue);
    const dev = ob.dev;
    const rec = {
      v: 1, kind: 'observation', experiment: 'sunset-sync', protocol: protocol('sunset-sync'), observer: { key: ob.key, id: ob.id }, captured_ms: pressed, outcome: 'measured',
      location: { lat: Math.round(site.lat * 100) / 100, lon: Math.round(site.lon * 100) / 100, alt_m: ALT[site.name] ?? Math.round(R.u() * 60), accuracy_m: Math.round(ob.gpsAcc), alt_accuracy_m: null, source: 'gps', rounding_deg: 0.01 },
      measurements: { sunset_ms: pressed, eye_height_m: Math.round(eye * 10) / 10, horizon, sky },
      device: { ua: dev[0], platform: dev[1], sensors: { geolocation: true, orientation: false, camera: false }, clock_offset_ms: offReported, clock_rtt_ms: Math.round(60 + R.u() * 300), app_version: '0.1.0' },
      media: [], prediction_id: null, replicates: null, notes: '', synthetic: true,
    };
    await submit(ob, rec);
  }
  store.anchor();
  log(`[seed] simulated campaign loaded: ${store.stats().observations} observations from ${store.stats().observers} simulated observers, ledger head #${store.head().seq}`);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = new Store(process.env.OBSERVED_DATA || new URL('../data', import.meta.url).pathname);
  const did = await seedIfEmpty(store);
  if (!did) console.log('[seed] ledger not empty — nothing to do (delete ./data to start over)');
}
