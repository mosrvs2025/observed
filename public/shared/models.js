// Hypotheses as *executable, parametric models*. A model is {family, params}. Anyone can
// register one — but only from these families, so a prediction is always a deterministic
// function of (place, time) that anybody can re-run. No free-text "predictions".

import { angularDistanceDeg, flatMapDistanceKm, deg, rad, EARTH_MEAN_RADIUS_KM } from './geo.js';
import { sunPosition, sunsetTime, sunsetElevationDeg } from './sun.js';

export const FAMILIES = {
  sphere_parallel: {
    experiments: ['shadow-angle'],
    name: 'Round Earth · distant sun',
    short: 'Round',
    blurb:
      'The Earth is a sphere and the Sun is so far away its rays arrive parallel. A stick’s shadow angle equals the angular distance from you to the point directly under the Sun.',
    params: [],
    predict({ lat, lon, t }) {
      const s = sunPosition(t);
      return { zenith_deg: angularDistanceDeg(lat, lon, s.subLat, s.subLon) };
    },
  },
  flat_sun: {
    experiments: ['shadow-angle'],
    name: 'Flat Earth · nearby sun',
    short: 'Flat',
    blurb:
      'The Earth is a flat disc (north-pole-centred map) and the Sun is a local light circling at a fixed height H above it. Shadow angle = atan(ground distance to the Sun ÷ H).',
    params: [{ key: 'height_km', label: 'Sun height H (km)', min: 300, max: 200000, default: 4800, step: 100 }],
    predict({ lat, lon, t }, { height_km }) {
      const s = sunPosition(t);
      const d = flatMapDistanceKm(lat, lon, s.subLat, s.subLon);
      return { zenith_deg: deg(Math.atan2(d, height_km)) };
    },
  },
  sphere_sun_distance: {
    experiments: ['shadow-angle'],
    name: 'Round Earth · Sun at a chosen distance',
    short: 'Ball',
    blurb:
      'The Earth is a sphere and the Sun is a point a chosen distance from its centre. Far away, the rays are nearly parallel; near, they spread out. Shadow angle is the angle between straight-up and the direction to the Sun.',
    params: [{ key: 'sun_distance_km', label: 'Sun distance from Earth’s centre (km)', min: 7000, max: 400000000, default: 150000000, step: 1000 }],
    predict({ lat, lon, t }, { sun_distance_km: d }) {
      const s = sunPosition(t);
      const R = EARTH_MEAN_RADIUS_KM;
      const c = Math.cos(rad(angularDistanceDeg(lat, lon, s.subLat, s.subLon))); // n · s
      const num = d * c - R, den = Math.sqrt(d * d + R * R - 2 * d * R * c);
      return { zenith_deg: deg(Math.acos(Math.max(-1, Math.min(1, num / den)))) };
    },
  },
  sunset_elevation: {
    experiments: ['sunset-sync'],
    name: 'Sunset at solar elevation e₀',
    short: 'e₀',
    blurb:
      'The Sun’s upper limb disappears when its computed geometric elevation reaches e₀ (optionally lowered by the dip of the horizon for your eye height). Competing e₀ values are competing claims about refraction and horizon geometry.',
    params: [
      { key: 'e0_deg', label: 'e₀ (degrees)', min: -3, max: 3, default: -0.833, step: 0.001 },
      { key: 'use_dip', label: 'Apply horizon dip for eye height', type: 'bool', default: true },
    ],
    predict({ lat, lon, t, eye_m = 0 }, { e0_deg, use_dip }) {
      const e0 = e0_deg - (use_dip ? sunsetElevationDeg(eye_m) - sunsetElevationDeg(0) : 0);
      return { sunset_ms: sunsetTime(lat, lon, t, e0) };
    },
  },
};

export function validateModelParams(family, params) {
  const f = FAMILIES[family];
  if (!f) return 'unknown model family';
  const clean = {};
  for (const p of f.params) {
    const v = params?.[p.key];
    if (p.type === 'bool') { clean[p.key] = !!v; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v)) return `param ${p.key} must be a number`;
    if (v < p.min || v > p.max) return `param ${p.key} out of range [${p.min}, ${p.max}]`;
    clean[p.key] = v;
  }
  return { ok: clean };
}

export function predictWith(model, ctx) {
  return FAMILIES[model.family].predict(ctx, model.params);
}

export function describeModel(model) {
  const f = FAMILIES[model.family];
  const ps = f.params.map((p) => (p.type === 'bool' ? `${p.key}=${model.params[p.key] ? 'yes' : 'no'}` : `${p.key}=${model.params[p.key]}`));
  return ps.length ? `${f.name} (${ps.join(', ')})` : f.name;
}
