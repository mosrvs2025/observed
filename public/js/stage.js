// A globe + a time machine. Used for the hero loop and for each experiment's Observatory.
import { Globe } from './globe.js';
import { html, mount, fmtUTC, esc, fmt } from './dom.js';
import { ICON } from './lib.js';

export function campaignWindow(markers, pad = [2, 3]) {
  if (!markers.length) return null;
  const ts = markers.map((m) => m.t);
  return [Math.min(...ts) - pad[0] * 3600e3, Math.max(...ts) + pad[1] * 3600e3];
}

// Hero: loops the campaign automatically; no chrome.
export function mountHeroGlobe(canvas, markers, { onTick, onPick, seconds = 34 } = {}) {
  const g = new Globe(canvas, { onPick, interactive: true });
  g.mode = 'replay'; g.followSun = true; g.fadeMs = 7 * 3600e3;
  g.setMarkers(markers);
  const win = campaignWindow(markers);
  let t = win ? win[0] : Date.now(), live = !win, pausedUntil = 0, raf, last = performance.now(), alive = true;
  const speed = win ? (win[1] - win[0]) / (seconds * 1000) : 1;
  const tick = (now) => {
    if (!alive) return;
    const dt = now - last; last = now;
    if (live) t = Date.now();
    else if (now > pausedUntil) { t += dt * speed; if (t > win[1]) { t = win[0]; pausedUntil = now + 2200; g.pulses = []; } }
    g.setTime(t);
    onTick?.(t, live, win);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    globe: g,
    setLive(v) { live = v || !win; if (!live) t = win[0]; g.mode = live ? 'all' : 'replay'; g.dirty = true; },
    get live() { return live; },
    hasReplay: !!win,
    destroy() { alive = false; cancelAnimationFrame(raf); g.destroy(); },
  };
}

// Full observatory with transport controls.
export function mountObservatory(panel, markers, { onPick, label = 'observation' } = {}) {
  const win = campaignWindow(markers, [1, 2]);
  const state = { t: win ? win[0] : Date.now(), playing: false, speed: 3600, follow: true, all: false };
  const speeds = [['1×', 1], ['1 min/s', 60], ['1 h/s', 3600], ['4 h/s', 14400]];
  mount(panel, html`
    <canvas aria-label="Globe of ${markers.length} ${label}s"></canvas>
    <div class="globe-top">
      <div class="row" style="gap:8px">
        <div class="seg" role="group" aria-label="View"><button data-m="replay" class="on">Replay</button><button data-m="all">All at once</button></div>
        <label class="switch"><input type="checkbox" data-follow checked> Follow the Sun</label>
      </div>
      <div class="legend" style="background:rgba(4,6,12,.7);padding:7px 12px;border-radius:999px"><span><i class="dot-real"></i>real device</span><span><i class="dot-sim"></i>simulated</span><span><i style="background:#ffb84d;height:2px;width:14px;border-radius:2px;vertical-align:3px"></i>shadow direction</span></div>
    </div>
    <div class="globe-controls">
      <button class="icon-btn" data-play aria-label="Play">${ICON.play}</button>
      <input class="tl" type="range" min="0" max="1000" value="0" aria-label="Time">
      <div class="seg" role="group" aria-label="Speed">${speeds.map(([l, v]) => `<button data-sp="${v}" class="${v === state.speed ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="clock mono"></div>
    </div>
    <div class="globe-tip" hidden></div>`);
  const cv = panel.querySelector('canvas'), tip = panel.querySelector('.globe-tip'), clock = panel.querySelector('.clock'), slider = panel.querySelector('.tl'), playBtn = panel.querySelector('[data-play]');
  const g = new Globe(cv, {
    onPick,
    onHover: (m, x, y) => {
      if (!m) { tip.hidden = true; return; }
      tip.hidden = false; tip.style.left = Math.min(x, panel.clientWidth - 260) + 'px'; tip.style.top = y + 'px';
      tip.innerHTML = `<b>${esc(m.label)}</b><span>${m.kind === 'shadow' ? `shadow angle ${fmt(m.value, 1)}° ± ${fmt(m.sigma, 1)}°` : 'sunset recorded'}<br>${fmtUTC(m.t, { sec: m.kind === 'sunset' })}${m.synthetic ? '<br><i>simulated</i>' : ''}</span>`;
    },
  });
  g.followSun = true; g.mode = 'replay'; g.fadeMs = 6 * 3600e3; g.setMarkers(markers);
  const paint = () => {
    g.setTime(state.t);
    clock.textContent = fmtUTC(state.t, { sec: false });
    if (win) slider.value = Math.round(((state.t - win[0]) / (win[1] - win[0])) * 1000);
  };
  if (!win) { slider.disabled = true; playBtn.disabled = true; g.mode = 'all'; }
  paint();
  let raf, last = performance.now(), alive = true;
  const loop = (now) => {
    if (!alive) return;
    const dt = now - last; last = now;
    if (state.playing && win) { state.t += dt * state.speed; if (state.t >= win[1]) { state.t = win[1]; state.playing = false; playBtn.innerHTML = ICON.play; } paint(); }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  playBtn.addEventListener('click', () => {
    if (state.t >= win[1] - 1) state.t = win[0];
    state.playing = !state.playing; playBtn.innerHTML = state.playing ? ICON.pause : ICON.play; playBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  });
  slider.addEventListener('input', () => { state.t = win[0] + (slider.value / 1000) * (win[1] - win[0]); paint(); });
  panel.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('click', () => { state.speed = +b.dataset.sp; panel.querySelectorAll('[data-sp]').forEach((x) => x.classList.toggle('on', x === b)); }));
  panel.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { g.mode = b.dataset.m; panel.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); g.dirty = true; }));
  panel.querySelector('[data-follow]').addEventListener('change', (e) => { g.followSun = e.target.checked; });
  return { globe: g, setTime(t) { state.t = t; paint(); }, destroy() { alive = false; cancelAnimationFrame(raf); g.destroy(); } };
}
