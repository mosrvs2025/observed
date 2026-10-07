// Solar position (NOAA / Meeus low-precision algorithm, ~0.01° accuracy 1900–2100).
// This is the shared ephemeris the experiments use as a *yardstick*. It is a model
// computation, not a measurement — every analysis lists it as an assumption.

import { rad, deg, normLon, angularDistanceDeg } from './geo.js';

const DAY_MS = 86400000;

export function julianDay(tMs) {
  return tMs / DAY_MS + 2440587.5;
}

// Returns { decl (deg), eot (minutes), subLat, subLon } — the subsolar point.
export function sunPosition(tMs) {
  const jd = julianDay(tMs);
  const jc = (jd - 2451545) / 36525;
  const l0 = (((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360) + 360) % 360;
  const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const mr = rad(m);
  const c =
    Math.sin(mr) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * mr) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * mr) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(appLong))));
  const y = Math.tan(rad(obliq) / 2) ** 2;
  const l0r = rad(l0);
  const eot =
    4 *
    deg(
      y * Math.sin(2 * l0r) -
        2 * e * Math.sin(mr) +
        4 * e * y * Math.sin(mr) * Math.cos(2 * l0r) -
        0.5 * y * y * Math.sin(4 * l0r) -
        1.25 * e * e * Math.sin(2 * mr),
    );
  const utcMin = ((tMs % DAY_MS) + DAY_MS) % DAY_MS / 60000;
  const subLon = normLon((720 - utcMin - eot) / 4);
  return { decl, eot, subLat: decl, subLon };
}

// True (geometric, no refraction) solar zenith angle at a site, degrees.
export function zenithAngle(lat, lon, tMs) {
  const s = sunPosition(tMs);
  return angularDistanceDeg(lat, lon, s.subLat, s.subLon);
}

export const elevationAngle = (lat, lon, tMs) => 90 - zenithAngle(lat, lon, tMs);

// Compass azimuth of the sun (deg clockwise from north) as seen from a site.
export function sunAzimuth(lat, lon, tMs) {
  const s = sunPosition(tMs);
  const p = rad(lat), d = rad(s.decl), h = rad(normLon(lon - s.subLon));
  const x = Math.sin(h);
  const y = Math.cos(h) * Math.sin(p) - Math.tan(d) * Math.cos(p);
  return (deg(Math.atan2(x, y)) + 180 + 360) % 360;
}

// Time (ms, UTC) of local solar noon nearest to the given instant.
export function solarNoon(lon, tMs) {
  const dayStart = Math.floor(tMs / DAY_MS) * DAY_MS;
  let noon = dayStart + (720 - 4 * lon) * 60000;
  for (let i = 0; i < 3; i++) noon = dayStart + (720 - 4 * lon - sunPosition(noon).eot) * 60000;
  // choose the noon closest to tMs
  const cands = [noon - DAY_MS, noon, noon + DAY_MS];
  return cands.reduce((a, b) => (Math.abs(b - tMs) < Math.abs(a - tMs) ? b : a));
}

// Atmospheric refraction (degrees) for an apparent elevation (Bennett 1982).
export function refractionDeg(elevDeg) {
  if (elevDeg < -1) return 0;
  const e = Math.max(elevDeg, -0.5);
  return 1 / Math.tan(rad(e + 7.31 / (e + 4.4))) / 60;
}

// Apparent dip of the horizon for an eye `h` metres above the surface (degrees; includes refraction).
export function horizonDipDeg(heightM) {
  return (1.76 * Math.sqrt(Math.max(0, heightM))) / 60;
}

// Solar elevation at which the upper limb appears to touch the horizon:
// -(semi-diameter + standard refraction) minus the horizon dip for the eye height.
// (The 1.76′·√h dip rule already folds in typical refraction over the water.)
export function sunsetElevationDeg(eyeHeightM = 0, { semiDiameter = 0.2666, refraction = 0.5667 } = {}) {
  return -(semiDiameter + refraction) - horizonDipDeg(eyeHeightM);
}

// Next time the sun's elevation crosses `e0` (downward = sunset) after the local noon nearest `tMs`.
// Returns ms or null (polar day / night).
export function sunsetTime(lat, lon, tMs, e0 = -0.8333) {
  const noon = solarNoon(lon, tMs);
  const f = (t) => elevationAngle(lat, lon, t) - e0;
  const step = 10 * 60000;
  let a = noon;
  if (f(a) <= 0) return null;
  for (let t = noon + step; t <= noon + 14 * 3600000; t += step) {
    if (f(t) <= 0) {
      let lo = a, hi = t;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) > 0) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }
    a = t;
  }
  return null;
}

// Next sunset at or after `fromMs` (looks at today's and tomorrow's solar noon).
export function nextSunset(lat, lon, fromMs, e0 = -0.8333) {
  for (let k = -1; k <= 2; k++) {
    const t = sunsetTime(lat, lon, fromMs + k * DAY_MS, e0);
    if (t != null && t >= fromMs) return t;
  }
  return null;
}
