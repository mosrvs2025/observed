// Phone-as-instrument helpers. Every sensor degrades gracefully to manual entry.

export function watchPosition(onUpdate, onError) {
  if (!navigator.geolocation) { onError?.(new Error('Geolocation not available')); return () => {}; }
  const id = navigator.geolocation.watchPosition(
    (p) => onUpdate({ lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude, acc: p.coords.accuracy, altAcc: p.coords.altitudeAccuracy, ts: p.timestamp }),
    (e) => onError?.(e),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

export async function requestOrientationPermission() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') {
    try { return (await D.requestPermission()) === 'granted'; } catch { return false; }
  }
  return !!D;
}

// Calls back with { tilt, beta, gamma, heading } ~ 10 Hz. tilt = how far the phone's long axis is from vertical
// (phone held upright against the stick).
export function watchOrientation(cb) {
  let last = 0;
  const heading = { v: null };
  const onAbs = (e) => { if (e.alpha != null) heading.v = (360 - e.alpha) % 360; };
  const onRel = (e) => {
    const now = performance.now();
    if (now - last < 90) return;
    last = now;
    if (e.beta == null) return;
    const h = e.webkitCompassHeading != null ? e.webkitCompassHeading : heading.v;
    cb({ beta: e.beta, gamma: e.gamma, tilt: Math.hypot(e.beta - 90, e.gamma ?? 0), heading: h });
  };
  window.addEventListener('deviceorientationabsolute', onAbs, true);
  window.addEventListener('deviceorientation', onRel, true);
  return () => { window.removeEventListener('deviceorientationabsolute', onAbs, true); window.removeEventListener('deviceorientation', onRel, true); };
}

export const compass8 = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// Downscale + re-encode to JPEG in the browser: strips EXIF (including GPS) and keeps uploads small.
export async function prepPhoto(file, max = 1280) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.82));
}
