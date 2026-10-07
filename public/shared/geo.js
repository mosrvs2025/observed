// Spherical-geometry helpers. Distances use the IUGG mean radius; the km-per-degree
// constant below is an explicit, visible assumption in every analysis that uses it.

export const EARTH_MEAN_RADIUS_KM = 6371.0088;
export const KM_PER_DEG = (2 * Math.PI * EARTH_MEAN_RADIUS_KM) / 360; // ≈ 111.195

export const rad = (d) => (d * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;

export function normLon(l) {
  return ((((l + 180) % 360) + 360) % 360) - 180;
}

// Angular great-circle distance, degrees.
export function angularDistanceDeg(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return deg(Math.acos(Math.min(1, Math.max(-1, c))));
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  return angularDistanceDeg(lat1, lon1, lat2, lon2) * KM_PER_DEG;
}

// Initial bearing from point 1 to point 2, degrees clockwise from north.
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Point reached travelling `angDeg` degrees along `bearing` from (lat, lon).
export function destination(lat, lon, bearing, angDeg) {
  const p1 = rad(lat), l1 = rad(lon), b = rad(bearing), d = rad(angDeg);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: deg(p2), lon: normLon(deg(l2)) };
}

// Planar distance (km) between two points on a north-pole-centred azimuthal-equidistant
// map — the usual "flat Earth" map. Radial distances from the pole are exact.
export function flatMapDistanceKm(lat1, lon1, lat2, lon2) {
  const r1 = (90 - lat1) * KM_PER_DEG, r2 = (90 - lat2) * KM_PER_DEG;
  const a1 = rad(lon1), a2 = rad(lon2);
  const dx = r1 * Math.cos(a1) - r2 * Math.cos(a2);
  const dy = r1 * Math.sin(a1) - r2 * Math.sin(a2);
  return Math.hypot(dx, dy);
}

export function validLatLon(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}
