import { html, mount, esc, fmt, fmtInt, fmtUTC, debounce, raw, $, $$ } from '../dom.js';
import { modelColor } from '../lib.js';
import { modelScatter, residualByLatitude, pairStrip, sunsetStrip, scoreBars } from '../charts.js';
import { fmtLR, DEFAULT_OPTS } from '/shared/analysis.js';
import { observerName } from '/shared/names.js';

export async function renderEvidence(el, ctx) {
  const { slug, def, data } = ctx;
  const opts = { ...DEFAULT_OPTS, bootstrapN: 300 };
  const isShadow = slug === 'shadow-angle';
  mount(el, html`
    <div class="grid" style="grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:28px;align-items:start" id="evgrid">
      <aside class="card tight stack" style="position:sticky;top:76px" id="knobs">
        <div><div class="eyebrow">Turn the knobs</div><p class="hint" style="margin:8px 0 0">Everything below is recomputed <b>in your browser</b> from the raw signed records. Change an assumption; watch the conclusion respond.</p></div>
        <div class="knob"><label class="lbl" for="k-sys">Unmodelled-error floor</label><span class="mono amber" id="k-sys-v"></span>
          <input id="k-sys" type="range" min="0" max="${isShadow ? 3 : 120}" step="${isShadow ? 0.1 : 5}" value="${isShadow ? opts.sigmaSys : opts.sigmaSysSec}" style="grid-column:1/-1"></div>
        <div class="hint" style="margin-top:-6px">Added in quadrature to every observation’s own uncertainty. Bigger floor = harder for any model to look bad.</div>
        <label class="switch"><input type="checkbox" id="k-sim" checked> Include simulated demo data</label>
        <div><div class="lbl" style="margin-bottom:6px">Challenges</div>
          <div class="seg" id="k-ch"><button data-v="none">Ignore</button><button data-v="upheld" class="on">Upheld only</button><button data-v="all">What if all hold</button></div></div>
        <hr class="hr" style="margin:6px 0">
        <a class="btn sm" href="/api/export/${slug}" download>Download raw signed data</a>
        <a class="btn sm ghost" href="/shared/analysis.js" target="_blank" rel="noopener">Read the analysis code</a>
      </aside>
      <div id="results" class="stack" style="min-width:0"></div>
    </div>`);
  const style = document.createElement('style');
  style.textContent = '@media (max-width: 900px){ #evgrid { grid-template-columns: 1fr !important; } #knobs { position: static !important; } }';
  el.append(style);

  const out = el.querySelector('#results');
  const label = () => { el.querySelector('#k-sys-v').textContent = isShadow ? `${opts.sigmaSys.toFixed(1)}°` : `${opts.sigmaSysSec} s`; };
  label();
  const draw = () => {
    const a = ctx.analysis(opts);
    out.innerHTML = (isShadow ? shadowResults(a, ctx) : sunsetResults(a, ctx)).s;
  };
  draw();
  const redo = debounce(draw, 120);
  el.querySelector('#k-sys').addEventListener('input', (e) => { if (isShadow) opts.sigmaSys = +e.target.value; else opts.sigmaSysSec = +e.target.value; label(); redo(); });
  el.querySelector('#k-sim').addEventListener('change', (e) => { opts.includeSynthetic = e.target.checked; draw(); });
  el.querySelector('#k-ch').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; opts.challengeMode = b.dataset.v; $$('#k-ch button', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); });
  out.addEventListener('click', (e) => { const g = e.target.closest('[data-id]'); if (g?.dataset.id) location.hash = `#/o/${g.dataset.id}`; });
}

function common(a, ctx) {
  const colors = a.score.perModel.map((p, i) => modelColor(p.model, i));
  const rub = a.rubric;
  const fails = a.attempts;
  return {
    colors,
    head: html`
      <div class="card glow">
        <div class="row between"><span class="eyebrow">What the data say</span><span class="pill ${rub.label === 'Demonstration only' ? 'sim' : 'amber'}">${rub.label}</span></div>
        <p style="font-size:18px;line-height:1.55;margin:14px 0 0">${a.headline}</p>
      </div>`,
    rubric: html`
      <div class="card"><div class="row" style="gap:20px;align-items:flex-start">
        <div class="score-ring" style="--p:${(rub.score / rub.outOf) * 100}"><b>${rub.score}/${rub.outOf}</b></div>
        <div class="grow"><h3 class="h-md" style="margin-bottom:6px">How much weight can this carry?</h3><p class="hint" style="margin:0 0 14px">A checklist, not a score to chase. Every missing item is a way this result could be wrong.</p>
        <div class="rubric">${rub.items.map((i) => html`<div class="it ${i.pass ? 'pass' : ''}"><span class="ck">${i.pass ? '✓' : ''}</span><div>${i.label}<small>${i.detail}</small></div></div>`)}</div></div>
      </div></div>`,
    messy: html`
      <div class="card"><h3 class="h-md" style="margin-bottom:10px">The messy parts, on purpose</h3>
        <div class="grid g3" style="gap:18px">
          <div class="stat"><span class="n">${fails.failed}</span><span class="l">failed attempts of ${fails.total}</span></div>
          <div class="stat"><span class="n">${ctx.data.challenges.filter((c) => c.status === 'upheld').length}</span><span class="l">challenges upheld</span></div>
          <div class="stat"><span class="n">${ctx.data.observations.filter((o) => o.amended).length}</span><span class="l">amended records (originals kept)</span></div>
        </div>
        <ul class="dim" style="font-size:14px;padding-left:18px;margin:14px 0 0">${raw([].concat(fails.reasons.map((r) => `<li><a href="#/o/${r.id}">${esc(r.reason)}</a>${r.synthetic ? ' · simulated' : ''}</li>`).join('') || '<li>No failed attempts reported yet.</li>').join(''))}</ul>
      </div>`,
    assumptions: html`
      <div class="card tight"><div class="lbl" style="margin-bottom:8px">Assumptions behind these numbers</div><ul class="stack dim" style="font-size:14px;padding-left:18px;margin:0">${raw([].concat(ctx.def.assumptions.map((x) => `<li>${esc(x)}</li>`).join('')).join(''))}<li>Models are scored on <b>${a.opts.includeSynthetic ? 'all' : 'real-device'}</b> observations; unmodelled-error floor ${ctx.slug === 'shadow-angle' ? a.opts.sigmaSys.toFixed(1) + '°' : a.opts.sigmaSysSec + ' s'}; challenges: ${a.opts.challengeMode === 'upheld' ? 'upheld only' : a.opts.challengeMode === 'none' ? 'ignored' : 'all treated as upheld (what-if)'}.</li></ul></div>`,
  };
}

function scoreboard(a, colors, unit) {
  const rows = a.score.perModel.map((p, i) => {
    const lr = p.dchi2 > 0 ? `10<sup>−${fmtLRexp(p.dchi2)}</sup>` : '<b class="mint">best</b>';
    return `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colors[i]};margin-right:8px"></span><b>${esc(p.model.name)}</b>${p.model.synthetic ? ' <span class="pill sim">seed</span>' : ''}<div class="hint">locked ${fmtUTC(p.model.registered_ms)} · ledger #${p.model.ledger_seq} · by ${esc(observerName(p.model.observer_id))}</div></td>
      <td class="num">${p.n}</td><td class="num">${fmt(p.rms, p.rms < 10 ? 2 : 1)}${unit}</td><td class="num">${fmt(p.chi2_red, 1)}</td><td class="num">${p.blind.n} · ${p.blind.n ? fmt(p.blind.rms, 2) + unit : '—'}</td><td class="num">${lr}</td><td class="num">${p.winner_freq != null ? fmt(p.winner_freq * 100, 0) + '%' : '—'}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr><th>Model</th><th class="num">n</th><th class="num">RMS miss</th><th class="num">χ²/ν</th><th class="num" title="Observations that arrived after this model was locked">Blind n · RMS</th><th class="num" title="Likelihood relative to the best model, assuming Gaussian errors">Likelihood vs best</th><th class="num" title="How often this model scored best when whole observers were resampled">Best in resamples</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
const fmtLRexp = (dchi2) => { const e = dchi2 / 2 / Math.LN10; return e > 9 ? Math.round(e) : e.toFixed(1); };

function shadowResults(a, ctx) {
  const { colors, head, rubric, messy, assumptions } = common(a, ctx);
  const P = a.pairs, pm = a.score.perModel;
  const flatRefs = pm.filter((p) => p.model.family === 'flat_sun').map((p) => ({ v: p.model.params.height_km, color: 'var(--coral)', label: `${(p.model.params.height_km / 1000).toFixed(1)}k` }));
  const bf = a.bestFlat, sphere = pm.find((p) => p.model.family === 'sphere_parallel');
  return html`
    ${head}
    <div class="card"><h3 class="h-md" style="margin-bottom:6px">Scoreboard</h3><p class="hint" style="margin:0 0 14px">Models are parametric and were locked <em>before</em> the observations they’re scored on. “Blind” counts only observations that arrived after the lock.</p>
      <div class="stack" style="margin-bottom:18px">${raw(scoreBars(pm, colors))}</div>${raw(scoreboard(a, colors, '°'))}
      ${bf ? html`<div class="callout" style="margin-top:16px"><span class="pill amber" style="margin-right:6px">after the fact</span>If the flat model is allowed to pick its Sun height <i>from this data</i>, it settles at <b class="mono">${fmtInt(bf.height_km)} km</b> with an RMS miss of <b class="mono">${fmt(bf.rms, 2)}°</b>${sphere ? `, versus ${fmt(sphere.rms, 2)}° for the round model, which fitted nothing` : ''}. Post-hoc fits are allowed — they’re labelled so — but they’re explanations, not predictions.</div>` : ''}
    </div>
    <div class="card"><h3 class="h-md" style="margin-bottom:6px">Measured vs predicted</h3><p class="hint" style="margin:0 0 14px">Each dot is one shadow. A model that’s right puts every dot on the dashed diagonal. Vertical bars are each observation’s own uncertainty. <span class="legend" style="display:inline-flex;margin-left:8px"><span><i class="dot-real" style="background:var(--text)"></i>real</span><span><i style="box-shadow:0 0 0 2px var(--text) inset"></i>simulated</span></span></p>
      <div class="mgrid">${raw(modelScatter(pm, colors))}</div></div>
    <div class="card"><h3 class="h-md" style="margin-bottom:6px">Where do the models miss?</h3><p class="hint" style="margin:0 0 14px">Error by observer latitude. Random scatter around zero means no systematic problem; a pattern means the model’s geometry is wrong somewhere.</p>${raw(residualByLatitude(pm, colors))}
      <div class="legend" style="margin-top:8px">${raw([].concat(pm.map((p, i) => `<span><i style="background:${colors[i]}"></i>${esc(p.model.name)}</span>`).join('')).join(''))}</div></div>
    <div class="card"><div class="row between"><h3 class="h-md">The classic Eratosthenes test <span class="pill" style="vertical-align:middle">no ephemeris</span></h3><span class="hint">${P.nNoon} observations near local noon → ${P.pairs.length} pairs</span></div>
      <p class="hint" style="margin:6px 0 16px">At local solar noon the Sun is due north or south, so a shadow angle <em>is</em> an angle of latitude. Take two noon shadows in different places: round Earth says the angle difference is the arc between them, giving a single radius R. Flat Earth says it came from a Sun at height H — and every pair should give the <b>same H</b>. Neither number uses a computed Sun position.</p>
      ${P.R && P.H ? html`
        <div class="lbl" style="margin:10px 0 2px"><span class="mint">If round:</span> Earth radius implied by each pair</div>
        ${raw(pairStrip(P.pairs, 'R', { min: 3000, max: 14000, summary: P.R, refs: [{ v: 6371, label: '6,371 km (reference only)', color: 'var(--mint)' }], label: 'radius R (km)' }))}
        <div class="hint">Error-weighted mean <b class="mono mint">${fmtInt(P.R.wmean)} ± ${fmtInt(P.R.wsigma)} km</b> · pairs agree with each other: χ²/ν = <b class="mono">${fmt(P.R.chi2_red, 2)}</b> (≈1 or less is consistent)</div>
        <div class="lbl" style="margin:22px 0 2px"><span class="coral">If flat:</span> Sun height implied by each pair</div>
        ${raw(pairStrip(P.pairs, 'H', { min: 1000, max: 30000, log: true, summary: P.H, refs: flatRefs, label: 'Sun height H (km, log scale)' }))}
        <div class="hint">Heights range from <b class="mono">${fmtInt(P.H.min)}</b> to <b class="mono">${fmtInt(P.H.max)} km</b> · do the pairs agree? χ²/ν = <b class="mono coral">${fmt(P.H.chi2_red, 1)}</b></div>
        <p class="hint" style="margin-top:12px">Caveat: pairs share observations, so χ²/ν is descriptive, not a formal test. Distances come from GPS coordinates; Sun-declination drift between days adds uncertainty to each pair.</p>`
        : '<div class="callout">Not enough near-noon observations from different latitudes yet. Take yours within ±12 minutes of local solar noon — the Run flow tells you when that is.</div>'}
    </div>
    <div class="grid g2">${rubric}${messy}</div>
    ${assumptions}`;
}

function sunsetResults(a, ctx) {
  const { colors, head, rubric, messy, assumptions } = common(a, ctx);
  const pm = a.score.perModel;
  return html`
    ${head}
    <div class="card"><h3 class="h-md" style="margin-bottom:6px">Scoreboard</h3><p class="hint" style="margin:0 0 14px">Each model is a claim about where the Sun is, geometrically, when its upper edge disappears. Error is in seconds of clock time.</p>
      <div class="stack" style="margin-bottom:18px">${raw(scoreBars(pm, colors, ' s'))}</div>${raw(scoreboard(a, colors, ' s'))}
      ${a.bestE0 ? html`<div class="callout" style="margin-top:16px"><span class="pill amber" style="margin-right:6px">after the fact</span>Letting the data choose: the Sun vanishes at <b class="mono">e₀ = ${fmt(a.bestE0.e0_deg, 2)}°</b> (1σ ${fmt(a.bestE0.lo, 2)}° to ${fmt(a.bestE0.hi, 2)}°${a.bestE0.scale > 1.5 ? `, widened ×${fmt(Math.sqrt(a.bestE0.scale), 1)} because the scatter is bigger than the stated errors` : ''}). Weather and horizon obstructions pull individual observations either way.</div>` : ''}</div>
    <div class="card"><h3 class="h-md" style="margin-bottom:6px">How low was the Sun when it vanished?</h3><p class="hint" style="margin:0 0 14px">One dot per observer, placed by latitude. The vertical lines are what each locked model predicts. Hills, haze and clouds push dots to the right — a visible, honest spread.</p>${raw(sunsetStrip(a.derived, pm.map((p) => p.model), colors, a.bestE0))}</div>
    <div class="grid g2">${rubric}${messy}</div>
    ${assumptions}`;
}
