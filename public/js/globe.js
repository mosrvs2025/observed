// A dependency-free orthographic globe. Land is dots; the day side is lit by the *actual* Sun
// (subsolar point from the shared ephemeris); every observation is a pin with a shadow glyph
// pointing away from the Sun — a world full of sticks, drawn at the moment each was measured.

import { sunPosition } from '/shared/sun.js';
import { destination, bearingDeg, rad, deg, normLon } from '/shared/geo.js';

const topoCache = {};
function loadTopo(name) {
  topoCache[name] ??= fetch(`/data/${name}.json`).then((r) => r.json());
  return topoCache[name];
}

function decodeTopo(topo, objName) {
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
  walk(topo.objects[objName]);
  return polys;
}

// Equirectangular masks: land (filled coastlines) and borders (country outlines). Sampled per pixel.
const TW = 2048, TH = 1024;
async function buildTexture() {
  const [landTopo, countryTopo] = await Promise.all([loadTopo('land-110m'), loadTopo('countries-110m')]);
  const land = decodeTopo(landTopo, 'land'), countries = decodeTopo(countryTopo, 'countries');
  const mk = () => { const c = document.createElement('canvas'); c.width = TW; c.height = TH; return c; };
  const X = (lo) => ((lo + 180) / 360) * TW, Y = (la) => ((90 - la) / 180) * TH;
  const lc = mk(), lx = lc.getContext('2d', { willReadFrequently: true });
  lx.fillStyle = '#fff';
  for (const p of land) { lx.beginPath(); for (const r of p) r.forEach(([lo, la], i) => (i ? lx.lineTo(X(lo), Y(la)) : lx.moveTo(X(lo), Y(la)))); lx.fill('evenodd'); }
  const bc = mk(), bx = bc.getContext('2d', { willReadFrequently: true });
  bx.strokeStyle = '#fff'; bx.lineWidth = 1.15; bx.lineJoin = 'round';
  for (const p of countries) {
    for (const r of p) {
      bx.beginPath();
      r.forEach(([lo, la], i) => {
        const prev = r[i - 1];
        // skip the artificial seams at the antimeridian and the south pole edge
        const seam = prev && ((Math.abs(lo) > 179.9 && Math.abs(prev[0]) > 179.9 && Math.sign(lo) === Math.sign(prev[0])) || (la < -89.5 && prev[1] < -89.5));
        if (i === 0 || seam) bx.moveTo(X(lo), Y(la)); else bx.lineTo(X(lo), Y(la));
      });
      bx.stroke();
    }
  }
  const alpha = (cx) => { const d = cx.getImageData(0, 0, TW, TH).data, o = new Uint8Array(TW * TH); for (let i = 0; i < o.length; i++) o[i] = d[i * 4 + 3]; return o; };
  return { land: alpha(lx), border: alpha(bx) };
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

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
    this.tex = null; this.dirty = true; this.vel = 0;
    this.cxFrac = 0.5; this.rFactor = 0.86; this.labels = true;
    this.sun = sunPosition(this.time);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    buildTexture().then((t) => { this.tex = t; this.dirty = true; }).catch((e) => console.error('globe texture failed', e));
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
    return { x: this.w * this.cxFrac + R * y1, y: this.h / 2 - R * z2, v: x2 };
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
    const R = ((this.cxFrac === 0.5 ? Math.min(w, h) : h) / 2) * this.rFactor * this.zoom;
    this.R = R;
    const cx = w * this.cxFrac, cy = h / 2;

    // atmosphere + body
    let g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.22);
    g.addColorStop(0, 'rgba(110,170,255,0.20)'); g.addColorStop(0.4, 'rgba(110,170,255,0.06)'); g.addColorStop(1, 'rgba(110,170,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, 7); ctx.fill();
    ctx.fillStyle = '#05080f'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();

    // sun vector for day/night
    const s = this.sun;
    const sv = [Math.cos(rad(s.subLat)) * Math.cos(rad(s.subLon)), Math.cos(rad(s.subLat)) * Math.sin(rad(s.subLon)), Math.sin(rad(s.subLat))];
    if (this.tex) this.#drawGlobe(R, sv, cx, cy);

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
      if (this.labels) this.#tag(sp.x + 12, sp.y - 12, '☀ Sun is overhead here', '255,216,154', 1);
    }

    this.#drawMarkers(R, now);
  }

  // Per-pixel orthographic inverse projection: for each screen pixel inside the disc, find the
  // latitude/longitude under it, sample land/border masks, and shade by the Sun's elevation there.
  #drawGlobe(R, sv, cx, cy) {
    const q = Math.min(this.dpr, 1, 720 / (2 * R));
    const D = Math.max(8, Math.round(2 * R * q));
    if (!this.off || this.off.width !== D) { this.off = document.createElement('canvas'); this.off.width = this.off.height = D; this.octx = this.off.getContext('2d'); this.img = this.octx.createImageData(D, D); }
    const data = this.img.data, { land, border } = this.tex;
    const l0 = rad(this.lon0), p0 = rad(this.lat0);
    const cl = Math.cos(l0), sl = Math.sin(l0), cp = Math.cos(p0), sp = Math.sin(p0);
    const half = D / 2, inv = 1 / half;
    const PI = Math.PI, TWO = 2 * PI;
    const s0 = sv[0], s1 = sv[1], s2 = sv[2];
    for (let py = 0; py < D; py++) {
      const z2 = -(py + 0.5 - half) * inv;
      for (let px = 0; px < D; px++) {
        const o = (py * D + px) * 4;
        const y1 = (px + 0.5 - half) * inv;
        const r2 = y1 * y1 + z2 * z2;
        if (r2 >= 1) { data[o + 3] = 0; continue; }
        const x2 = Math.sqrt(1 - r2);
        const x1 = x2 * cp - z2 * sp, z = x2 * sp + z2 * cp;
        const x = x1 * cl - y1 * sl, y = x1 * sl + y1 * cl;
        const row = ((0.5 - Math.asin(z) / PI) * TH) | 0;
        const col = ((Math.atan2(y, x) / TWO + 0.5) * TW) | 0;
        const ti = (row < 0 ? 0 : row >= TH ? TH - 1 : row) * TW + (col < 0 ? 0 : col >= TW ? TW - 1 : col);
        const L = land[ti] / 255, B = border[ti] / 255;
        const sunDot = x * s0 + y * s1 + z * s2;                       // sin(solar elevation)
        let d = (sunDot + 0.14) / 0.3; d = d < 0 ? 0 : d > 1 ? 1 : d; d = d * d * (3 - 2 * d); // twilight blend
        // base colours: ocean / land, night → day
        let r = (6 + 20 * d) * (1 - L) + (46 + 126 * d) * L;
        let g = (13 + 58 * d) * (1 - L) + (58 + 108 * d) * L;
        let b = (30 + 100 * d) * (1 - L) + (96 + 22 * d) * L;
        if (B > 0) { const t = B * 0.85; r += ((60 + 40 * d - 30 * d * 0) - r) * t * (L > 0 ? 1 : 0.2); g += ((80 + 20 * d) - g) * t * (L > 0 ? 1 : 0.2); b += ((130 - 30 * d) - b) * t * (L > 0 ? 1 : 0.2); }
        // ocean sun glint
        if (!L && sunDot > 0.9) { const gl = (sunDot - 0.9) * 10; const k = gl * gl * 70; r += k; g += k * 0.9; b += k * 0.7; }
        // limb darkening + blue atmosphere rim
        const rim = Math.pow(1 - x2, 2.6);
        const dim = 0.6 + 0.4 * Math.pow(x2, 0.5);
        r = r * dim + 70 * rim * (0.35 + d); g = g * dim + 120 * rim * (0.35 + d); b = b * dim + 210 * rim * (0.35 + d);
        data[o] = r > 255 ? 255 : r; data[o + 1] = g > 255 ? 255 : g; data[o + 2] = b > 255 ? 255 : b;
        const edge = (1 - r2) * half * 0.9; data[o + 3] = edge >= 1 ? 255 : (edge * 255) | 0;
      }
    }
    this.octx.putImageData(this.img, 0, 0);
    this.ctx.imageSmoothingEnabled = true; this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(this.off, cx - R, cy - R, 2 * R, 2 * R);
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
      if (this.labels && fresh > 0.15) this.#tag(p.x + 10, p.y + 16, m.label, col, Math.min(1, fresh * 1.6));
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

  #tag(x, y, text, rgb, a) {
    const { ctx } = this;
    ctx.font = '500 12px Inter, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = `rgba(5,8,16,${(0.78 * a).toFixed(2)})`;
    ctx.beginPath(); ctx.roundRect(x, y - 10, w, 20, 10); ctx.fill();
    ctx.fillStyle = `rgba(${rgb},${a.toFixed(2)})`; ctx.fillText(text, x + 7, y + 4);
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
