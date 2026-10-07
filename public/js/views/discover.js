// Shadow Detectives — a guided, answer-free way to rediscover the shape of the world.
// Principles: one idea per screen · grade-2 words · big targets · read-aloud · the app never says
// what's true; it only shows how well *your* world matches what people really measured.
import { html, mount, esc, raw, fmt, fmtInt, $, $$, toast } from '../dom.js';
import { api } from '../api.js';
import { reduceShadow } from '/shared/analysis.js';
import { predictWith } from '/shared/models.js';
import { placeName } from '../places.js';

export const title = 'Shadow Detectives';

const KEY = 'observed.journal.shadows.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = (j) => { try { localStorage.setItem(KEY, JSON.stringify(j)); } catch { /* private mode */ } };

// Sun slider: 0..100 → 1,500 km … 150,000,000 km (log scale)
const sunKm = (v) => 1500 * 10 ** ((v / 100) * 5);
function sunWords(km) {
  if (km < 3000) return 'very close — like a lamp over the table';
  if (km < 20000) return 'close — like a lamp in the sky';
  if (km < 400000) return 'far';
  if (km < 5e6) return 'very far';
  return 'super, super far away';
}
const kmText = (km) => (km >= 1e6 ? `${fmt(km / 1e6, km >= 1e7 ? 0 : 1)} million km` : `${fmtInt(Math.round(km / 100) * 100)} km`);

// Pick ~8 places spread from the far south to the far north.
function pickSites(observations) {
  const real = observations.filter((o) => !o.synthetic);
  const pool = (real.length >= 8 ? real : observations).map((o) => ({ o, d: reduceShadow(o) })).filter((x) => x.d && x.d.value < 78 && !x.o.adj?.exclude && !(x.o.adj?.inflate > 1));
  const seen = new Set(), uniq = [];
  for (const x of pool.sort((a, b) => a.d.lat - b.d.lat)) { if (seen.has(x.o.observer_id)) continue; seen.add(x.o.observer_id); uniq.push(x); }
  if (uniq.length <= 8) return uniq;
  return Array.from({ length: 8 }, (_, i) => uniq[Math.round((i * (uniq.length - 1)) / 7)]);
}

const tolerance = (d) => Math.max(3, 2 * d.sigma);

function stick(site, { predicted = null, mark = null, size = 1 } = {}) {
  const h = 46 * size, len = (deg) => Math.min(120, h * Math.tan((Math.min(deg, 80) * Math.PI) / 180));
  const L = len(site.d.value), P = predicted != null ? len(predicted) : null;
  const ok = predicted != null && Math.abs(predicted - site.d.value) <= tolerance(site.d);
  return `<svg viewBox="0 0 170 92" class="kstick" role="img" aria-label="Stick in ${esc(placeName(site.d.lat, site.d.lon))} with a shadow">
    <line x1="8" y1="72" x2="162" y2="72" stroke="var(--line-2)" stroke-width="2"/>
    <rect x="${28 - 3}" y="${72 - h}" width="6" height="${h}" rx="3" fill="var(--text)"/>
    <line x1="28" y1="72" x2="${28 + L}" y2="72" stroke="var(--amber)" stroke-width="7" stroke-linecap="round"/>
    ${P != null ? `<line x1="28" y1="84" x2="${28 + P}" y2="84" stroke="${ok ? 'var(--mint)' : 'var(--coral)'}" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 9"/>` : ''}
    ${mark ? `<text x="${28 + L + 6}" y="62" style="font:600 11px var(--sans);fill:${mark.c}">${mark.t}</text>` : ''}
  </svg>`;
}

const SPEAK_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>';

export async function render(root, { day }) {
  day(true);
  const data = await api.get('/api/experiments/shadow-angle/data');
  const sites = pickSites(data.observations);
  const anySim = sites.some((s) => s.o.synthetic);
  const J = load();
  J.tries ||= [];
  const S = { step: J.step ?? 0, ground: 'ball', sun: 80, tested: false, result: null, hint: 0 };
  if (J.guess === 'plate') { S.ground = 'plate'; S.sun = 22; } else if (J.guess === 'ball') { S.ground = 'ball'; S.sun = 90; }
  const stage = document.createElement('div');
  root.append(stage);
  const STEPS = ['hello', 'look', 'guess', 'build', 'notes', 'next'];
  const go = (n) => { speechSynthesis?.cancel?.(); S.step = Math.max(0, Math.min(STEPS.length - 1, n)); J.step = S.step; save(J); draw(); window.scrollTo(0, 0); };
  let speakText = '';
  const speak = () => { if (!('speechSynthesis' in window)) { toast('Reading aloud isn’t supported on this device', 'warn'); return; } speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(speakText); u.rate = 0.88; speechSynthesis.speak(u); };

  function frame(narration, inner, { back = true, nextLabel = null, nextDisabled = false, onNext = null } = {}) {
    speakText = narration;
    mount(stage, html`<div class="kid wrap">
      <div class="kid-top"><div class="dots" aria-label="Step ${S.step + 1} of ${STEPS.length}">${raw(STEPS.map((_, i) => `<i class="${i < S.step ? 'done' : i === S.step ? 'now' : ''}"></i>`).join(''))}</div>
        <button class="icon-btn" id="say" aria-label="Read this page to me" title="Read to me">${raw(SPEAK_ICON)}</button></div>
      ${inner}
      <div class="kid-nav">${back && S.step > 0 ? html`<button class="btn" id="back">← Back</button>` : html`<a class="btn ghost" href="#/">Home</a>`}${nextLabel ? html`<button class="btn primary lg" id="next" ${nextDisabled ? 'disabled' : ''}>${nextLabel}</button>` : ''}</div>
    </div>`);
    $('#say', stage).addEventListener('click', speak);
    $('#back', stage)?.addEventListener('click', () => go(S.step - 1));
    $('#next', stage)?.addEventListener('click', () => (onNext ? onNext() : go(S.step + 1)));
  }

  function draw() { ({ hello, look, guess, build, notes, next: nextStep })[STEPS[S.step]](); }

  // ── 1. hello ──
  function hello() {
    frame('Hi! Let us be shadow detectives. A detective looks at clues and finds out what is true. Our clue is a shadow.', html`
      <div class="kid-card center">
        <svg class="stick-anim" viewBox="0 0 420 190" aria-hidden="true"><line x1="10" y1="150" x2="410" y2="150" stroke="var(--line-2)" stroke-width="2"/><g class="shade"><line x1="150" y1="150" x2="230" y2="150" stroke="var(--amber)" stroke-width="8" stroke-linecap="round" opacity=".85"/></g><line x1="150" y1="150" x2="150" y2="72" stroke="var(--text)" stroke-width="7" stroke-linecap="round"/><g class="sunorb"><circle cx="150" cy="36" r="15" fill="var(--amber)"/><circle cx="150" cy="36" r="26" fill="var(--amber)" opacity=".18"/></g></svg>
        <h1>Hi! Let’s be <em>shadow detectives.</em></h1>
        <p>A detective looks at clues to find out what is true.</p>
        <p>Our clue is a <b>shadow</b>.</p>
      </div>`, { nextLabel: 'Start →' });
  }

  // ── 2. look ──
  function look() {
    const longest = sites.reduce((a, b) => (b.d.value > a.d.value ? b : a)), shortest = sites.reduce((a, b) => (b.d.value < a.d.value ? b : a));
    const answered = J.same != null;
    frame('Look at the clues. Each stick is the same size. Each one stands in a different place on Earth. Look at the shadows. Are all the shadows the same?', html`
      <h1>Look at the clues</h1>
      <p class="big">Every stick is the <b>same size</b>. Each one stands in a <b>different place</b> on Earth. The orange line is its shadow.</p>
      ${anySim ? html`<p class="hint">These are practice sticks (computer-made). Real sticks from real people will replace them as they measure — you can add yours!</p>` : ''}
      <div class="sticks">${raw(sites.map((s) => `<div class="scard ${answered && s === longest ? 'hi-long' : ''} ${answered && s === shortest ? 'hi-short' : ''}">${stick(s, { mark: answered && s === longest ? { t: 'longest', c: 'var(--coral)' } : answered && s === shortest ? { t: 'shortest', c: 'var(--mint)' } : null })}<b>${esc(placeName(s.d.lat, s.d.lon))}</b></div>`).join(''))}</div>
      <div class="kid-card"><h2>Are all the shadows the same?</h2>
        <div class="choices two"><button class="choice ${J.same === 'yes' ? 'on' : ''}" data-a="yes">Yes, they look the same</button><button class="choice ${J.same === 'no' ? 'on' : ''}" data-a="no">No, some are different</button></div>
        ${answered ? html`<p class="notice">${J.same === 'no' ? 'Good looking!' : 'Look again!'} Find the <b style="color:var(--coral)">longest</b> and the <b style="color:var(--mint)">shortest</b> shadow. They are marked now.</p>` : ''}
      </div>`, { nextLabel: 'Next →', nextDisabled: !answered });
    $$('[data-a]', stage).forEach((b) => b.addEventListener('click', () => { J.same = b.dataset.a; save(J); look(); }));
  }

  // ── 3. guess ──
  function guess() {
    const opts = [
      ['ball', 'The ground is round like a ball. The Sun is very far away.'],
      ['plate', 'The ground is flat like a plate. The Sun is close, like a lamp.'],
      ['other', 'Something else. I have my own idea.'],
      ['dunno', 'I don’t know yet.'],
    ];
    frame('Why do you think the shadows are different? Pick the idea you like best. There are no wrong answers right now. We will test it.', html`
      <h1>Why are the shadows different?</h1>
      <p class="big">Pick the idea you like best. <b>No wrong answers yet</b> — we will test it!</p>
      <div class="choices">${raw(opts.map(([k, t]) => `<button class="choice ${J.guess === k ? 'on' : ''}" data-g="${k}"><span class="bullet"></span>${esc(t)}</button>`).join(''))}</div>
      ${J.guess === 'other' ? html`<div class="field" style="margin-top:14px"><label for="idea">Tell us your idea</label><textarea id="idea" maxlength="300" placeholder="I think…">${J.idea || ''}</textarea></div>` : ''}`, { nextLabel: 'Let’s test it →', nextDisabled: !J.guess });
    $$('[data-g]', stage).forEach((b) => b.addEventListener('click', () => {
      J.guess = b.dataset.g; if (J.guess === 'plate') { S.ground = 'plate'; S.sun = 22; } else if (J.guess === 'ball') { S.ground = 'ball'; S.sun = 90; }
      save(J); guess();
    }));
    $('#idea', stage)?.addEventListener('input', (e) => { J.idea = e.target.value; save(J); });
  }

  // ── 4. build a world ──
  const modelFor = () => (S.ground === 'plate' ? { family: 'flat_sun', params: { height_km: sunKm(S.sun) } } : { family: 'sphere_sun_distance', params: { sun_distance_km: sunKm(S.sun) } });
  const predictAll = () => sites.map((s) => predictWith(modelFor(), { lat: s.d.lat, lon: s.d.lon, t: s.d.t }).zenith_deg);
  function build() {
    const best = J.tries.reduce((a, b) => (!a || b.score > a.score ? b : a), null);
    frame('Build a world. Choose if the ground is a flat plate or a round ball. Then choose how far away the Sun is. Press test my world. See if your world makes the same shadows as the real sticks.', html`
      <h1>Build a world!</h1>
      <p class="big">Make a world, then <b>test</b> it. Does your world make the same shadows as the real sticks?</p>
      <div class="kid-card build">
        <div class="lbl">1 · The ground is a…</div>
        <div class="choices two"><button class="choice ${S.ground === 'plate' ? 'on' : ''}" data-ground="plate"><svg viewBox="0 0 60 30" width="54"><ellipse cx="30" cy="18" rx="26" ry="8" fill="none" stroke="currentColor" stroke-width="3"/></svg>Flat plate</button><button class="choice ${S.ground === 'ball' ? 'on' : ''}" data-ground="ball"><svg viewBox="0 0 60 30" width="54"><circle cx="30" cy="15" r="13" fill="none" stroke="currentColor" stroke-width="3"/></svg>Round ball</button></div>
        <div class="lbl" style="margin-top:20px">2 · How far away is the Sun?</div>
        <input type="range" id="sun" min="0" max="100" value="${S.sun}" aria-label="How far away is the Sun">
        <div class="row between"><span class="hint">close</span><span class="hint">far away</span></div>
        <div class="sunread" id="sunread"></div>
        <button class="btn primary lg" id="test" style="width:100%;margin-top:14px">Test my world</button>
      </div>
      <div id="result"></div>
      <div class="sticks" id="sticks">${raw(sites.map((s, i) => `<div class="scard">${stick(s, { predicted: S.result ? S.result.preds[i] : null })}<b>${esc(placeName(s.d.lat, s.d.lon))}</b><span class="tick">${S.result ? (S.result.hits[i] ? '✓ matches' : '✗ different') : ''}</span></div>`).join(''))}</div>
      ${S.result ? html`<div class="legend" style="margin:6px 0 14px"><span><i style="background:var(--amber)"></i>real shadow</span><span><i style="background:var(--mint)"></i>your world — matches</span><span><i style="background:var(--coral)"></i>your world — different</span></div>` : ''}
      <div class="kid-card"><h2>Worlds I tried <span class="faint mono" style="font-size:14px">${J.tries.length}</span></h2>
        ${J.tries.length ? html`<div class="tries">${raw(J.tries.slice().reverse().map((t) => `<div class="try ${best && t.n === best.n ? 'best' : ''}"><span>${t.ground === 'plate' ? 'Flat plate' : 'Round ball'} · Sun ${esc(kmText(t.km))}</span><b>${t.score} of ${sites.length}</b></div>`).join(''))}</div>` : html`<p class="hint">Nothing yet. Press “Test my world”.</p>`}
        <div class="hints">${[
          ['Hint 1', 'Move the Sun slider and test again. What changes?'],
          ['Hint 2', 'Look at the places that are very far from where the Sun is shining. Which ones are wrong?'],
          ['Hint 3', 'Is there a world that matches every place? Try both ground shapes.'],
        ].map(([h, t], i) => `<button class="btn sm ghost" data-hint="${i}">${h}</button>`).join('')}</div>
        <p class="notice" id="hintbox" ${S.hint ? '' : 'hidden'}>${esc(['', 'Move the Sun slider and test again. What changes?', 'Look at the places that are very far from where the Sun is shining. Which ones are wrong?', 'Is there a world that matches every place? Try both ground shapes.'][S.hint] || '')}</p>
      </div>`, { nextLabel: 'I found out something →', nextDisabled: J.tries.length < 3 });
    const upd = () => { $('#sunread', stage).innerHTML = `The Sun is <b>${esc(sunWords(sunKm(S.sun)))}</b><br><span class="mono dim">about ${esc(kmText(sunKm(S.sun)))}</span>`; };
    upd();
    $('#sun', stage).addEventListener('input', (e) => { S.sun = +e.target.value; upd(); });
    $$('[data-ground]', stage).forEach((b) => b.addEventListener('click', () => { S.ground = b.dataset.ground; $$('[data-ground]', stage).forEach((x) => x.classList.toggle('on', x === b)); }));
    $$('[data-hint]', stage).forEach((b) => b.addEventListener('click', () => { S.hint = +b.dataset.hint + 1; $('#hintbox', stage).hidden = false; $('#hintbox', stage).textContent = ['Move the Sun slider and test again. What changes?', 'Look at the places that are very far from where the Sun is shining. Which ones are wrong?', 'Is there a world that matches every place? Try both ground shapes.'][+b.dataset.hint]; }));
    $('#test', stage).addEventListener('click', () => {
      const preds = predictAll();
      const hits = preds.map((p, i) => Math.abs(p - sites[i].d.value) <= tolerance(sites[i].d));
      const score = hits.filter(Boolean).length;
      S.result = { preds, hits, score };
      J.tries.push({ n: J.tries.length + 1, ground: S.ground, km: sunKm(S.sun), score });
      save(J);
      build();
      $('#sticks', stage).scrollIntoView({ behavior: 'smooth', block: 'center' });
      const r = $('#result', stage);
      r.innerHTML = `<div class="kid-card verdict"><div class="faces">${face(score / sites.length)}</div><div><h2>Your world matches <b>${score} of ${sites.length}</b> places.</h2><p class="hint" style="margin:0">${score === sites.length ? 'Every place matches! Can another world do that too?' : 'The dotted line is what <i>your</i> world says. It is green when it matches the real shadow.'}</p></div></div>`;
    });
  }
  const face = (f) => `<svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="29" fill="none" stroke="${f > 0.75 ? 'var(--mint)' : f > 0.4 ? 'var(--amber)' : 'var(--coral)'}" stroke-width="4"/><circle cx="23" cy="26" r="3.5" fill="currentColor"/><circle cx="41" cy="26" r="3.5" fill="currentColor"/><path d="${f > 0.75 ? 'M19 39 Q32 53 45 39' : f > 0.4 ? 'M21 43 L43 43' : 'M20 47 Q32 35 44 47'}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`;

  // ── 5. notes ──
  function notes() {
    const best = J.tries.reduce((a, b) => (!a || b.score > a.score ? b : a), null);
    frame('What did you find out? Look at your best world. Write what you learned in your own words. How sure are you? What would make you change your mind?', html`
      <h1>What did you find out?</h1>
      ${best ? html`<div class="kid-card"><div class="lbl">The best world I found</div><p class="big" style="margin:6px 0 0">A <b>${best.ground === 'plate' ? 'flat plate' : 'round ball'}</b> with the Sun <b>${sunWords(best.km)}</b> <span class="mono dim">(${kmText(best.km)})</span> — it matched <b>${best.score} of ${sites.length}</b> places.</p></div>` : ''}
      <div class="kid-card stack">
        <div class="field"><label for="found">In my own words, I found out that…</label><textarea id="found" maxlength="500" placeholder="I found out…">${esc(J.found || '')}</textarea></div>
        <div><div class="lbl" style="margin-bottom:8px">How sure am I?</div><div class="choices three">${[['low', 'Not sure yet'], ['mid', 'A little sure'], ['high', 'Very sure']].map(([k, t]) => `<button class="choice ${J.sure === k ? 'on' : ''}" data-s="${k}">${t}</button>`).map(raw)}</div></div>
        <div class="field"><label for="change">What would make me change my mind?</label><textarea id="change" maxlength="300" placeholder="I would change my mind if…">${esc(J.change || '')}</textarea></div>
        <p class="hint">Only you can see this notebook. It stays on this device.</p>
      </div>`, { nextLabel: 'Save & keep going →' });
    $('#found', stage).addEventListener('input', (e) => { J.found = e.target.value; save(J); });
    $('#change', stage).addEventListener('input', (e) => { J.change = e.target.value; save(J); });
    $$('[data-s]', stage).forEach((b) => b.addEventListener('click', () => { J.sure = b.dataset.s; save(J); $$('[data-s]', stage).forEach((x) => x.classList.toggle('on', x === b)); }));
  }

  // ── 6. next ──
  function nextStep() {
    frame('Now you can measure a shadow yourself. Go outside, put a stick in the ground, and add your clue. Your shadow is one more clue for everyone.', html`
      <div class="kid-card center">
        <h1>Now it’s <em>your</em> turn.</h1>
        <p class="big">Real detectives collect their <b>own</b> clues. Put a stick in the ground, measure its shadow, and add yours.</p>
        <div class="stack" style="margin-top:20px"><a class="btn primary lg" href="#/e/shadow-angle/run" style="width:100%">Measure my own shadow</a><button class="btn" id="again" style="width:100%">Try more worlds</button><a class="btn ghost" href="#/e/shadow-angle/evidence" style="width:100%">See what everyone found</a></div>
        <p class="hint" style="margin-top:18px">Open to any idea: if you find a world that matches <i>every</i> place, we want to hear about it.</p>
      </div>`, { nextLabel: null });
    $('#again', stage).addEventListener('click', () => go(3));
  }

  draw();
  return () => { speechSynthesis?.cancel?.(); stage.remove(); };
}
