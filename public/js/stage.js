// A globe + a time machine. Used for the hero loop and for each experiment's Observatory.
import { Globe } from './globe.js';
import { html, mount, fmtUTC, esc, fmt, raw } from './dom.js';

const seenHint = () => { try { return localStorage.getItem('observed.hint.globe') === '1'; } catch { return false; } };
const hintCard = (kind) => raw(`<div class="globe-hint" role="dialog" aria-label="How to read this globe"><h3>How to read this globe</h3><ul><li><i class="sun"></i><span><b style="color:var(--text)">The glow is the Sun.</b> It marks the one spot on Earth where the Sun is straight overhead right now. It sweeps west as the Earth turns.</span></li><li><i class="pin"></i><span><b style="color:var(--text)">Each ring is a person</b> who ${kind === 'shadow' ? 'measured a stick’s shadow' : 'logged the instant the Sun vanished'} — the moment it appears is the moment they measured. (Open ring = simulated demo; solid = a real phone.)</span></li>${kind === 'shadow' ? '<li><i class="line"></i><span><b style="color:var(--text)">The short line is their shadow.</b> It points away from the Sun, and gets longer the farther they are from the glow.</span></li>' : ''}</ul><button class="btn primary sm" data-hint-ok>Got it — press play ▶</button></div>`);
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
  // Wide screens: globe lives in the right-hand column. Narrow: centred above the copy.
  const layout = () => { const wide = window.innerWidth > 860; g.cxFrac = wide ? 0.73 : 0.5; g.rFactor = wide ? 0.82 : 0.9; g.dirty = true; };
  layout(); window.addEventListener('resize', layout);
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
    destroy() { alive = false; cancelAnimationFrame(raf); window.removeEventListener('resize', layout); g.destroy(); },
  };
}

// Full observatory with transport controls.
export function mountObservatory(panel, markers, { onPick, label = 'observation', kind = 'shadow' } = {}) {
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
      <div class="legend" style="background:rgba(4,6,12,.7);padding:7px 12px;border-radius:999px"><span><i class="sun"></i>Sun overhead</span><span><i class="dot-real"></i>measured by a real phone</span><span><i class="dot-sim"></i>simulated demo</span><span><i style="background:#ffb84d;height:2px;width:14px;border-radius:2px;vertical-align:3px"></i>shadow</span></div>
    </div>
    <div class="globe-caption idle" aria-live="polite"></div>
    ${seenHint() ? '' : hintCard(kind)}
    <div class="globe-controls">
      <button class="icon-btn" data-play aria-label="Play">${raw(ICON.play)}</button>
      <input class="tl" type="range" min="0" max="1000" value="0" aria-label="Time">
      <div class="seg" role="group" aria-label="Speed">${raw(speeds.map(([l, v]) => `<button data-sp="${v}" class="${v === state.speed ? 'on' : ''}">${l}</button>`).join(''))}</div>
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
  const cap = panel.querySelector('.globe-caption');
  panel.querySelectorAll('[data-hint-ok]').forEach((b) => b.addEventListener('click', () => { try { localStorage.setItem('observed.hint.globe', '1'); } catch { /* ignore */ } panel.querySelector('.globe-hint')?.remove(); }));
  let lastCap = null;
  const paint = () => {
    g.setTime(state.t);
    // narrate the most recent measurement so the animation always says what just happened
    let latest = null;
    for (const m of markers) if (m.t <= state.t && state.t - m.t < 50 * 60000 && (!latest || m.t > latest.t)) latest = m;
    if (latest !== lastCap) {
      lastCap = latest;
      if (latest) { cap.classList.remove('idle'); cap.innerHTML = latest.kind === 'shadow' ? `<b>${esc(latest.label)}</b> just measured a shadow — the Sun is <b>${fmt(latest.value, 1)}°</b> from straight overhead there` : `<b>${esc(latest.label)}</b> just watched the Sun disappear`; }
      else cap.classList.add('idle');
    }
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
