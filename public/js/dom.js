// Tiny auto-escaping template system + formatters. Every interpolated value is escaped unless it
// was produced by html`` itself or wrapped in raw() — user text can never become markup.

class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => new Safe(String(s));
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new Safe(out);
}
function render(v) {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === false || v == null) return '';
  return esc(v);
}
export function mount(el, safe) { el.innerHTML = safe instanceof Safe ? safe.s : esc(safe); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ── formatters ──
const pad = (n, w = 2) => String(Math.trunc(n)).padStart(w, '0');
export function fmtUTC(ms, { sec = false, date = true } = {}) {
  const d = new Date(ms);
  const t = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${sec ? ':' + pad(d.getUTCSeconds()) : ''}`;
  return date ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${t} UTC` : `${t} UTC`;
}
export function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
export function fmtLocalClock(ms, sec = true) {
  return new Date(ms).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: sec ? '2-digit' : undefined });
}
export function fmtLat(lat) { return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`; }
export function fmtLon(lon) { return `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`; }
export const fmtLatLon = (lat, lon) => `${fmtLat(lat)} ${fmtLon(lon)}`;
export function fmtDur(ms) {
  const s = Math.abs(ms) / 1000;
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(s < 36000 ? 1 : 0)} h`;
  return `${Math.round(s / 86400)} days`;
}
export function ago(ms, now = Date.now()) {
  const d = now - ms;
  return d < 0 ? `in ${fmtDur(d)}` : d < 5000 ? 'just now' : `${fmtDur(d)} ago`;
}
export const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
export const fmtInt = (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en') : '—');
export function fmtSigned(x, d = 1) { return Number.isFinite(x) ? (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d) : '—'; }
export function shortHash(h, n = 10) { return h ? `${h.slice(0, n)}…${h.slice(-4)}` : ''; }

export function debounce(fn, ms = 150) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export function toast(msg, kind = 'info') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.classList.add('out'), 3800);
  setTimeout(() => t.remove(), 4300);
}

// Copy text with graceful fallback.
export async function copyText(s) {
  try { await navigator.clipboard.writeText(s); toast('Copied'); } catch { toast('Copy failed — select and copy manually', 'warn'); }
}
