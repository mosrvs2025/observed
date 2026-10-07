// A dependency-free orthographic globe. Land is dots; the day side is lit by the *actual* Sun
// (subsolar point from the shared ephemeris); every observation is a pin with a shadow glyph
// pointing away from the Sun — a world full of sticks, drawn at the moment each was measured.

import { sunPosition } from '/shared/sun.js';
import { destination, bearingDeg, rad, deg, normLon } from '/shared/geo.js';

let landPromise = null;
function loadLand() {
  landPromise ??= fetch('/data/land-110m.json').then((r) => r.json()).then(decodeTopo);
  return landPromise;
}

function decodeTopo(topo) {
  const { scale, translate } = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; });
  });
  const ring = (idx) => {
    const pts = [];
    for (const i of idx) {
      const a = i >= 0 ? arcs[i] : arcs[~i].slice().reverse();
      pts.push(...(pts.length ? a.slice(1) : a));
    }
    return pts;
  };
  const polys = [];
  const walk = (g) => {
    if (g.type === 'GeometryCollection') g.geometries.forEach(walk);
    else if (g.type === 'Polygon') polys.push(g.arcs.map(ring));
    else if (g.type === 'MultiPolygon') g.arcs.forEach((p) => polys.push(p.map(ring)));
  };
  walk(topo.objects.land);
  return polys;
}

// Rasterise land to an equirectangular mask and sample an equal-area-ish dot grid.
async function buildDots() {
  const polys = await loadLand();
  const W = 1440, H = 720;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#fff';
  for (const p of polys) {
    c.beginPath();
    for (const r of p) r.forEach(([lo, la], i) => { const x = ((lo + 180) / 360) * W, y = ((90 - la) / 180) * H; i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.fill('evenodd');
  }
  const mask = c.getImageData(0, 0, W, H).data;
  const isLand = (lat, lon) => mask[(Math.min(H - 1, Math.floor(((90 - lat) / 180) * H)) * W + Math.min(W - 1, Math.floor(((lon + 180) / 360) * W))) * 4 + 3] > 128;
  const land = [], ocean = [];
  const grid = (step, push) => {
    for (let lat = -86; lat <= 86; lat += step) {
      const n = Math.max(6, Math.round((360 * Math.cos(rad(lat))) / step));
      for (let i = 0; i < n; i++) push(lat, -180 + ((i + 0.5) * 360) / n);
    }
  };
  const vec = (lat, lon) => [Math.cos(rad(lat)) * Math.cos(rad(lon)), Math.cos(rad(lat)) * Math.sin(rad(lon)), Math.sin(rad(lat))];
  grid(1.35, (la, lo) => { if (isLand(la, lo)) land.push(...vec(la, lo)); });
  grid(2.9, (la, lo) => { if (!isLand(la, lo)) ocean.push(...vec(la, lo)); });
  return { land: new Float32Array(land), ocean: new Float32Array(ocean) };
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const NB = 14; // day/night colour buckets
const PAL = {
  land: [[84, 98, 146, 0.62], [250, 214, 156, 0.9]],
  ocean: [[44, 58, 98, 0.34], [84, 142, 226, 0.7]],
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const bucketColors = Object.fromEntries(Object.entries(PAL).map(([k, [n, d]]) => [k, Array.from({ length: NB }, (_, i) => { const c = mix(n, d, i / (NB - 1)); return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${c[3].toFixed(2)})`; })]));

export class Globe {
  constructor(canvas, { onPick, onHover, interactive = true } = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.onPick = onPick; this.onHover = onHover;
    this.lon0 = 10; this.lat0 = 18; this.zoom = 1;
    this.time = Date.now();
    this.markers = [];
    this.mode = 'replay'; // 'replay' (fade by age, hide future) | 'all'
    this.fadeMs = 8 * 3600e3;
    this.autoRotate = false; this.followSun = false;
    this.pulses = [];
    this.highlightId = null;
    this.dots = null; this.dirty = true; this.vel = 0;
    this.sun = sunPosition(this.time);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.buckets = null;
    buildDots().then((d) => { this.dots = d; this.#alloc(); this.dirty = true; }).catch(() => {});
    this.ro = new ResizeObserver(() => this.#resize());
    this.ro.observe(canvas.parentElement || canvas);
    this.#resize();
    if (interactive) this.#bind();
    this.running = true;
    this.last = performance.now();
    this.tick = (t) => this.#loop(t);
    requestAnimationFrame(this.tick);
    this.io = new IntersectionObserver((e) => { this.visible = e[0].isIntersecting; if (this.visible) this.dirty = true; });
    this.io.observe(canvas);
    this.visible = true;
  }

  destroy() { this.running = false; this.ro.disconnect(); this.io.disconnect(); }

  #alloc() {
    const n = (this.dots.land.length + this.dots.ocean.length) / 3;
    this.buckets = { land: Array.from({ length: NB }, () => new Float32Array(this.dots.land.length / 3 * 2)), ocean: Array.from({ length: NB }, () => new Float32Array(this.dots.ocean.length / 3 * 2)) };
    this.counts = { land: new Int32Array(NB), ocean: new Int32Array(NB) };
    void n;
  }

  #resize() {
    const p = this.cv.parentElement || this.cv;
    const w = Math.max(200, p.clientWidth), h = Math.max(200, p.clientHeight);
    this.w = w; this.h = h;
    this.cv.width = Math.round(w * this.dpr); this.cv.height = Math.round(h * this.dpr);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.dirty = true;
  }

  setMarkers(markers) {
    this.markers = markers.map((m) => {
      const s = sunPosition(m.t);
      const out = { ...m };
      if (m.kind === 'shadow' && m.theta != null && m.theta < 88) {
        const toSun = bearingDeg(m.lat, m.lon, s.subLat, s.subLon);
        const away = (toSun + 180) % 360;
        out.shadowEnd = destination(m.lat, m.lon, away, clamp(2.4 * Math.tan(rad(clamp(m.theta, 0, 78))), 0.5, 9));
      }
      return out;
    });
    this.dirty = true;
  }
  setTime(ms) { this.time = ms; this.sun = sunPosition(ms); this.dirty = true; }
  pulse(lat, lon, color = '255,184,77') { this.pulses.push({ lat, lon, born: performance.now(), color }); this.dirty = true; }
  focus(lat, lon) { this.target = { lon: lon, lat: clamp(lat * 0.6, -50, 50) }; }

  project(lat, lon) {
    const R = this.R;
    const la = rad(lat), lo = rad(lon);
    const x = Math.cos(la) * Math.cos(lo), y = Math.cos(la) * Math.sin(lo), z = Math.sin(la);
    return this.#proj(x, y, z, R);
  }
  #proj(x, y, z, R) {
    const l0 = rad(this.lon0), p0 = rad(this.lat0);
    const cl = Math.cos(l0), sl = Math.sin(l0), cp = Math.cos(p0), sp = Math.sin(p0);
    const x1 = x * cl + y * sl, y1 = -x * sl + y * cl;
    const x2 = x1 * cp + z * sp, z2 = -x1 * sp + z * cp;
    return { x: this.w / 2 + R * y1, y: this.h / 2 - R * z2, v: x2 };
  }

  #loop(now) {
    if (!this.running) return;
    const dt = Math.min(64, now - this.last); this.last = now;
    let animating = this.pulses.length > 0 || Math.abs(this.vel) > 0.01;
    if (this.followSun && !this.dragging) {
      const d = ((this.sun.subLon - this.lon0 + 540) % 360) - 180;
      this.lon0 = normLon(this.lon0 + d * Math.min(1, dt / 500));
      this.lat0 += (clamp(this.sun.subLat * 0.4 + 16, -30, 40) - this.lat0) * Math.min(1, dt / 800);
      animating = true;
    } else if (this.target && !this.dragging) {
      const d = ((this.target.lon - this.lon0 + 540) % 360) - 180;
      this.lon0 = normLon(this.lon0 + d * Math.min(1, dt / 220));
      this.lat0 += (this.target.lat - this.lat0) * Math.min(1, dt / 220);
      if (Math.abs(d) < 0.05) this.target = null;
      animating = true;
    } else if (this.autoRotate && !this.dragging && !this.hovering) { this.lon0 = normLon(this.lon0 + 0.012 * dt); animating = true; }
    if (!this.dragging && Math.abs(this.vel) > 0.01) { this.lon0 = normLon(this.lon0 - this.vel * dt * 0.06); this.vel *= 0.94; }
    if (this.visible && !document.hidden && (this.dirty || animating)) { this.#draw(now); this.dirty = false; }
    requestAnimationFrame(this.tick);
  }

  #draw(now) {
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const R = (Math.min(w, h) / 2) * 0.86 * this.zoom;
    this.R = R;
    const cx = w / 2, cy = h / 2;

    // atmosphere + body
    let g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.22);
    g.addColorStop(0, 'rgba(110,170,255,0.20)'); g.addColorStop(0.4, 'rgba(110,170,255,0.06)'); g.addColorStop(1, 'rgba(110,170,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, 7); ctx.fill();
    g = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R);
    g.addColorStop(0, '#0f1730'); g.addColorStop(1, '#05080f');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();

    // sun vector for day/night
    const s = this.sun;
    const sv = [Math.cos(rad(s.subLat)) * Math.cos(rad(s.subLon)), Math.cos(rad(s.subLat)) * Math.sin(rad(s.subLon)), Math.sin(rad(s.subLat))];
    if (this.dots && this.buckets) this.#drawDots(R, sv);

    // graticule (very faint)
    ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(160,185,255,0.07)';
    for (let lat = -60; lat <= 60; lat += 30) this.#polyline((t) => [lat, -180 + t * 360], 120, R);
    for (let lon = -180; lon < 180; lon += 30) this.#polyline((t) => [-90 + t * 180, lon], 60, R);

    // terminator
    ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,184,77,0.55)';
    const u = [-Math.sin(rad(s.subLon)), Math.cos(rad(s.subLon)), 0];
    const v = [sv[1] * u[2] - sv[2] * u[1], sv[2] * u[0] - sv[0] * u[2], sv[0] * u[1] - sv[1] * u[0]];
    this.#polylineXYZ((t) => { const a = t * Math.PI * 2; return [Math.cos(a) * u[0] + Math.sin(a) * v[0], Math.cos(a) * u[1] + Math.sin(a) * v[1], Math.cos(a) * u[2] + Math.sin(a) * v[2]]; }, 180, R);

    // limb
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(150,190,255,0.28)'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();

    // subsolar sun
    const sp = this.#proj(sv[0], sv[1], sv[2], R);
    if (sp.v > 0) {
      const sg = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, R * 0.16);
      sg.addColorStop(0, 'rgba(255,236,190,0.95)'); sg.addColorStop(0.25, 'rgba(255,184,77,0.45)'); sg.addColorStop(1, 'rgba(255,184,77,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sp.x, sp.y, R * 0.16, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff4d6'; ctx.beginPath(); ctx.arc(sp.x, sp.y, 3.2, 0, 7); ctx.fill();
    }

    this.#drawMarkers(R, now);
  }

  #drawDots(R, sv) {
    const { ctx } = this;
    const size = Math.max(1.5, R / 135);
    for (const type of ['ocean', 'land']) {
      const pts = this.dots[type], counts = this.counts[type], bk = this.buckets[type];
      counts.fill(0);
      const l0 = rad(this.lon0), p0 = rad(this.lat0);
      const cl = Math.cos(l0), sl = Math.sin(l0), cp = Math.cos(p0), sp = Math.sin(p0);
      for (let i = 0; i < pts.length; i += 3) {
        const x = pts[i], y = pts[i + 1], z = pts[i + 2];
        const x1 = x * cl + y * sl;
        const x2 = x1 * cp + z * sp;
        if (x2 < 0.03) continue;
        const y1 = -x * sl + y * cl, z2 = -x1 * sp + z * cp;
        const elev = (Math.asin(clamp(x * sv[0] + y * sv[1] + z * sv[2], -1, 1)) * 180) / Math.PI;
        const b = Math.min(NB - 1, Math.floor(smooth(-9, 14, elev) * NB));
        const k = counts[b]++;
        bk[k * 2] = this.w / 2 + R * y1; bk[k * 2 + 1] = this.h / 2 - R * z2;
      }
      for (let b = 0; b < NB; b++) {
        if (!counts[b]) continue;
        ctx.fillStyle = bucketColors[type][b];
        const n = counts[b], arr = bk, sz = type === 'land' ? size : size * 0.62;
        for (let k = 0; k < n; k++) ctx.fillRect(arr[k * 2] - sz / 2, arr[k * 2 + 1] - sz / 2, sz, sz);
      }
    }
  }

  #polyline(fn, n, R) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const [la, lo] = fn(i / n); const a = rad(la), b = rad(lo); pts.push([Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)]); }
    this.#strokePts(pts, R);
  }
  #polylineXYZ(fn, n, R) {
    const pts = []; for (let i = 0; i <= n; i++) pts.push(fn(i / n));
    this.#strokePts(pts, R);
  }
  #strokePts(pts, R) {
    const { ctx } = this;
    ctx.beginPath();
    let pen = false;
    for (const p of pts) {
      const q = this.#proj(p[0], p[1], p[2], R);
      if (q.v > 0) { pen ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); pen = true; } else pen = false;
    }
    ctx.stroke();
  }

  #drawMarkers(R, now) {
    const { ctx } = this;
    this.screen = [];
    const replay = this.mode === 'replay';
    for (const m of this.markers) {
      let alpha = 1, age = null;
      if (replay) {
        age = this.time - m.t;
        if (age < 0) continue;
        alpha = clamp(1 - age / this.fadeMs, 0.3, 1);
      }
      const p = this.project(m.lat, m.lon);
      if (p.v < 0.04) continue;
      const col = m.kind === 'sunset' ? '255,128,92' : '255,184,77';
      const hl = m.id === this.highlightId;
      const fresh = age != null && age < 40 * 60000 ? 1 - age / (40 * 60000) : 0;
      // shadow glyph
      if (m.shadowEnd) {
        const e = this.project(m.shadowEnd.lat, m.shadowEnd.lon);
        if (e.v > 0.02) {
          ctx.strokeStyle = `rgba(${col},${(0.55 * alpha).toFixed(2)})`; ctx.lineWidth = hl ? 2.2 : 1.4; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(e.x, e.y); ctx.stroke();
        }
      }
      const rr = (hl ? 13 : 8) + fresh * 8;
      const gl = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
      gl.addColorStop(0, `rgba(${col},${(0.55 * alpha + fresh * 0.3).toFixed(2)})`); gl.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, 7); ctx.fill();
      if (m.synthetic) { ctx.strokeStyle = `rgba(${col},${alpha.toFixed(2)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, 7); ctx.stroke(); }
      else { ctx.fillStyle = `rgba(255,248,230,${alpha.toFixed(2)})`; ctx.beginPath(); ctx.arc(p.x, p.y, 3.6, 0, 7); ctx.fill(); ctx.strokeStyle = `rgba(${col},1)`; ctx.lineWidth = 1.5; ctx.stroke(); }
      if (fresh > 0.02) { ctx.strokeStyle = `rgba(${col},${(fresh * 0.7).toFixed(2)})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, 4 + (1 - fresh) * 26, 0, 7); ctx.stroke(); }
      this.screen.push({ m, x: p.x, y: p.y });
    }
    // live pulses
    const t = now;
    this.pulses = this.pulses.filter((q) => t - q.born < 2600);
    for (const q of this.pulses) {
      const p = this.project(q.lat, q.lon);
      if (p.v < 0.03) continue;
      const k = (t - q.born) / 2600;
      for (let i = 0; i < 3; i++) {
        const kk = clamp(k - i * 0.15, 0, 1);
        if (kk <= 0) continue;
        ctx.strokeStyle = `rgba(${q.color},${((1 - kk) * 0.8).toFixed(2)})`; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, 4 + kk * 46, 0, 7); ctx.stroke();
      }
    }
  }

  nearest(x, y, maxPx = 14) {
    let best = null, bd = maxPx * maxPx;
    for (const s of this.screen || []) { const d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bd) { bd = d; best = s; } }
    return best;
  }

  #bind() {
    const cv = this.cv;
    let sx = 0, moved = 0, lastX = 0, lastY = 0, lastT = 0;
    const pts = new Map();
    let pinch = null;
    cv.style.touchAction = 'pan-y';
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { this.dragging = true; sx = lastX = e.clientX; lastY = e.clientY; moved = 0; this.vel = 0; this.target = null; lastT = performance.now(); }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoom }; }
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; this.zoom = clamp(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, 0.75, 3); this.dirty = true; return; }
      if (this.dragging && pts.size === 1) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        const k = 0.28 / this.zoom;
        this.lon0 = normLon(this.lon0 - dx * k);
        this.lat0 = clamp(this.lat0 + dy * k, -75, 75);
        const now = performance.now();
        this.vel = (dx / Math.max(1, now - lastT)) * 5; lastT = now;
        lastX = e.clientX; lastY = e.clientY;
        this.dirty = true;
        if (Math.abs(e.clientX - sx) > 6) cv.style.touchAction = 'none';
        return;
      }
      const hit = this.nearest(e.clientX - r.left, e.clientY - r.top);
      this.hovering = !!hit;
      cv.style.cursor = hit ? 'pointer' : 'grab';
      this.onHover?.(hit?.m ?? null, e.clientX - r.left, e.clientY - r.top);
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) {
        this.dragging = false; cv.style.touchAction = 'pan-y';
        if (moved < 6) { const r = cv.getBoundingClientRect(); const hit = this.nearest(e.clientX - r.left, e.clientY - r.top, 18); if (hit) this.onPick?.(hit.m); }
      }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { this.hovering = false; this.onHover?.(null); });
    cv.addEventListener('wheel', (e) => { if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 1) return; e.preventDefault(); this.zoom = clamp(this.zoom * (e.deltaY < 0 ? 1.1 : 0.9), 0.75, 3); this.dirty = true; }, { passive: false });
    cv.setAttribute('role', 'img');
  }
}

export { deg };
