// The capture wizard. Guided, calm, outdoors-legible. Every step degrades to manual entry.
import { html, mount, esc, raw, fmt, fmtUTC, fmtLatLon, fmtLocalClock, fmtDur, fmtSigned, toast, $, $$ } from '../dom.js';
import { api } from '../api.js';
import { getIdentity, syncClock, deviceInfo, serverNow } from '../identity.js';
import { sealRecord } from '../submit.js';
import { watchPosition, requestOrientationPermission, watchOrientation, compass8, prepPhoto } from '../sensors.js';
import { placeName } from '../places.js';
import { Globe } from '../globe.js';
import { modelColor } from '../lib.js';
import { reduceShadow, reduceSunset } from '/shared/analysis.js';
import { predictWith } from '/shared/models.js';
import { elevationAngle, solarNoon, sunsetTime, nextSunset } from '/shared/sun.js';
import { sha256Hex } from '/shared/canonical.js';
import { angularDistanceDeg, distanceKm } from '/shared/geo.js';

export const title = 'Make an observation';

export async function render(root, { params: [slug], query, day }) {
  day(true);
  const def = await api.get(`/api/experiments/${slug}`);
  const isShadow = slug === 'shadow-angle';
  const repId = query.get('replicate');
  const target = repId ? await api.get(`/api/observations/${repId}`).catch(() => null) : null;
  const me = await getIdentity();
  const S = { step: 0, slug, loc: null, rounding: 0.01, prediction: null, predVal: null, m: { stick: '', shadow: '', dir: null, tilt: null, heading: null, unit: 'cm', eye: 1.7, horizon: 'flat', sky: 'clear', sunsetMs: null }, markMs: null, photo: null, sensors: { geolocation: false, orientation: false, compass: false, level: false, camera: false }, clock: null };
  S.clockP = syncClock(5).then((c) => { S.clock = c; });
  const cleanups = [];
  const steps = isShadow ? ['intro', 'locate', 'predict', 'measure', 'review', 'reveal'] : ['intro', 'locate', 'predict', 'measure', 'review', 'reveal'];
  const stage = document.createElement('div');
  stage.className = 'wrap';
  root.append(stage);

  const go = (n) => { cleanups.splice(0).forEach((f) => f()); S.step = n; draw(); window.scrollTo(0, 0); };
  const head = () => html`<div class="wiz-head" aria-label="Step ${S.step + 1} of ${steps.length}">${steps.map((_, i) => `<i class="${i < S.step ? 'done' : i === S.step ? 'now' : ''}"></i>`).map(raw)}</div>`;

  function draw() {
    const fn = { intro, locate, predict, measure, review, reveal }[steps[S.step]];
    fn();
  }

  // ───────── 0 intro ─────────
  function intro() {
    mount(stage, html`<div class="wiz">${head()}
      <div class="eyebrow">${def.kicker}</div><h1 style="margin-top:12px">${def.title}</h1>
      ${target ? html`<div class="callout" style="margin-bottom:16px"><b>You’re reproducing an observation</b> from ${placeName(target.observation.record.location.lat, target.observation.record.location.lon)} (${fmtUTC(target.observation.record.captured_ms, { date: true, sec: false })}). Do your own measurement independently — anywhere, any time. Agreement is checked afterwards.</div>` : ''}
      <p class="lede" style="margin-bottom:20px">${def.summary}</p>
      <div class="card tight stack"><div class="lbl">You’ll need</div><ul class="plain stack">${def.equipment.map((x) => html`<li>· ${x}</li>`)}</ul></div>
      <div class="callout safe" style="margin-top:16px"><b>Safety.</b> ${def.safety}</div>
      <div class="card tight" style="margin-top:16px"><div class="lbl">How it works</div><p class="dim" style="margin:6px 0 0;font-size:14.5px">① Share your position · ② <b>predict</b> the answer (locked and timestamped) · ③ measure · ④ seal it with your device’s signature · ⑤ see how reality compares with every model. About ${isShadow ? '5' : '3 + the wait for sunset'} minutes.</p></div>
      <div class="nav-row"><a class="btn" href="#/e/${slug}">Cancel</a><button class="btn primary lg" id="next">Start</button></div></div>`);
    $('#next', stage).addEventListener('click', () => go(1));
  }

  // ───────── 1 locate ─────────
  function locate() {
    mount(stage, html`<div class="wiz">${head()}<h1>Where are you?</h1>
      <p class="dim">Your phone’s GPS gives position and its accuracy. We record both — a shadow is only as trustworthy as the place it was cast.</p>
      <div class="card stack">
        <div class="row" style="gap:18px"><div class="pos-ring" id="ring"></div><div class="grow"><div class="mono" id="coord" style="font-size:18px">—</div><div class="dim" id="place">Waiting for a fix…</div><div class="hint" id="acc"></div></div></div>
        <div class="row"><button class="btn primary" id="gps">Use my location</button><button class="btn ghost" id="manual">Enter it by hand</button></div>
        <div id="man" hidden class="grid g2" style="gap:10px"><div class="field"><label for="la">Latitude</label><input id="la" inputmode="decimal" placeholder="51.507"></div><div class="field"><label for="lo">Longitude</label><input id="lo" inputmode="decimal" placeholder="-0.128"></div><div class="hint" style="grid-column:1/-1">Manual positions are labelled as unverified.</div></div>
        <div class="field"><label for="rd">Publish my position as</label><select id="rd"><option value="0.001">Exact (~100 m)</option><option value="0.01" selected>Rounded to ~1 km (recommended)</option><option value="0.1">Rounded to ~10 km</option></select><div class="hint">Rounding changes shadow angles by less than 0.1°. Your exact position is never stored.</div></div>
        <div id="sunbox"></div>
      </div>
      <div class="nav-row"><button class="btn" id="back">Back</button><button class="btn primary lg" id="next" disabled>Continue</button></div></div>`);
    const set = (loc) => {
      S.loc = loc;
      $('#coord', stage).textContent = fmtLatLon(loc.lat, loc.lon);
      $('#place', stage).textContent = placeName(loc.lat, loc.lon);
      $('#acc', stage).textContent = loc.source === 'gps' ? `GPS accuracy ±${Math.round(loc.acc)} m${loc.acc > 50 ? ' — weak; step away from buildings if you can' : ''}` : 'Entered by hand';
      $('#ring', stage).style.setProperty('--s', `${Math.min(110, 14 + (loc.acc || 100) / 3)}px`);
      sunBox();
    };
    const sunBox = () => {
      const { lat, lon } = S.loc, t = Date.now();
      const el = elevationAngle(lat, lon, t), noon = solarNoon(lon, t);
      let msg;
      if (isShadow) {
        const toNoon = noon - t;
        msg = el < 4 ? html`<div class="callout safe"><b>The Sun is ${el < 0 ? 'below the horizon' : 'too low'} here (${fmt(el, 1)}°).</b> A shadow now would be enormous and unreliable. Come back in daylight — local solar noon is the best time.</div>`
          : html`<div class="callout"><b>Sun ${fmt(el, 0)}° above the horizon.</b> ${Math.abs(toNoon) < 12 * 60000 ? 'You’re within the noon window — ideal for the classic Eratosthenes pairing.' : toNoon > 0 && toNoon < 6 * 3600e3 ? `Local solar noon is in ${fmtDur(toNoon)}. Measuring then gives your result the most weight.` : 'Any time works; measuring within ±12 min of local solar noon unlocks the pair test.'}</div>`;
        S.sunOk = el >= 4;
      } else {
        const ss = nextSunset(lat, lon, t, -0.833);
        S.sunOk = ss != null && ss - t < 20 * 3600e3;
        msg = ss ? html`<div class="callout"><b>Sunset here is roughly ${fmtLocalClock(Math.round(ss / 900000) * 900000, false)} your time</b> (${fmtDur(ss - t)} from now, ±15 min). Get to your spot with a clear horizon a little early. We don’t show a precise time — that’s what you’re about to predict.</div>` : html`<div class="callout safe">No sunset at this latitude today (polar day/night).</div>`;
        S.ssRough = ss;
      }
      $('#sunbox', stage).innerHTML = msg.s;
      $('#next', stage).disabled = !(S.loc && S.sunOk);
    };
    $('#gps', stage).addEventListener('click', () => {
      $('#gps', stage).textContent = 'Locating…';
      let best = null;
      const stop = watchPosition((p) => { if (!best || p.acc < best.acc) best = p; S.sensors.geolocation = true; set({ lat: p.lat, lon: p.lon, alt: p.alt, acc: p.acc, altAcc: p.altAcc, source: 'gps' }); $('#gps', stage).textContent = 'Refine'; }, (e) => { toast('Couldn’t get a fix — ' + (e.message || 'permission denied') + '. Enter it by hand.', 'warn'); $('#man', stage).hidden = false; $('#gps', stage).textContent = 'Try again'; });
      cleanups.push(stop); setTimeout(stop, 15000);
    });
    $('#manual', stage).addEventListener('click', () => { $('#man', stage).hidden = false; });
    const fromManual = () => { const la = parseFloat($('#la', stage).value), lo = parseFloat($('#lo', stage).value); if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) set({ lat: la, lon: lo, alt: null, acc: null, altAcc: null, source: 'manual' }); };
    $('#la', stage).addEventListener('input', fromManual); $('#lo', stage).addEventListener('input', fromManual);
    $('#rd', stage).addEventListener('change', (e) => { S.rounding = +e.target.value; });
    $('#back', stage).addEventListener('click', () => go(0));
    $('#next', stage).addEventListener('click', () => go(2));
    if (S.loc) set(S.loc);
  }

  // ───────── 2 predict ─────────
  function predict() {
    const done = !!S.prediction;
    mount(stage, html`<div class="wiz">${head()}<h1>What will you find?</h1>
      <p class="dim">Commit to a prediction <b>before</b> you measure. It’s timestamped by the server and locked. Afterwards you’ll see it next to what reality — and every model — says. Predictions made first count for more than explanations made later.</p>
      <div class="card stack">
        ${isShadow ? html`
          <div class="lbl">How far from straight overhead is the Sun, right where you stand?</div>
          <div class="row" style="align-items:baseline;gap:14px"><div class="big-readout" id="pv">${fmt(S.predVal ?? 40, 0)}°</div><div class="dim" id="pcm"></div></div>
          <input type="range" id="pr" min="0" max="90" step="1" value="${S.predVal ?? 40}" aria-label="Predicted Sun angle in degrees from overhead" ${done ? 'disabled' : ''}>
          <div class="hint">0° = Sun straight overhead (no shadow). 45° = shadow as long as the stick. 90° = Sun on the horizon.</div>`
          : html`<div class="lbl">At what time (your local clock) will the Sun’s last sliver vanish?</div>
          <div class="field"><input id="pt" type="time" step="1" value="${S.predTime || ''}" ${done ? 'disabled' : ''} style="font:500 28px var(--mono)"></div><div class="hint">To the second, if you dare. Local time on your device’s clock.</div>`}
        <div id="plock" class="callout" ${done ? '' : 'hidden'}>${done ? html`<b>Locked.</b> Ledger #${S.prediction.ledger_seq} at ${fmtUTC(S.prediction.received_ms, { sec: true })}.` : ''}</div>
        <div class="row"><button class="btn primary" id="lock" ${done ? 'disabled' : ''}>Lock my prediction</button><button class="btn ghost" id="skip">${done ? 'Continue' : 'Skip — I just want to measure'}</button></div>
      </div>
      <div class="hint" style="margin-top:12px">Model predictions for your spot stay hidden until you’ve sealed your measurement.</div>
      <div class="nav-row"><button class="btn" id="back">Back</button></div></div>`);
    if (isShadow) {
      const upd = () => { const v = +$('#pr', stage).value; S.predVal = v; $('#pv', stage).textContent = v + '°'; $('#pcm', stage).innerHTML = `a 100 cm stick would cast <b class="mono">${fmt(100 * Math.tan((v * Math.PI) / 180), 0)} cm</b>`; };
      $('#pr', stage).addEventListener('input', upd); upd();
    }
    $('#lock', stage).addEventListener('click', async () => {
      let value;
      if (isShadow) value = { zenith_deg: S.predVal ?? 40 };
      else {
        const v = $('#pt', stage).value;
        if (!v) { toast('Pick a time first', 'warn'); return; }
        const [h, m, s = 0] = v.split(':').map(Number);
        const base = new Date(S.ssRough || Date.now());
        base.setHours(h, m, +s, 0);
        let ms = base.getTime();
        if (S.ssRough && Math.abs(ms - S.ssRough) > 12 * 3600e3) ms += ms < S.ssRough ? 86400e3 : -86400e3;
        S.predTime = v; value = { sunset_ms: ms };
      }
      const b = $('#lock', stage); b.disabled = true; b.textContent = 'Locking…';
      try {
        const r = await sealRecord('prediction', { experiment: slug, made_ms: await serverNow(), location: locRecord(), value, note: '' });
        S.prediction = { id: r.receipt.id, ledger_seq: r.receipt.ledger_seq, received_ms: r.receipt.received_ms, value };
        S.predictedValue = value;
        draw();
      } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = 'Lock my prediction'; }
    });
    $('#skip', stage).addEventListener('click', () => go(3));
    $('#back', stage).addEventListener('click', () => go(1));
  }

  function locRecord() {
    const l = S.loc, r = S.rounding, rnd = (v) => Math.round(v / r) * r;
    return { lat: +rnd(l.lat).toFixed(4), lon: +rnd(l.lon).toFixed(4), alt_m: l.alt != null ? Math.round(l.alt) : null, accuracy_m: l.acc != null ? Math.round(l.acc) : null, alt_accuracy_m: null, source: l.source, rounding_deg: r };
  }

  // ───────── 3 measure ─────────
  function measure() { return isShadow ? measureShadow() : measureSunset(); }

  function measureShadow() {
    const m = S.m;
    mount(stage, html`<div class="wiz">${head()}<h1>Measure the shadow</h1>
      <ol class="steps plain" style="padding:0;margin:0 0 20px">${def.steps.slice(0, 2).map((s) => html`<li><div><b>${s.title}</b><span>${s.body}</span></div></li>`)}</ol>
      <div class="card stack"><div class="row between"><div class="lbl">Is the stick vertical? <span class="faint">(optional but valuable)</span></div><button class="btn sm" id="sens">Enable level & compass</button></div>
        <div class="row" style="gap:22px;justify-content:center"><div><div class="bubble"><div class="tgt"></div><div class="dot" id="dot"></div></div><div class="mono" id="tilt" style="text-align:center;margin-top:8px">tilt —</div></div></div>
        <div class="hint">Stand the phone upright against the stick, screen facing you. Get the dot into the ring (under 1°), then record it.</div>
        <div class="row"><button class="btn sm" id="rec-tilt" disabled>Record tilt</button><span class="mono" id="tilt-v">${m.tilt != null ? `recorded ${fmt(m.tilt, 1)}°` : ''}</span></div>
        <div class="field"><label for="tilt-m">…or type the tilt if you measured it by other means (°)</label><input id="tilt-m" inputmode="decimal" value="${m.tilt ?? ''}" placeholder="unknown"></div></div>
      <div class="card stack" style="margin-top:14px"><div class="lbl">Mark the tip of the shadow</div>
        <p class="dim" style="margin:0;font-size:14.5px">Place a marker at the tip of the shadow, and tap the button at that exact moment. We check your clock against ours.</p>
        <button class="btn primary lg" id="mark">${S.markMs ? '↻ Re-mark now' : 'Mark now'}</button>
        <div class="mono dim" id="markv">${S.markMs ? `marked ${fmtLocalClock(S.markMs)} your time` : ''}</div></div>
      <div class="card stack" style="margin-top:14px"><div class="row between"><div class="lbl">Lengths</div><div class="seg" id="unit"><button data-u="cm" class="${m.unit === 'cm' ? 'on' : ''}">cm</button><button data-u="in" class="${m.unit === 'in' ? 'on' : ''}">inches</button></div></div>
        <div class="grid g2" style="gap:12px"><div class="field"><label for="st">Stick height (ground to top)</label><div class="input-unit"><input id="st" inputmode="decimal" value="${m.stick}"><span class="unit">${m.unit}</span></div></div><div class="field"><label for="sh">Shadow length (base to tip)</label><div class="input-unit"><input id="sh" inputmode="decimal" value="${m.shadow}"><span class="unit">${m.unit}</span></div></div></div>
        <div id="live" class="callout" hidden></div></div>
      <div class="card stack" style="margin-top:14px"><div class="lbl">Which way does the shadow point?</div>
        <div class="row" style="gap:24px;align-items:flex-start"><div class="dirgrid" id="dirs">${['NW', 'N', 'NE', 'W', null, 'E', 'SW', 'S', 'SE'].map((d) => (d ? `<button data-d="${d}" class="${m.dir === d ? 'on' : ''}">${d}</button>` : '<button class="mid" disabled>stick</button>')).map(raw)}</div>
          <div><div class="compass" id="cmp"><div class="nd" id="nd"></div><b>N</b><b>E</b><b>S</b><b>W</b></div><button class="btn sm" id="use-h" style="margin-top:10px" disabled>Use compass heading</button><div class="mono hint" id="hv">${m.heading != null ? `heading ${Math.round(m.heading)}° recorded` : ''}</div></div></div></div>
      <div class="card stack" style="margin-top:14px"><div class="lbl">Photo of stick and shadow <span class="faint">(optional — lets anyone check it themselves)</span></div>
        <input type="file" id="photo" accept="image/*" capture="environment"><div id="thumb"></div><div class="hint">Re-encoded in your browser: location metadata is stripped. Only its fingerprint is sealed into your record.</div></div>
      <div style="margin-top:14px"><button class="btn ghost sm" id="fail">I couldn’t measure — log a failed attempt</button></div>
      <div class="nav-row"><button class="btn" id="back">Back</button><button class="btn primary lg" id="next" disabled>Review</button></div></div>`);
    const unitK = () => (S.m.unit === 'in' ? 2.54 : 1);
    const recompute = () => {
      const h = parseFloat($('#st', stage).value) * unitK(), L = parseFloat($('#sh', stage).value) * unitK();
      m.stick = $('#st', stage).value; m.shadow = $('#sh', stage).value;
      const live = $('#live', stage);
      const t = parseFloat($('#tilt-m', stage).value);
      if (!isNaN(t)) m.tilt = Math.max(0, t); else if (m.tiltSrc !== 'sensor') m.tilt = null;
      const ok = h >= 10 && h <= 1000 && L >= 0 && L <= 60 * h && S.markMs && m.dir;
      let note = '';
      if (h > 0 && L >= 0) {
        const th = (Math.atan2(L, h) * 180) / Math.PI;
        live.hidden = false; live.innerHTML = `Apparent Sun angle <b class="mono">${fmt(th, 1)}°</b> from overhead ${th < 85 ? '' : '— very low Sun, refraction matters'}${h < 10 ? '' : ''}`;
        if (L > 12 * h) note = 'Shadow is more than 12× the stick — double-check units.';
        if (h < 10 || h > 1000) note = 'Stick height should be 10–1000 cm.';
        if (note) live.innerHTML += `<br><span class="bad">${note}</span>`;
      } else live.hidden = true;
      $('#next', stage).disabled = !ok;
    };
    ['st', 'sh', 'tilt-m'].forEach((id) => $('#' + id, stage).addEventListener('input', recompute));
    $('#unit', stage).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; m.unit = b.dataset.u; $$('#unit button', stage).forEach((x) => x.classList.toggle('on', x === b)); $$('.unit', stage).forEach((u) => { u.textContent = m.unit; }); recompute(); });
    $('#dirs', stage).addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (!b) return; m.dir = b.dataset.d; $$('#dirs button', stage).forEach((x) => x.classList.toggle('on', x === b)); recompute(); });
    $('#mark', stage).addEventListener('click', async () => { S.markMs = Date.now(); $('#markv', stage).textContent = `marked ${fmtLocalClock(S.markMs)} your time ✓`; $('#mark', stage).textContent = '↻ Re-mark now'; if (navigator.vibrate) navigator.vibrate(30); recompute(); });
    let cur = null;
    $('#sens', stage).addEventListener('click', async () => {
      if (!(await requestOrientationPermission())) { toast('Sensors unavailable — type the values instead', 'warn'); return; }
      S.sensors.orientation = true;
      const stop = watchOrientation((o) => {
        cur = o;
        const dot = $('#dot', stage); if (!dot) return;
        const cl = (v) => Math.max(-58, Math.min(58, v));
        dot.style.transform = `translate(${cl(o.gamma * 4)}px, ${cl((o.beta - 90) * 4)}px)`;
        dot.classList.toggle('ok', o.tilt < 1);
        $('#tilt', stage).textContent = `tilt ${fmt(o.tilt, 1)}°`;
        $('#rec-tilt', stage).disabled = false;
        if (o.heading != null) { $('#nd', stage).style.transform = `rotate(${-o.heading}deg)`; $('#use-h', stage).disabled = false; S.sensors.compass = true; }
      });
      cleanups.push(stop);
    });
    $('#rec-tilt', stage).addEventListener('click', () => { if (!cur) return; m.tilt = +cur.tilt.toFixed(1); m.tiltSrc = 'sensor'; S.sensors.level = true; $('#tilt-v', stage).textContent = `recorded ${fmt(m.tilt, 1)}°`; $('#tilt-m', stage).value = m.tilt; });
    $('#use-h', stage).addEventListener('click', () => { if (cur?.heading == null) return; // phone pointed along the shadow
      m.heading = Math.round(cur.heading); m.dir = compass8(m.heading); $('#hv', stage).textContent = `heading ${m.heading}° recorded → ${m.dir}`; $$('#dirs button', stage).forEach((x) => x.classList.toggle('on', x.dataset.d === m.dir)); recompute(); });
    $('#photo', stage).addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; try { const blob = await prepPhoto(f); S.photo = { blob, url: URL.createObjectURL(blob) }; S.sensors.camera = true; $('#thumb', stage).innerHTML = `<img class="thumb" alt="Your photo" src="${S.photo.url}">`; } catch { toast('Couldn’t read that image', 'warn'); } });
    $('#fail', stage).addEventListener('click', () => failFlow());
    $('#back', stage).addEventListener('click', () => go(2));
    $('#next', stage).addEventListener('click', () => go(4));
    recompute();
  }

  function measureSunset() {
    const m = S.m;
    mount(stage, html`<div class="wiz">${head()}<h1>Watch the horizon</h1>
      <div class="callout safe"><b>Never stare at the Sun.</b> Wait until it’s dim and low, don’t use binoculars or zoom, and look away if it hurts. ${esc('')}</div>
      <div class="card stack" style="margin-top:16px"><div class="lbl">Your setup</div>
        <div class="field"><label for="eye">Height of your eyes above the sea or flat ground (m)</label><input id="eye" inputmode="decimal" value="${m.eye}"><div class="hint">Standing ≈ 1.7. Balcony or cliff? Higher means the horizon dips and the Sun lingers a little longer.</div></div>
        <div><div class="lbl" style="margin-bottom:6px">Horizon</div><div class="seg" id="hz">${[['sea', 'Sea'], ['flat', 'Flat land'], ['hills', 'Hills / buildings']].map(([k, l]) => `<button data-v="${k}" class="${m.horizon === k ? 'on' : ''}">${l}</button>`).map(raw)}</div></div>
        <div><div class="lbl" style="margin-bottom:6px">Sky near the horizon</div><div class="seg" id="sk">${[['clear', 'Clear'], ['haze', 'Hazy'], ['cloud', 'Cloud bank']].map(([k, l]) => `<button data-v="${k}" class="${m.sky === k ? 'on' : ''}">${l}</button>`).map(raw)}</div></div></div>
      <div class="card stack" style="margin-top:16px;text-align:center"><div class="lbl">Your clock, synced to the server</div><div class="countdown" id="clk">--:--:--</div><div class="hint" id="clkh">syncing…</div>
        <button class="big-btn" id="gone">${m.sunsetMs ? 'Recorded ✓ — tap to redo' : 'SUN IS GONE'}</button>
        <div class="mono dim" id="gv">${m.sunsetMs ? `recorded ${fmtLocalClock(m.sunsetMs)} your clock` : 'Tap the instant the very last sliver of the Sun disappears.'}</div></div>
      <div style="margin-top:14px"><button class="btn ghost sm" id="fail">I missed it / clouded out — log a failed attempt</button></div>
      <div class="nav-row"><button class="btn" id="back">Back</button><button class="btn primary lg" id="next" ${m.sunsetMs ? '' : 'disabled'}>Review</button></div></div>`);
    const tick = setInterval(() => { const el = $('#clk', stage); if (!el) return; el.textContent = fmtLocalClock(Date.now()); $('#clkh', stage).textContent = S.clock?.clock_offset_ms != null ? `phone clock ${S.clock.clock_offset_ms >= 0 ? '+' : ''}${S.clock.clock_offset_ms} ms vs server (±${Math.round(S.clock.clock_rtt_ms / 2)} ms)` : 'clock check pending'; }, 250);
    cleanups.push(() => clearInterval(tick));
    $('#eye', stage).addEventListener('input', (e) => { m.eye = parseFloat(e.target.value); });
    const seg = (id, key) => $(id, stage).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; m[key] = b.dataset.v; $$(id + ' button', stage).forEach((x) => x.classList.toggle('on', x === b)); });
    seg('#hz', 'horizon'); seg('#sk', 'sky');
    $('#gone', stage).addEventListener('click', () => { m.sunsetMs = Date.now(); S.markMs = m.sunsetMs; $('#gone', stage).textContent = 'Recorded ✓ — tap to redo'; $('#gv', stage).textContent = `recorded ${fmtLocalClock(m.sunsetMs)} your clock`; $('#next', stage).disabled = false; if (navigator.vibrate) navigator.vibrate(60); });
    $('#fail', stage).addEventListener('click', () => failFlow());
    $('#back', stage).addEventListener('click', () => go(2));
    $('#next', stage).addEventListener('click', () => go(4));
  }

  function failFlow() {
    const reasons = ['Overcast — no usable shadow / Sun', 'Too windy to keep the stick still', 'Obstructed view', 'Ran out of daylight', 'Equipment problem'];
    const wrap = document.createElement('div'); wrap.className = 'modal-bg';
    wrap.innerHTML = `<div class="modal"><h2 class="h-md" style="margin-bottom:8px">Log a failed attempt</h2><p class="dim">Failures are public on purpose — they keep success rates honest, and they’re useful data.</p><div class="field"><label>What happened?</label><select id="fr">${reasons.map((r) => `<option>${esc(r)}</option>`).join('')}</select></div><div class="row" style="margin-top:16px"><button class="btn" id="fc">Cancel</button><button class="btn primary" id="fs">Submit failed attempt</button></div></div>`;
    document.body.append(wrap);
    $('#fc', wrap).onclick = () => wrap.remove();
    $('#fs', wrap).onclick = async () => {
      try { const rec = await baseRecord({ outcome: 'failed', failure_reason: $('#fr', wrap).value, measurements: {} }); const r = await sealRecord('observation', rec); wrap.remove(); toast('Failed attempt logged'); location.hash = `#/o/${r.receipt.id}`; } catch (e) { toast(e.message, 'bad'); }
    };
  }

  async function baseRecord(extra) {
    await S.clockP;
    const protocol = { version: def.version, hash: def.protocol_hash };
    return { experiment: slug, protocol, captured_ms: S.markMs || Date.now(), location: locRecord(), device: deviceInfo(S.sensors, S.clock), media: [], prediction_id: S.prediction?.id ?? null, replicates: repId || null, notes: S.notes || '', ...extra };
  }

  function measurements() {
    const m = S.m;
    if (isShadow) {
      const k = m.unit === 'in' ? 2.54 : 1;
      const out = { stick_cm: +(parseFloat(m.stick) * k).toFixed(1), shadow_cm: +(parseFloat(m.shadow) * k).toFixed(1), shadow_dir: m.dir };
      if (m.tilt != null && !isNaN(m.tilt)) out.tilt_deg = +m.tilt.toFixed(1);
      if (m.heading != null) out.heading_deg = m.heading;
      return out;
    }
    return { sunset_ms: m.sunsetMs, eye_height_m: m.eye, horizon: m.horizon, sky: m.sky };
  }

  // ───────── 4 review ─────────
  function review() {
    const meas = measurements();
    const rec = { outcome: 'measured', measurements: meas, captured_ms: S.markMs, location: locRecord(), device: { clock_offset_ms: S.clock?.clock_offset_ms } };
    const pseudo = { id: 'x', observer_id: me.id, received_ms: Date.now(), record: { ...rec, device: rec.device } };
    const dv = isShadow ? reduceShadow(pseudo) : reduceSunset(pseudo);
    const el = isShadow ? elevationAngle(S.loc.lat, S.loc.lon, S.markMs - (S.clock?.clock_offset_ms || 0)) : null;
    const lag = Date.now() - S.markMs;
    mount(stage, html`<div class="wiz">${head()}<h1>Seal it</h1>
      <p class="dim">This is exactly what becomes public. Once sealed, it can’t be edited — only corrected with a visible amendment.</p>
      <div class="card stack">
        ${isShadow ? html`<div class="row" style="gap:20px;align-items:flex-end"><div class="big-readout">${fmt(dv?.value, 1)}°</div><div class="mono dim" style="padding-bottom:10px">± ${fmt(dv?.sigma, 2)}° Sun angle</div></div>` : html`<div class="big-readout" style="font-size:56px">${new Date(meas.sunset_ms).toISOString().slice(11, 19)} <span class="dim" style="font-size:.4em">UTC</span></div>`}
        <dl class="kv"><dt>Place</dt><dd>${placeName(S.loc.lat, S.loc.lon)} · ${fmtLatLon(locRecord().lat, locRecord().lon)} <span class="faint">(${S.loc.source}${S.loc.acc ? ` ±${Math.round(S.loc.acc)} m` : ''})</span></dd><dt>Time</dt><dd>${fmtUTC(S.markMs, { sec: true })}${lag > 15 * 60000 ? html` <span class="warn">(${fmtDur(lag)} ago)</span>` : ''}</dd>
          ${Object.entries(meas).map(([k, v]) => html`<dt>${k.replace(/_/g, ' ')}</dt><dd>${typeof v === 'number' && k === 'sunset_ms' ? new Date(v).toISOString().slice(11, 19) + ' UTC' : v}</dd>`)}
          <dt>Prediction</dt><dd>${S.prediction ? html`locked first — ledger #${S.prediction.ledger_seq}` : 'none (not pre-registered)'}</dd><dt>Photo</dt><dd>${S.photo ? 'attached (hash sealed)' : 'none'}</dd><dt>Observer</dt><dd class="mono">${me.name} · ${me.id}</dd></dl>
        ${isShadow && el < 0 ? html`<div class="callout safe"><b>Implausible:</b> the Sun was below the horizon at that place and time. Check your position and clock — you can still submit, but it will be flagged.</div>` : ''}
        ${repId ? html`<div class="callout">This will be recorded as a replication of <a href="#/o/${repId}">${repId.slice(4, 10)}</a>.</div>` : ''}
        <div class="field"><label for="notes">Notes (optional, public)</label><textarea id="notes" maxlength="500" placeholder="Anything unusual? Wind, uneven ground, haze…">${S.notes || ''}</textarea></div>
      </div>
      <div class="nav-row"><button class="btn" id="back">Back</button><button class="btn primary lg" id="seal">Sign & seal</button></div></div>`);
    $('#back', stage).addEventListener('click', () => go(3));
    $('#seal', stage).addEventListener('click', async () => {
      S.notes = $('#notes', stage).value.trim();
      const b = $('#seal', stage); b.disabled = true; b.textContent = 'Signing…';
      try {
        const media = [];
        if (S.photo) { b.textContent = 'Uploading photo…'; const up = await api.uploadMedia(S.photo.blob); media.push({ sha256: up.sha256, mime: up.mime, bytes: up.bytes }); }
        const record = await baseRecord({ outcome: 'measured', measurements: meas }); record.media = media;
        b.textContent = 'Sealing…';
        const r = await sealRecord('observation', record);
        S.sealed = r; S.sealedRecord = record;
        go(5);
      } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = 'Sign & seal'; }
    });
  }

  // ───────── 5 reveal ─────────
  async function reveal() {
    const r = S.sealed.receipt;
    mount(stage, html`<div class="wiz">${head()}<div class="eyebrow">Sealed · ledger #${r.ledger_seq}</div><h1 style="margin-top:10px">Now compare with reality.</h1>
      <div class="globe-panel" id="mini" style="height:260px;min-height:0;margin:16px 0"></div>
      <div id="rv" class="stack"><div class="skeleton"></div></div>
      <div class="card stack" style="margin-top:18px"><div class="lbl">Your receipt</div><div class="hash">${r.id}<br>sha256 ${r.content_hash}</div>
        <div class="row"><a class="btn primary" href="#/o/${r.id}">Open & verify my observation</a><button class="btn" id="share">Invite someone far away to replicate</button></div></div>
      <div class="row" style="margin-top:16px"><a class="btn" href="#/e/${slug}/evidence">See the evidence</a><a class="btn ghost" href="#/e/${slug}/observatory">Watch the world</a></div></div>`);
    // mini globe with the new pin
    const mini = document.createElement('canvas'); $('#mini', stage).append(mini);
    const g = new Globe(mini, { interactive: true });
    g.mode = 'all'; g.autoRotate = true; g.setTime(S.markMs); g.zoom = 1.15;
    g.lon0 = S.loc.lon; g.lat0 = Math.max(-45, Math.min(45, S.loc.lat * 0.6));
    g.setMarkers([{ id: r.id, lat: locRecord().lat, lon: locRecord().lon, t: S.markMs, kind: isShadow ? 'shadow' : 'sunset', theta: isShadow ? reduceShadow({ id: r.id, observer_id: me.id, received_ms: r.received_ms, record: S.sealedRecord })?.value : null, synthetic: false }]);
    setTimeout(() => g.pulse(locRecord().lat, locRecord().lon), 400);
    cleanups.push(() => g.destroy());
    $('#share', stage).addEventListener('click', async () => { const url = `${location.origin}/#/e/${slug}/run?replicate=${r.id}`; try { if (navigator.share) await navigator.share({ title: 'Reproduce my measurement', text: 'I measured this. Can you reproduce it where you are?', url }); else { await navigator.clipboard.writeText(url); toast('Link copied — send it to someone far away'); } } catch { /* cancelled */ } });
    // detail: predictions vs measurement
    const d = await api.get(`/api/observations/${r.id}`);
    const dv = d.derived;
    const rows = [];
    if (S.prediction) rows.push({ name: 'Your prediction', col: 'var(--amber)', v: isShadow ? `${fmt(S.prediction.value.zenith_deg, 1)}°` : fmtUTC(S.prediction.value.sunset_ms, { sec: true, date: false }), r: isShadow ? dv.value - S.prediction.value.zenith_deg : (dv.t - S.prediction.value.sunset_ms) / 1000 });
    rows.push({ name: isShadow ? 'You measured' : 'You recorded', col: 'var(--text)', v: isShadow ? `${fmt(dv.value, 1)}° ± ${fmt(dv.sigma, 1)}°` : fmtUTC(dv.t, { sec: true, date: false }), r: null });
    d.predictions.forEach((p, i) => rows.push({ name: p.name, col: modelColor({ family: p.family, params: p.params }, i), v: isShadow ? `${fmt(p.predicted, 1)}°` : p.predicted ? fmtUTC(p.predicted, { sec: true, date: false }) : '—', r: p.residual }));
    $('#rv', stage).innerHTML = rows.map((x, i) => `<div class="reveal-row" style="--mc:${x.col};animation-delay:${i * 260}ms"><b>${esc(x.name)}</b><span class="mono">${esc(x.v)}${x.r != null ? ` <span style="color:${x.col}">(${fmtSigned(x.r, isShadow ? 1 : 0)}${isShadow ? '°' : ' s'} from measured)</span>` : ''}</span></div>`).join('') + `<p class="hint">Residual = how far each guess or model was from what you measured. Your single measurement is one data point among many — its job is to join the others.</p>`;
  }

  draw();
  return () => { cleanups.forEach((f) => f()); stage.remove(); };
}
