import { html, mount, esc, fmt, fmtUTC, fmtLocalClock, toast, $, raw } from '../dom.js';
import { modelColor } from '../lib.js';
import { observerName } from '/shared/names.js';
import { predictWith, describeModel } from '/shared/models.js';
import { sealRecord } from '../submit.js';
import { serverNow } from '../identity.js';

export async function renderModels(el, ctx) {
  const { slug, def, data } = ctx;
  const a = ctx.analysis({ bootstrapN: 50 });
  const stats = new Map(a.score.perModel.map((p) => [p.model.id, p]));
  const fams = Object.entries(def.families);
  const isShadow = slug === 'shadow-angle';

  mount(el, html`
    <div class="grid g2" style="gap:28px;align-items:start">
      <div class="stack">
        <div class="callout"><b>Prediction ≠ explanation.</b> A model registered here is locked with a server timestamp <i>before</i> the observations it’s scored on arrive. Fitting a model to data afterwards is welcome — but it’s shown separately, as an explanation. That asymmetry is what makes the experiment hard to game.</div>
        ${data.models.map((m, i) => { const st = stats.get(m.id); const col = modelColor(m, i); return html`
          <div class="card tight" style="border-left:4px solid ${col}">
            <div class="row between"><b>${m.name}</b><span class="pill ${m.synthetic ? 'sim' : 'real'}">${m.synthetic ? 'seed model' : 'community model'}</span></div>
            <div class="mono dim" style="font-size:12.5px;margin:4px 0 8px">${describeModel(m)}</div>
            <p class="dim" style="font-size:14.5px;margin:0 0 10px">${m.rationale || 'No rationale given.'}</p>
            <div class="row" style="gap:22px;font-size:13px"><span class="faint">locked ${fmtUTC(m.registered_ms)} · ledger #${m.ledger_seq}</span>${st ? html`<span>scored on <b>${st.blind.n}</b> blind observations${st.blind.n ? html` · RMS <b class="mono" style="color:${col}">${fmt(st.blind.rms, 2)}${isShadow ? '°' : ' s'}</b>` : ''}</span>` : ''}</div>
            <div class="hash" style="margin-top:6px">${m.id} · by ${observerName(m.observer_id)}</div>
          </div>`; })}
      </div>
      <div class="stack">
        <div class="card"><h3 class="h-md" style="margin-bottom:6px">Predict for any place and time</h3><p class="hint" style="margin:0 0 14px">Run every locked model yourself — before measuring, if you like. This is the same function the scoreboard uses.</p>
          <div class="grid g2" style="gap:10px">
            <div class="field"><label for="p-lat">Latitude</label><input id="p-lat" inputmode="decimal" value="51.5"></div>
            <div class="field"><label for="p-lon">Longitude</label><input id="p-lon" inputmode="decimal" value="-0.13"></div>
            <div class="field"><label for="p-date">Date (UTC)</label><input id="p-date" type="date"></div>
            <div class="field"><label for="p-time">Time (UTC)</label><input id="p-time" type="time" step="60"></div>
          </div>
          <div class="row" style="margin:10px 0"><button class="btn sm" id="p-here">Use my location</button><button class="btn sm ghost" id="p-now">Now</button></div>
          <div id="p-out" class="stack"></div>
        </div>
        <div class="card"><h3 class="h-md" style="margin-bottom:6px">Register your own model</h3>
          <p class="hint" style="margin:0 0 14px">Models are parametric so every prediction is a function anyone can re-run. Pick a family, choose the numbers you believe, and lock it.</p>
          <form id="m-form" class="stack">
            <div class="field"><label for="m-fam">Family</label><select id="m-fam">${raw([].concat(fams.map(([k, f]) => `<option value="${esc(k)}">${esc(f.name)}</option>`)).join(''))}</select></div>
            <p class="hint" id="m-blurb" style="margin:0"></p>
            <div id="m-params" class="grid g2" style="gap:10px"></div>
            <div class="field"><label for="m-name">Name</label><input id="m-name" maxlength="60" placeholder="e.g. Flat Earth · Sun at 6,500 km" required></div>
            <div class="field"><label for="m-why">Why do you believe this? (optional)</label><textarea id="m-why" maxlength="600" placeholder="One paragraph. It will be shown next to the scores."></textarea></div>
            <label class="switch"><input type="checkbox" id="m-ok"> I understand this is locked forever — I can’t edit it after seeing data.</label>
            <button class="btn primary" id="m-go" disabled>Lock my model</button>
          </form>
        </div>
      </div>
    </div>`);

  // ── explorer ──
  const now = new Date();
  $('#p-date', el).value = now.toISOString().slice(0, 10);
  $('#p-time', el).value = now.toISOString().slice(11, 16);
  const explore = () => {
    const lat = parseFloat($('#p-lat', el).value), lon = parseFloat($('#p-lon', el).value);
    const t = Date.parse(`${$('#p-date', el).value}T${$('#p-time', el).value || '12:00'}:00Z`);
    const box = $('#p-out', el);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(t) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { box.innerHTML = '<div class="hint">Enter a valid latitude, longitude, date and time.</div>'; return; }
    box.innerHTML = data.models.map((m, i) => {
      const p = predictWith(m, { lat, lon, t, eye_m: 1.7 });
      const col = modelColor(m, i);
      let line;
      if (isShadow) { const z = p.zenith_deg; line = z > 90 ? raw('<span class="dim">Sun below the horizon (model says: night)</span>') : html`<b class="mono" style="color:${col}">${fmt(z, 1)}°</b> <span class="dim">· a 100 cm stick casts <b class="mono">${fmt(100 * Math.tan((z * Math.PI) / 180), 1)} cm</b> of shadow</span>`; }
      else line = p.sunset_ms ? html`<b class="mono" style="color:${col}">${fmtUTC(p.sunset_ms, { sec: true, date: false })}</b> <span class="dim">· your clock: ${fmtLocalClock(p.sunset_ms)}</span>` : raw('<span class="dim">no sunset that day here</span>');
      return html`<div class="reveal-row" style="--mc:${col};animation-delay:${i * 60}ms"><span>${m.name}</span><span>${line}</span></div>`.s;
    }).join('');
  };
  ['p-lat', 'p-lon', 'p-date', 'p-time'].forEach((id) => $('#' + id, el).addEventListener('input', explore));
  $('#p-now', el).addEventListener('click', () => { const n = new Date(); $('#p-date', el).value = n.toISOString().slice(0, 10); $('#p-time', el).value = n.toISOString().slice(11, 16); explore(); });
  $('#p-here', el).addEventListener('click', () => navigator.geolocation?.getCurrentPosition((p) => { $('#p-lat', el).value = p.coords.latitude.toFixed(3); $('#p-lon', el).value = p.coords.longitude.toFixed(3); explore(); }, () => toast('Location unavailable', 'warn')));
  explore();

  // ── register ──
  const fam = $('#m-fam', el), params = $('#m-params', el);
  const drawParams = () => {
    const f = def.families[fam.value];
    $('#m-blurb', el).textContent = f.blurb;
    params.innerHTML = f.params.map((p) => p.type === 'bool' ? `<label class="switch" style="grid-column:1/-1"><input type="checkbox" data-p="${p.key}" ${p.default ? 'checked' : ''}> ${esc(p.label)}</label>` : `<div class="field"><label>${esc(p.label)}</label><input data-p="${p.key}" type="number" inputmode="decimal" min="${p.min}" max="${p.max}" step="${p.step || 'any'}" value="${p.default}"></div>`).join('') || '<div class="hint">This family has no parameters — it makes one fixed prediction.</div>';
  };
  fam.addEventListener('change', drawParams); drawParams();
  $('#m-ok', el).addEventListener('change', (e) => { $('#m-go', el).disabled = !e.target.checked; });
  $('#m-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = def.families[fam.value];
    const p = {};
    for (const q of f.params) { const inp = params.querySelector(`[data-p="${q.key}"]`); p[q.key] = q.type === 'bool' ? inp.checked : parseFloat(inp.value); }
    const btn = $('#m-go', el); btn.disabled = true; btn.textContent = 'Locking…';
    try {
      const r = await sealRecord('model', { experiment: slug, made_ms: await serverNow(), family: fam.value, params: p, name: $('#m-name', el).value.trim(), rationale: $('#m-why', el).value.trim() });
      toast(`Model locked at ledger #${r.receipt.ledger_seq}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) { toast(err.message, 'bad'); btn.disabled = false; btn.textContent = 'Lock my model'; }
  });
}
