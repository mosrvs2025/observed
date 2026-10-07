// Glue between raw API data and visual components.
import { reduceShadow, reduceSunset } from '/shared/analysis.js';
import { placeName } from './places.js';

export const MODEL_COLORS = { sphere_parallel: 'var(--mint)', flat_sun: 'var(--coral)', sunset_elevation: 'var(--sky)' };
const EXTRA = ['var(--violet)', 'var(--amber)', 'var(--sky)', 'var(--rose)'];
export function modelColor(m, i = 0) {
  if (m.family === 'flat_sun') return Math.abs(m.params.height_km - 4800) < 1 ? 'var(--coral)' : EXTRA[(m.params.height_km | 0) % EXTRA.length];
  if (m.family === 'sphere_parallel') return 'var(--mint)';
  if (m.family === 'sunset_elevation') return Math.abs(m.params.e0_deg + 0.833) < 0.01 ? 'var(--mint)' : Math.abs(m.params.e0_deg) < 0.01 ? 'var(--coral)' : EXTRA[i % EXTRA.length];
  return EXTRA[i % EXTRA.length];
}

// observation (as served by /data) → globe marker
export function toMarker(o, slug) {
  const d = slug === 'shadow-angle' ? reduceShadow(o) : reduceSunset(o);
  if (!d) return null;
  return { id: o.id, lat: d.lat, lon: d.lon, t: d.t, kind: slug === 'shadow-angle' ? 'shadow' : 'sunset', theta: slug === 'shadow-angle' ? d.value : null, synthetic: o.synthetic, label: placeName(d.lat, d.lon), experiment: slug, value: d.value, sigma: d.sigma };
}

export const shortModel = (m) => (m.family === 'flat_sun' ? `Flat · ${(m.params.height_km / 1000).toFixed(m.params.height_km % 1000 ? 1 : 0)}k km` : m.family === 'sphere_parallel' ? 'Round' : `e₀ ${m.params.e0_deg.toFixed(2)}°`);

export function setActiveNav(key) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === key));
}

export const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
  live: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>',
};

export const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="22" cy="10" r="5" fill="#ffb84d"/><path d="M10 26V12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M10 26h17" stroke="#ffb84d" stroke-width="2" stroke-linecap="round" opacity=".75"/></svg>`;

export function skeleton(h = 160) { return `<div class="skeleton" style="height:${h}px"></div>`; }
