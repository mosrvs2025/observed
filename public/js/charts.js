// Hand-built SVG charts. Every point is a real observation, links to its page, and carries its
// own uncertainty. Simulated data is drawn hollow, real data solid; excluded points are crossed.
import { esc, fmt, fmtInt } from './dom.js';
import { placeName } from './places.js';

const NS = (s) => s; // marker for readability
const nice = (min, max, n = 5) => {
  const span = max - min, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
};

function point(x, y, { color, synthetic, excluded, r = 4.2, id, tip }) {
  const common = `class="dpt" data-id="${id || ''}"`;
  const title = tip ? `<title>${esc(tip)}</title>` : '';
  if (excluded) return `<g ${common}><path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="var(--faint)" stroke-width="1.5"/>${title}</g>`;
  return synthetic
    ? `<circle ${common} cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="1.6">${title}</circle>`
    : `<circle ${common} cx="${x}" cy="${y}" r="${r}" fill="${color}" fill-opacity=".9" stroke="var(--ink)" stroke-width="1">${title}</circle>`;
}

// Small multiples: measured vs predicted, one panel per model. On the diagonal = the model predicted it.
export function modelScatter(perModel, colors, { max = 95 } = {}) {
  const W = 300, H = 300, m = { l: 38, r: 10, t: 10, b: 38 };
  const sx = (v) => m.l + (v / max) * (W - m.l - m.r), sy = (v) => H - m.b - (v / max) * (H - m.t - m.b);
  const ticks = [0, 30, 60, 90];
  return perModel.map((p, i) => {
    const col = colors[i];
    const pts = p.points.map((q) => point(sx(Math.min(q.pred, max)), sy(Math.min(q.value, max)), { color: col, synthetic: q.synthetic, id: q.id, tip: `${placeName(q.lat, q.lon)} · measured ${fmt(q.value)}° vs predicted ${fmt(q.pred)}° (residual ${fmt(q.res)}°)` })).join('');
    const bars = p.points.map((q) => `<line x1="${sx(Math.min(q.pred, max))}" x2="${sx(Math.min(q.pred, max))}" y1="${sy(Math.max(0, q.value - q.sigma))}" y2="${sy(Math.min(max, q.value + q.sigma))}" stroke="${col}" stroke-opacity=".35"/>`).join('');
    return `<div class="mpanel" style="--mc:${col}"><h4><span>${esc(p.model.name)}</span></h4>
      <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Measured vs predicted for ${esc(p.model.name)}">
        ${ticks.map((t) => `<line class="grid" x1="${sx(t)}" x2="${sx(t)}" y1="${m.t}" y2="${H - m.b}"/><line class="grid" y1="${sy(t)}" y2="${sy(t)}" x1="${m.l}" x2="${W - m.r}"/><text x="${sx(t)}" y="${H - m.b + 15}" text-anchor="middle">${t}°</text><text x="${m.l - 6}" y="${sy(t) + 4}" text-anchor="end">${t}°</text>`).join('')}
        <line class="axis" x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}"/><line class="axis" x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H - m.b}"/>
        <line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(max)}" y2="${sy(max)}" stroke="var(--text)" stroke-opacity=".35" stroke-dasharray="4 4"/>
        <text x="${W / 2}" y="${H - 4}" text-anchor="middle">model predicts →</text>
        <text transform="translate(11 ${H / 2}) rotate(-90)" text-anchor="middle">← measured</text>
        ${bars}${pts}
      </svg></div>
      <div class="row between" style="margin-top:6px"><span class="big mono" style="color:${col}">${fmt(p.rms, p.rms < 10 ? 2 : 1)}°</span><span class="hint">RMS miss · χ²/ν ${fmt(p.chi2_red, 1)}</span></div>
      ${p.rms_ci ? `<div class="hint">90 % range over observers: ${fmt(p.rms_ci[0], 2)}–${fmt(p.rms_ci[1], 2)}° · best in ${fmt((p.winner_freq ?? 0) * 100, 0)} % of resamples</div>` : ''}
    </div>`;
  }).join('');
}

// Residual vs latitude: where does each model go wrong?
export function residualByLatitude(perModel, colors, { ymax = 30 } = {}) {
  const W = 760, H = 280, m = { l: 44, r: 12, t: 12, b: 36 };
  const sx = (v) => m.l + ((v + 90) / 180) * (W - m.l - m.r), sy = (v) => m.t + ((ymax - v) / (2 * ymax)) * (H - m.t - m.b);
  let dots = '';
  perModel.forEach((p, i) => { p.points.forEach((q) => { dots += point(sx(q.lat), sy(Math.max(-ymax, Math.min(ymax, -q.res))), { color: colors[i], synthetic: q.synthetic, id: q.id, r: 3.6, tip: `${placeName(q.lat, q.lon)} · ${p.model.name}: model ${q.res >= 0 ? 'under' : 'over'}-predicts by ${fmt(Math.abs(q.res))}°` }); }); });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Model error by latitude">
    ${[-60, -30, 0, 30, 60].map((v) => `<line class="grid" x1="${sx(v)}" x2="${sx(v)}" y1="${m.t}" y2="${H - m.b}"/><text x="${sx(v)}" y="${H - m.b + 15}" text-anchor="middle">${v}°</text>`).join('')}
    ${[-20, -10, 0, 10, 20].map((v) => `<line class="${v === 0 ? 'axis' : 'grid'}" y1="${sy(v)}" y2="${sy(v)}" x1="${m.l}" x2="${W - m.r}"/><text x="${m.l - 6}" y="${sy(v) + 4}" text-anchor="end">${v > 0 ? '+' : ''}${v}°</text>`).join('')}
    <text x="${W / 2}" y="${H - 3}" text-anchor="middle">latitude of observer</text>
    <text transform="translate(11 ${H / 2}) rotate(-90)" text-anchor="middle">model error (predicted − measured)</text>
    ${dots}</svg></div>`;
}

// Eratosthenes pair estimates. One dot per pair; the band is the error-weighted mean ± 1σ.
export function pairStrip(pairs, key, { min, max, log = false, summary, refs = [], label }) {
  const W = 760, H = 150, m = { l: 14, r: 14, t: 28, b: 34 };
  const f = (v) => (log ? Math.log(v) : v), a = f(min), b = f(max);
  const sx = (v) => m.l + ((f(Math.max(min, Math.min(max, v))) - a) / (b - a)) * (W - m.l - m.r);
  const ticks = log ? [1000, 2000, 5000, 10000, 20000].filter((t) => t >= min && t <= max) : nice(min, max, 6);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const vals = pairs.filter((p) => p[key] != null && Number.isFinite(p[key]));
  const dots = vals.map((p) => `<circle cx="${sx(p[key])}" cy="${m.t + 12 + rnd() * (H - m.t - m.b - 24)}" r="2.6" fill="var(--amber)" fill-opacity=".28"/>`).join('');
  const band = summary ? `<rect x="${sx(summary.wmean - summary.wsigma * 3)}" width="${Math.max(2, sx(summary.wmean + summary.wsigma * 3) - sx(summary.wmean - summary.wsigma * 3))}" y="${m.t}" height="${H - m.t - m.b}" fill="var(--amber)" fill-opacity=".14"/><line x1="${sx(summary.wmean)}" x2="${sx(summary.wmean)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--amber)" stroke-width="2"/>` : '';
  const rl = refs.map((r) => `<line x1="${sx(r.v)}" x2="${sx(r.v)}" y1="${m.t - 8}" y2="${H - m.b}" stroke="${r.color || 'var(--faint)'}" stroke-dasharray="3 3"/><text x="${sx(r.v)}" y="${m.t - 12}" text-anchor="middle" style="fill:${r.color || 'var(--faint)'}">${esc(r.label)}</text>`).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    <line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>
    ${ticks.map((t) => `<line class="grid" x1="${sx(t)}" x2="${sx(t)}" y1="${m.t}" y2="${H - m.b}"/><text x="${sx(t)}" y="${H - m.b + 15}" text-anchor="middle">${fmtInt(t)}</text>`).join('')}
    <text x="${W - m.r}" y="${H - 4}" text-anchor="end">${esc(label)}</text>
    ${band}${dots}${rl}</svg></div>`;
}

// Sunset: elevation of the Sun when each observer saw it vanish, by latitude.
export function sunsetStrip(derived, models, colors, bestE0) {
  const W = 760, H = 320, m = { l: 44, r: 14, t: 16, b: 38 };
  const min = -2.2, max = 1.2;
  const sx = (v) => m.l + ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (W - m.l - m.r), sy = (lat) => m.t + ((75 - lat) / 150) * (H - m.t - m.b);
  const lines = models.map((mo, i) => ({ v: mo.params.e0_deg, c: colors[i], l: `e₀ ${mo.params.e0_deg.toFixed(2)}°` }));
  const band = bestE0 ? `<rect x="${sx(bestE0.lo)}" width="${Math.max(2, sx(bestE0.hi) - sx(bestE0.lo))}" y="${m.t}" height="${H - m.t - m.b}" fill="var(--amber)" fill-opacity=".13"/><line x1="${sx(bestE0.e0_deg)}" x2="${sx(bestE0.e0_deg)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="5 4"/>` : '';
  const dots = derived.map((d) => point(sx(d.elev_at_vanish), sy(d.lat), { color: 'var(--amber)', synthetic: d.synthetic, id: d.id, excluded: d.adj?.exclude, tip: `${placeName(d.lat, d.lon)} · Sun vanished at ${fmt(d.elev_at_vanish, 2)}° (${d.sky}, ${d.horizon} horizon)` })).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Solar elevation when the Sun vanished">
    ${nice(min, max, 8).map((t) => `<line class="grid" x1="${sx(t)}" x2="${sx(t)}" y1="${m.t}" y2="${H - m.b}"/><text x="${sx(t)}" y="${H - m.b + 15}" text-anchor="middle">${t.toFixed(1)}°</text>`).join('')}
    ${[-60, -30, 0, 30, 60].map((l) => `<line class="grid" y1="${sy(l)}" y2="${sy(l)}" x1="${m.l}" x2="${W - m.r}"/><text x="${m.l - 6}" y="${sy(l) + 4}" text-anchor="end">${l}°</text>`).join('')}
    <text x="${W / 2}" y="${H - 4}" text-anchor="middle">Sun’s geometric elevation at the instant it vanished (referred to a sea-level horizon)</text>
    <text transform="translate(11 ${H / 2}) rotate(-90)" text-anchor="middle">latitude</text>
    ${band}${lines.map((l) => `<line x1="${sx(l.v)}" x2="${sx(l.v)}" y1="${m.t}" y2="${H - m.b}" stroke="${l.c}" stroke-width="2"/><text x="${sx(l.v) + 4}" y="${m.t + 10}" style="fill:${l.c}">${l.l}</text>`).join('')}
    ${dots}</svg></div>`;
}

// Score bars (RMS, lower is better) on a log axis so a 10× difference is visible and honest.
export function scoreBars(perModel, colors, unit = '°') {
  const vals = perModel.map((p) => p.rms).filter(Number.isFinite);
  if (!vals.length) return '';
  const max = Math.max(...vals) * 1.05;
  return perModel.map((p, i) => `<div style="display:grid;gap:5px"><div class="row between"><b style="font-size:14px">${esc(p.model.name)}${p.blind?.n ? '' : ''}</b><span class="mono" style="color:${colors[i]}">${fmt(p.rms, p.rms < 10 ? 2 : 0)}${unit}</span></div><div class="bar" style="--mc:${colors[i]}"><i style="width:${Math.max(2, (Math.log10(1 + p.rms) / Math.log10(1 + max)) * 100)}%"></i></div></div>`).join('');
}
