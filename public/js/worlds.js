// "Two worlds" — the whole idea in one interactive picture. Two sticks, two places; a round Earth
// with a far-away Sun versus a flat Earth with a near Sun. They agree close to the Sun and
// disagree far from it — which is exactly why this needs people spread across the planet.

import { html, mount } from './dom.js';

const f1 = (x) => x.toFixed(1);

function roundPanel(aA, aB) {
  const cx = 150, cy = 165, r = 100, h = 24;
  const site = (a, label) => {
    const t = (a * Math.PI) / 180;
    const P = [cx + r * Math.cos(t), cy - r * Math.sin(t)];
    const n = [Math.cos(t), -Math.sin(t)];
    const tan = [-Math.sin(t), -Math.cos(t)];
    const top = [P[0] + h * n[0], P[1] + h * n[1]];
    const L = Math.min(h * Math.tan(t), 150);
    const T = [P[0] + L * tan[0], P[1] + L * tan[1]];
    return `<g>
      <line x1="${top[0] + 90}" y1="${top[1]}" x2="${top[0]}" y2="${top[1]}" stroke="#ffb84d" stroke-width="1.2" opacity=".75"/>
      <line x1="${top[0]}" y1="${top[1]}" x2="${T[0]}" y2="${T[1]}" stroke="#ffb84d" stroke-width="1.2" stroke-dasharray="3 3" opacity=".75"/>
      <line x1="${P[0]}" y1="${P[1]}" x2="${top[0]}" y2="${top[1]}" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <line x1="${P[0]}" y1="${P[1]}" x2="${T[0]}" y2="${T[1]}" stroke="#05070d" stroke-opacity=".0" stroke-width="3"/>
      <line x1="${P[0]}" y1="${P[1]}" x2="${T[0]}" y2="${T[1]}" stroke="var(--mint)" stroke-width="3.5" stroke-linecap="round" opacity=".9"/>
      <circle cx="${P[0]}" cy="${P[1]}" r="3.5" fill="var(--text)"/>
      <text x="${P[0] + n[0] * 38 - 4}" y="${P[1] + n[1] * 38 + 4}" text-anchor="middle" fill="var(--text)">${label}</text></g>`;
  };
  const rays = [-90, -60, -30, 0, 30, 60, 90].map((y) => `<line x1="330" y1="${cy + y}" x2="${cx + Math.sqrt(Math.max(0, r * r - y * y)) + 2}" y2="${cy + y}" stroke="#ffb84d" stroke-width="1" opacity=".22"/>`).join('');
  return `<svg viewBox="0 0 360 330" role="img" aria-label="Round Earth with parallel rays">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#0c1730" stroke="var(--mint)" stroke-opacity=".6" stroke-width="1.5"/>
    ${rays}
    <circle cx="340" cy="${cy}" r="11" fill="#ffb84d"/><text x="352" y="${cy + 30}" text-anchor="end">Sun · far away</text>
    ${site(aA, 'A')}${site(aB, 'B')}
    <text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="var(--faint)">round Earth</text>
  </svg>`;
}

function flatPanel(dA, dB, H) {
  const gx0 = 52, gy = 270, kmPx = 36, h = 24; // 36 km per px → 4800 km ≈ 133 px
  const sunX = gx0, sunY = gy - H / kmPx;
  const site = (a, label) => {
    const D = (a * 111.195) / 1; // km
    const x = gx0 + D / kmPx;
    const L = Math.min((h * D) / H, 150);
    const T = [x + L, gy];
    return `<g>
      <line x1="${sunX}" y1="${sunY}" x2="${T[0]}" y2="${T[1]}" stroke="#ffb84d" stroke-width="1.2" opacity=".7"/>
      <line x1="${x}" y1="${gy}" x2="${x}" y2="${gy - h}" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <line x1="${x}" y1="${gy}" x2="${T[0]}" y2="${T[1]}" stroke="var(--coral)" stroke-width="3.5" stroke-linecap="round" opacity=".9"/>
      <circle cx="${x}" cy="${gy}" r="3.5" fill="var(--text)"/>
      <text x="${x}" y="${gy + 20}" text-anchor="middle" fill="var(--text)">${label}</text></g>`;
  };
  return `<svg viewBox="0 0 360 330" role="img" aria-label="Flat Earth with a nearby Sun">
    <line x1="14" y1="${gy}" x2="346" y2="${gy}" stroke="var(--coral)" stroke-opacity=".7" stroke-width="1.5"/>
    <circle cx="${sunX}" cy="${sunY}" r="11" fill="#ffb84d"/><text x="${sunX + 16}" y="${sunY + 4}">Sun · ${Math.round(H).toLocaleString('en')} km up</text>
    <line x1="${sunX}" y1="${sunY + 12}" x2="${sunX}" y2="${gy}" stroke="#ffb84d" stroke-dasharray="2 5" opacity=".35"/>
    ${site(dA, 'A')}${site(dB, 'B')}
    <text x="180" y="316" text-anchor="middle" fill="var(--faint)">flat Earth · ground scale in km</text>
  </svg>`;
}

export function mountWorlds(root, { a = 14, b = 62, H = 4800 } = {}) {
  const state = { a, b, H };
  const thetaFlat = (al) => (Math.atan((al * 111.195) / state.H) * 180) / Math.PI;
  const draw = () => {
    root.querySelector('[data-r]').innerHTML = roundPanel(state.a, state.b);
    root.querySelector('[data-f]').innerHTML = flatPanel(state.a, state.b, state.H);
    const rA = state.a, rB = state.b, fA = thetaFlat(state.a), fB = thetaFlat(state.b);
    root.querySelector('[data-out]').innerHTML = `
      <div class="grid g2" style="gap:14px">
        <div><div class="lbl">Round Earth predicts</div><div class="mono"><span class="mint">A ${f1(rA)}°</span> &nbsp; <span class="mint">B ${f1(rB)}°</span> &nbsp; <span class="dim">difference ${f1(rB - rA)}°</span></div></div>
        <div><div class="lbl">Flat Earth predicts</div><div class="mono"><span class="coral">A ${f1(fA)}°</span> &nbsp; <span class="coral">B ${f1(fB)}°</span> &nbsp; <span class="dim">difference ${f1(fB - fA)}°</span></div></div>
      </div>
      <p class="hint" style="margin:10px 0 0">Gap between the two models at B: <b class="amber mono">${f1(Math.abs(rB - fB))}°</b>. Near the Sun they agree; far from it they can’t both be right — so we need sticks everywhere.</p>`;
  };
  mount(root, html`
    <div class="grid g2 world-diagram" style="gap:10px;color:var(--text)"><div data-r class="card tight"></div><div data-f class="card tight"></div></div>
    <div class="grid g3" style="margin-top:14px">
      <div class="knob"><label class="lbl" for="wa">Site A · distance from the point under the Sun</label><span class="mono amber" data-va></span><input id="wa" type="range" min="0" max="80" step="0.5" value="${state.a}" style="grid-column:1/-1"></div>
      <div class="knob"><label class="lbl" for="wb">Site B</label><span class="mono amber" data-vb></span><input id="wb" type="range" min="0" max="80" step="0.5" value="${state.b}" style="grid-column:1/-1"></div>
      <div class="knob"><label class="lbl" for="wh">Flat-model Sun height</label><span class="mono coral" data-vh></span><input id="wh" type="range" min="1500" max="15000" step="100" value="${state.H}" style="grid-column:1/-1"></div>
    </div>
    <div data-out style="margin-top:16px"></div>`);
  const sync = () => { root.querySelector('[data-va]').textContent = f1(state.a) + '°'; root.querySelector('[data-vb]').textContent = f1(state.b) + '°'; root.querySelector('[data-vh]').textContent = Math.round(state.H).toLocaleString('en') + ' km'; draw(); };
  root.querySelector('#wa').addEventListener('input', (e) => { state.a = +e.target.value; sync(); });
  root.querySelector('#wb').addEventListener('input', (e) => { state.b = +e.target.value; sync(); });
  root.querySelector('#wh').addEventListener('input', (e) => { state.H = +e.target.value; sync(); });
  sync();
}
