import { html, mount, esc, fmt, fmtInt, fmtUTC, fmtDate, ago, raw, $, $$ } from '../dom.js';
import { api } from '../api.js';
import { toMarker } from '../lib.js';
import { mountObservatory } from '../stage.js';
import { mountWorlds } from '../worlds.js';
import { placeName } from '../places.js';
import { observerName, shortId } from '/shared/names.js';
import { analyze } from '/shared/analysis.js';
import { renderEvidence } from './evidence.js';
import { renderModels } from './models.js';
import { renderChallenges } from './challenges.js';

const TABS = [['overview', 'Overview'], ['observatory', 'Observatory'], ['evidence', 'Evidence'], ['models', 'Models'], ['challenges', 'Challenges']];

export const title = ([slug]) => ({ 'shadow-angle': 'The Shadow Stick', 'sunset-sync': 'One Sunset, Everywhere' }[slug] || 'Experiment');

export async function render(root, { params: [slug, tab = 'overview'] }) {
  const [def, data] = await Promise.all([api.get(`/api/experiments/${slug}`), api.get(`/api/experiments/${slug}/data`)]);
  if (!TABS.some(([k]) => k === tab)) tab = 'overview';
  const S = def.summary_stats, c = S.counts;
  const ctx = { slug, def, data, root };
  ctx.analysis = (opts) => analyze(slug, { observations: data.observations, attempts: data.attempts, models: data.models, challenges: data.challenges, opts });
  const simOnly = c.real === 0 && c.measured > 0;

  mount(root, html`
    <div class="wrap" style="padding-top:34px">
      <div class="row between" style="align-items:flex-start;gap:24px">
        <div style="max-width:760px">
          <div class="eyebrow">${def.kicker} · protocol v${def.version}</div>
          <h1 class="h-xl" style="font-size:clamp(40px,6vw,72px);margin:14px 0 14px">${def.title}</h1>
          <p class="q dim" style="margin:0">${def.question}</p>
        </div>
        <div class="row" style="gap:10px"><a class="btn primary lg" href="#/e/${slug}/run">Run this experiment</a></div>
      </div>
      <div class="row" style="gap:34px;margin-top:26px">
        <div class="stat"><span class="n">${fmtInt(c.measured)}</span><span class="l">observations</span></div>
        <div class="stat"><span class="n">${fmtInt(c.observers)}</span><span class="l">observers</span></div>
        <div class="stat"><span class="n">${c.failed}</span><span class="l">failed attempts shown</span></div>
        <div class="stat"><span class="n">${c.models}</span><span class="l">locked models</span></div>
        <div class="stat"><span class="n">${c.open_challenges}</span><span class="l">open challenges</span></div>
      </div>
      ${simOnly ? html`<div class="callout sim" style="margin-top:22px"><b>All current data is simulated.</b> A demonstration campaign is loaded so you can explore every feature. It is generated from the round-Earth model plus realistic instrument error, labelled <span class="pill sim">simulated</span> everywhere, and can be switched off in the Evidence tab. <b>Your measurement will be the first real one.</b></div>` : ''}
      <nav class="tabs" aria-label="Experiment sections">${raw([].concat(TABS.map(([k, l]) => `<a href="#/e/${slug}/${k}" class="${k === tab ? 'on' : ''}">${l}${k === 'challenges' ? `<span class="ct">${data.challenges.length}</span>` : k === 'models' ? `<span class="ct">${data.models.length}</span>` : ''}</a>`).join('')).join(''))}</nav>
      <div id="tab"></div>
    </div>`);

  const el = root.querySelector('#tab');
  let cleanup;
  if (tab === 'overview') cleanup = await overview(el, ctx);
  else if (tab === 'observatory') cleanup = await observatory(el, ctx);
  else if (tab === 'evidence') cleanup = await renderEvidence(el, ctx);
  else if (tab === 'models') cleanup = await renderModels(el, ctx);
  else if (tab === 'challenges') cleanup = await renderChallenges(el, ctx);
  return cleanup;
}

async function overview(el, { slug, def, data, analysis }) {
  const a = analysis({ bootstrapN: 200 });
  mount(el, html`
    <div class="grid g2" style="gap:28px;align-items:start">
      <div class="stack">
        <div class="card glow">
          <div class="row between"><span class="eyebrow">Current result</span><span class="pill ${a.rubric.label === 'Demonstration only' ? 'sim' : 'amber'}">${a.rubric.label}</span></div>
          <p style="font-size:17px;line-height:1.55;margin:14px 0 18px">${a.headline}</p>
          <div class="row" style="gap:18px">
            <div class="score-ring" style="--p:${(a.rubric.score / a.rubric.outOf) * 100}"><b>${a.rubric.score}/${a.rubric.outOf}</b></div>
            <div class="grow hint">Evidence checks passed. This is a checklist — not a verdict. See exactly what’s missing, and why, in the Evidence tab.</div>
          </div>
          <div style="margin-top:16px"><a class="btn sm" href="#/e/${slug}/evidence">Inspect the evidence →</a></div>
        </div>
        <div class="card"><h3 class="h-md" style="margin-bottom:14px">Hypotheses under test</h3><ul class="plain stack">${raw([].concat(def.hypotheses.map((h) => `<li class="dim">${esc(h)}</li>`).join('')).join(''))}</ul></div>
        <div class="callout safe"><b>Safety.</b> ${esc(def.safety)}</div>
      </div>
      <div class="stack">
        <div class="card"><h3 class="h-md" style="margin-bottom:16px">The protocol</h3>
          <ol class="steps plain" style="padding:0;margin:0">${raw([].concat(def.steps.map((s) => `<li><div><b>${esc(s.title)}</b><span>${esc(s.body)}</span></div></li>`).join('')).join(''))}</ol>
        </div>
        <div class="grid g2">
          <div class="card tight"><div class="lbl" style="margin-bottom:8px">You’ll need</div><ul class="plain stack dim" style="font-size:14px">${raw([].concat(def.equipment.map((x) => `<li>${esc(x)}</li>`).join('')).join(''))}</ul></div>
          <div class="card tight"><div class="lbl" style="margin-bottom:8px">Recorded</div><ul class="plain stack dim" style="font-size:14px">${raw([].concat(def.measurements.map((x) => `<li>${esc(x)}</li>`).join('')).join(''))}</ul></div>
        </div>
        <div class="card tight"><div class="lbl" style="margin-bottom:8px">Assumptions — all of them</div><ul class="stack dim" style="font-size:14px;padding-left:18px;margin:0">${raw([].concat(def.assumptions.map((x) => `<li>${esc(x)}</li>`).join('')).join(''))}</ul></div>
        <div class="hash">protocol hash ${def.protocol_hash} — bound into every observation you submit.</div>
      </div>
    </div>
    ${slug === 'shadow-angle' ? html`<section style="margin-top:56px"><div class="eyebrow">Explore the claim</div><h2 class="h-lg" style="margin:12px 0 22px">What each world predicts</h2><div id="worlds"></div></section>` : ''}`);
  if (slug === 'shadow-angle') mountWorlds(el.querySelector('#worlds'));
}

async function observatory(el, { slug, def, data }) {
  const markers = data.observations.map((o) => toMarker(o, slug)).filter(Boolean);
  mount(el, html`
    <div class="globe-panel" id="stage"></div>
    <p class="hint" style="margin-top:10px">Drag to rotate · pinch/scroll to zoom · click a pin to open the raw record. ${slug === 'shadow-angle' ? 'Each amber stroke is a real shadow, drawn pointing away from the Sun at the instant it was measured.' : 'Each pin lights up at the second an observer saw the Sun disappear.'}</p>
    <div class="row between" style="margin:34px 0 14px"><h2 class="h-md">Every observation</h2>
      <div class="seg" id="filter" role="group" aria-label="Filter"><button data-f="all" class="on">All</button><button data-f="real">Real</button><button data-f="sim">Simulated</button><button data-f="amended">Amended</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>When (UTC)</th><th>Where</th><th>Observer</th><th class="num">${slug === 'shadow-angle' ? 'Shadow angle' : 'Sun gone at'}</th><th>Flags</th></tr></thead><tbody id="rows"></tbody></table></div>
    <h2 class="h-md" style="margin:42px 0 6px">Failed attempts</h2><p class="dim" style="font-size:14.5px">Experiments fail. Showing them keeps the success rate honest.</p>
    <div class="table-wrap"><table><thead><tr><th>When (UTC)</th><th>Where</th><th>Observer</th><th>Why it failed</th></tr></thead><tbody>${raw([].concat(data.attempts.length ? data.attempts.map((a) => `<tr class="click" data-go="${a.id}"><td class="mono nowrap">${fmtUTC(a.record.captured_ms)}</td><td>${esc(placeName(a.record.location.lat, a.record.location.lon))}</td><td>${esc(observerName(a.observer_id))}</td><td>${esc(a.record.failure_reason)} ${a.synthetic ? '<span class="pill sim">simulated</span>' : ''}</td></tr>`).join('') : '<tr><td colspan="4" class="dim">None recorded yet.</td></tr>').join(''))}</tbody></table></div>`);
  const st = mountObservatory(el.querySelector('#stage'), markers, { onPick: (m) => { location.hash = `#/o/${m.id}`; } });
  const rows = el.querySelector('#rows');
  const byId = new Map(markers.map((m) => [m.id, m]));
  const repCount = {};
  data.observations.forEach((o) => { if (o.replicates) repCount[o.replicates] = (repCount[o.replicates] || 0) + 1; });
  const draw = (f) => {
    const list = [...data.observations].sort((a, b) => b.record.captured_ms - a.record.captured_ms).filter((o) => f === 'all' || (f === 'real' && !o.synthetic) || (f === 'sim' && o.synthetic) || (f === 'amended' && o.amended));
    rows.innerHTML = list.length ? list.map((o) => {
      const m = byId.get(o.id);
      const r = o.record;
      const val = slug === 'shadow-angle' ? `${fmt(m?.value, 1)}° ± ${fmt(m?.sigma, 1)}°` : new Date(r.measurements.sunset_ms).toISOString().slice(11, 19);
      return `<tr class="click" data-go="${o.id}" data-id="${o.id}"><td class="mono nowrap">${fmtUTC(r.captured_ms)}</td><td>${esc(placeName(r.location.lat, r.location.lon))}</td><td>${esc(observerName(o.observer_id))} <span class="faint mono">${shortId(o.observer_id)}</span></td><td class="num">${val}</td><td>${o.synthetic ? '<span class="pill sim">simulated</span> ' : '<span class="pill real">real</span> '}${o.amended ? '<span class="pill amber">amended</span> ' : ''}${repCount[o.id] ? `<span class="pill ok">${repCount[o.id]}× replicated</span> ` : ''}${o.replicates ? '<span class="pill">replication</span> ' : ''}${o.adj?.exclude || o.adj?.inflate > 1 ? '<span class="pill bad">challenge upheld</span>' : ''}</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="dim">Nothing matches.</td></tr>';
  };
  draw('all');
  el.querySelector('#filter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $$('#filter button', el).forEach((x) => x.classList.toggle('on', x === b)); draw(b.dataset.f); });
  el.addEventListener('click', (e) => { const tr = e.target.closest('[data-go]'); if (tr) location.hash = `#/o/${tr.dataset.go}`; });
  el.addEventListener('mouseover', (e) => { const tr = e.target.closest('tr[data-id]'); const m = tr && byId.get(tr.dataset.id); if (m) { st.globe.highlightId = m.id; st.globe.dirty = true; } });
  return () => st.destroy();
}
