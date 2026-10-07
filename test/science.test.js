import test from 'node:test';
import assert from 'node:assert/strict';
import { sunPosition, zenithAngle, sunsetTime, solarNoon, refractionDeg } from '../public/shared/sun.js';
import { angularDistanceDeg, distanceKm, destination, flatMapDistanceKm } from '../public/shared/geo.js';
import { canonicalize, hashRecord } from '../public/shared/canonical.js';
import { predictWith, validateModelParams } from '../public/shared/models.js';

const T = (s) => Date.parse(s);

test('declination at the June solstice and equinox', () => {
  assert.ok(Math.abs(sunPosition(T('2026-06-21T08:24:00Z')).decl - 23.44) < 0.02);
  assert.ok(Math.abs(sunPosition(T('2026-09-23T00:05:00Z')).decl) < 0.05);
});

test('equation of time in early October is about +11 minutes', () => {
  const eot = sunPosition(T('2026-10-07T12:00:00Z')).eot;
  assert.ok(eot > 10.5 && eot < 12.2, `eot=${eot}`);
});

test('subsolar point at Greenwich solar noon sits on the prime meridian', () => {
  const noon = solarNoon(0, T('2026-10-07T10:00:00Z'));
  assert.ok(Math.abs(sunPosition(noon).subLon) < 0.05);
});

test('London solstice sunset ≈ 20:21 UTC (21:21 BST) within 2 minutes', () => {
  const t = sunsetTime(51.5074, -0.1278, T('2026-06-21T12:00:00Z'));
  const expect = T('2026-06-21T20:21:00Z');
  assert.ok(Math.abs(t - expect) < 2 * 60000, `off by ${(t - expect) / 1000}s`);
});

test('polar night returns null sunset', () => {
  assert.equal(sunsetTime(78, 15, T('2026-12-21T12:00:00Z')), null);
});

test('refraction is ~0.57° at the horizon and negligible overhead', () => {
  assert.ok(Math.abs(refractionDeg(0) - 0.48) < 0.12);
  assert.ok(refractionDeg(80) < 0.01);
});

test('geometry: destination and angular distance agree; flat map radial distances are exact', () => {
  const d = destination(10, 20, 45, 30);
  assert.ok(Math.abs(angularDistanceDeg(10, 20, d.lat, d.lon) - 30) < 1e-9);
  assert.ok(Math.abs(distanceKm(0, 0, 0, 90) - 10007.5) < 5);
  // two points on the same meridian: planar distance == difference in colatitude × km/deg
  assert.ok(Math.abs(flatMapDistanceKm(60, 10, 30, 10) - 30 * 111.19508) < 0.01);
});

test('models: round-Earth prediction equals ephemeris zenith; flat model differs far from the Sun', () => {
  const t = T('2026-09-23T12:00:00Z');
  const sphere = { family: 'sphere_parallel', params: {} };
  const flat = { family: 'flat_sun', params: { height_km: 4800 } };
  const near = { lat: 0, lon: 0, t };
  assert.ok(Math.abs(predictWith(sphere, near).zenith_deg - zenithAngle(0, 0, t)) < 1e-9);
  const far = { lat: -33.9, lon: 151.2, t }; // Sydney at 12:00 UTC: night there
  assert.ok(predictWith(sphere, far).zenith_deg > 90);
  assert.ok(predictWith(flat, far).zenith_deg < 80); // the flat model still has a daylit sky
});

test('model parameter validation rejects out-of-range and unknown input', () => {
  assert.equal(typeof validateModelParams('flat_sun', { height_km: 5 }), 'string');
  assert.equal(typeof validateModelParams('nope', {}), 'string');
  assert.deepEqual(validateModelParams('flat_sun', { height_km: 5000 }), { ok: { height_km: 5000 } });
});

test('canonical JSON is order-independent and hash-stable', async () => {
  const a = { b: 1, a: [3, { y: 2, x: 1 }], c: 'é' };
  const b = { c: 'é', a: [3, { x: 1, y: 2 }], b: 1 };
  assert.equal(canonicalize(a), canonicalize(b));
  assert.equal(await hashRecord(a), await hashRecord(b));
  assert.throws(() => canonicalize({ x: NaN }));
});
