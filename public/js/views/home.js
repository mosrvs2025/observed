import { html, mount, esc, fmtUTC, fmtInt, ago, fmtDate } from '../dom.js';
import { api, liveStream } from '../api.js';
import { toMarker, ICON } from '../lib.js';
import { mountHeroGlobe } from '../stage.js';
import { mountWorlds } from '../worlds.js';
import { placeName } from '../places.js';

export async function render(root) {
  const [overview, shadow, sunset] = await Promise.all([api.get('/api/overview'), api.get('/api/experiments/shadow-angle/data'), api.get('/api/experiments/sunset-sync/data')]);
  const markers = [
    ...shadow.observations.map((o) => toMarker(o, 'shadow-angle')),
    ...sunset.observations.map((o) => toMarker(o, 'sunset-sync')),
  ].filter(Boolean);
  const st = overview.stats;
  const exps = overview.experiments;

  mount(root, html`
  <section class="hero">
    <div class="globe-bg"><canvas id="hero-globe" aria-label="Live globe of observations"></canvas></div>
    <div class="wrap"><div class="copy">
      <div class="eyebrow">A distributed observatory · for anyone with a phone</div>
      <h1 class="h-xl" style="margin:18px 0 22px">Test the world <em>yourself.</em></h1>
      <p class="lede">You don’t have to believe anyone. Pick an experiment. Make a prediction. Measure reality — then compare it with everyone else on Earth who did the same.</p>
      <div class="cta">
        <a class="btn primary lg" href="#/discover">Start discovering →</a>
        <a class="btn lg ghost" href="#/e/shadow-angle/run">Measure a shadow now</a>
      </div>
      <p class="hint" style="margin-top:18px">No sign-up, no account. Made so anyone can follow it — even a kid. Open to any idea.</p>
    </div></div>
    <div class="hud" id="hud"><span class="live"></span><span id="hud-text">Loading the observatory…</span><button class="btn sm ghost" id="hud-live" style="min-height:28px;padding:5px 10px" hidden>Go live</button></div>
  </section>

  <div class="wrap">
    <div class="loop" aria-label="The scientific loop">
      ${[['01', 'Hypothesis', 'A claim that can be wrong'], ['02', 'Prediction', 'Locked before data arrives'], ['03', 'Experiment', 'A protocol anyone can repeat'], ['04', 'Observation', 'Signed by your device'], ['05', 'Math', 'Open, and runs in your browser'], ['06', 'Result', 'With uncertainty, never hidden'], ['07', 'Replication', 'Does someone else get the same?']].map(([n, t, d]) => html`<div><small>${n}</small><b>${t}</b>${d}</div>`)}
    </div>
  </div>

  <section class="wrap section">
    <div class="grid g2" style="gap:40px;align-items:end;margin-bottom:26px">
      <div><div class="eyebrow">Wait… I can actually test this?</div><h2 class="h-lg" style="margin-top:14px">One stick. Two places.<br>Two competing pictures of the world.</h2></div>
      <p class="lede">A stick’s shadow tells you the Sun’s angle where you stand. If the Earth is round and the Sun is far, shadows at different latitudes follow one rule. If the Earth is flat and the Sun is near, they follow a different one. The rules disagree — and you can measure which one the world obeys.</p>
    </div>
    <div id="worlds"></div>
  </section>

  <section class="wrap section">
    <div class="row between" style="margin-bottom:22px"><h2 class="h-lg">Live experiments</h2><a class="btn ghost sm" href="#/experiments">All experiments →</a></div>
    <div class="grid g2">${exps.map((e) => expCard(e))}</div>
  </section>

  <section class="wrap section">
    <div class="grid g2" style="gap:40px;align-items:start">
      <div>
        <div class="eyebrow">Not trust. Verification.</div>
        <h2 class="h-lg" style="margin:14px 0 18px">Built so you never have to take our word for it.</h2>
        <p class="lede">OBSERVED isn’t an authority. It’s an instrument: it makes claims measurable, keeps the receipts, and shows you every messy number.</p>
        <a class="btn" href="#/method" style="margin-top:10px">How the evidence works</a>
      </div>
      <div class="grid" style="gap:12px">
        ${[['Predictions before results', 'Models are locked and timestamped before observations arrive. Explanations written afterwards are labelled as such.'], ['Signed by your phone', 'Each record is hashed, signed with a key that never leaves your device, and chained into a public, append-only ledger.'], ['Challenges that count', 'Disagreement isn’t a comment thread. Structured challenges show exactly how the result would change if they’re right.'], ['The mess stays visible', 'Failed attempts, outliers, poor GPS, simulated data — all shown, all filterable, nothing quietly dropped.']].map(([t, d]) => html`<div class="card tight"><b>${t}</b><div class="dim" style="font-size:14.5px;margin-top:4px">${d}</div></div>`)}
      </div>
    </div>
  </section>

  <section class="wrap section">
    <div class="grid g2" style="gap:30px;align-items:start">
      <div><h2 class="h-md" style="margin-bottom:6px">Just arrived</h2><p class="dim" style="font-size:14px">Newest accepted records, streamed live.</p><div class="ticker" id="ticker"></div></div>
      <div>
        <h2 class="h-md" style="margin-bottom:6px">Coming next</h2><p class="dim" style="font-size:14px">Proposals. Tell us which you would run.</p>
        <div class="grid" style="gap:10px" id="proposed">${overview.proposed.slice(0, 4).map((p) => html`<a class="card tight" href="#/experiments"><div class="row between"><b>${p.title}</b><span class="pill">${p.kicker}</span></div><div class="dim" style="font-size:14px;margin-top:4px">${p.blurb}</div></a>`)}</div>
      </div>
    </div>
  </section>`);

  mountWorlds(root.querySelector('#worlds'));

  // hero globe
  const hudText = root.querySelector('#hud-text'), liveBtn = root.querySelector('#hud-live');
  const real = st.real_observations;
  const hero = mountHeroGlobe(root.querySelector('#hero-globe'), markers, {
    onPick: (m) => { location.hash = `#/o/${m.id}`; },
    onTick: (t, live, win) => {
      const n = markers.filter((m) => m.t <= t).length;
      hudText.innerHTML = live ? `LIVE · ${fmtUTC(t, { date: false })} · ${fmtInt(markers.length)} observations on record` : `Replaying the equinox campaign · ${fmtUTC(t)} · ${n}/${markers.length} measured`;
    },
  });
  liveBtn.hidden = !hero.hasReplay;
  liveBtn.addEventListener('click', () => { hero.setLive(!hero.live); liveBtn.textContent = hero.live ? 'Replay' : 'Go live'; });
  liveBtn.textContent = 'Go live';

  // ticker (recent) + live stream
  const tick = root.querySelector('#ticker');
  const recent = [...shadow.observations.map((o) => ({ ...o, exp: 'shadow-angle' })), ...sunset.observations.map((o) => ({ ...o, exp: 'sunset-sync' }))].sort((a, b) => b.received_ms - a.received_ms).slice(0, 7);
  const row = (id, exp, lat, lon, ms, sim) => `<a href="#/o/${id}"><span class="pin ${sim ? 'sim' : ''}"></span><span>${exp === 'shadow-angle' ? 'Shadow measured' : 'Sunset logged'} · <b>${esc(placeName(lat, lon))}</b>${sim ? ' <span class="pill sim">simulated</span>' : ''}</span><span class="faint mono" style="font-size:12px">${ago(ms)}</span></a>`;
  tick.innerHTML = recent.map((o) => row(o.id, o.exp, o.record.location.lat, o.record.location.lon, o.received_ms, o.synthetic)).join('');
  const stop = liveStream((e) => {
    if (e.kind !== 'observation' || e.lat == null || e.outcome !== 'measured') return;
    hero.globe.pulse(e.lat, e.lon, e.experiment === 'sunset-sync' ? '255,128,92' : '255,184,77');
    tick.insertAdjacentHTML('afterbegin', row(e.id, e.experiment, e.lat, e.lon, Date.now(), e.synthetic));
    while (tick.children.length > 7) tick.lastChild.remove();
  });
  return () => { stop(); hero.destroy(); };
}

function expCard(e) {
  const c = e.counts;
  return html`<a class="card exp-card glow" href="#/e/${e.slug}">
    <div class="row between"><span class="eyebrow">${e.kicker}</span><span class="pill ${c.real ? 'real' : 'sim'}">${c.real ? c.real + ' real' : 'demo data'}</span></div>
    <h3>${e.title}</h3>
    <p class="dim" style="margin:0">${e.question}</p>
    <div class="meta"><div class="stat"><span class="n">${fmtInt(c.measured)}</span><span class="l">observations</span></div><div class="stat"><span class="n">${fmtInt(c.observers)}</span><span class="l">observers</span></div><div class="stat"><span class="n">${c.models}</span><span class="l">models</span></div></div>
  </a>`;
}

export const title = 'Test the world yourself';
