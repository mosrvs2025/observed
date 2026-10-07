import { html, mount, fmtInt, toast } from '../dom.js';
import { api } from '../api.js';
import { getIdentity } from '../identity.js';

export const title = 'Experiments';

export async function render(root) {
  const o = await api.get('/api/overview');
  mount(root, html`<div class="wrap section">
    <div class="eyebrow">Experiments</div><h1 class="h-xl" style="font-size:clamp(40px,6vw,72px);margin:14px 0 14px">Pick one. Predict. Measure.</h1>
    <p class="lede">Every experiment is a versioned protocol with competing models, a calculation anyone can re-run, and a public record of every attempt.</p>
    <h2 class="h-md" style="margin:44px 0 18px">Live now</h2>
    <div class="grid g2">${o.experiments.map((e) => html`<div class="card exp-card glow">
      <div class="row between"><span class="eyebrow">${e.kicker}</span><span class="pill">protocol v${e.version}</span></div>
      <h3>${e.title}</h3><p class="dim" style="margin:0">${e.summary}</p>
      <div class="meta"><div class="stat"><span class="n">${fmtInt(e.counts.measured)}</span><span class="l">observations</span></div><div class="stat"><span class="n">${fmtInt(e.counts.observers)}</span><span class="l">observers</span></div><div class="stat"><span class="n">${e.counts.intents}</span><span class="l">want to replicate</span></div></div>
      <div class="row"><a class="btn primary" href="#/e/${e.slug}/run">Run it</a><a class="btn" href="#/e/${e.slug}">Open</a><a class="btn ghost" href="#/e/${e.slug}/evidence">Evidence</a></div></div>`)}</div>
    <h2 class="h-md" style="margin:56px 0 6px">Proposed</h2><p class="dim">Not live yet. Say which you would actually run — it decides what gets built next.</p>
    <div class="grid g3" style="margin-top:16px">${o.proposed.map((p) => html`<div class="card exp-card proposed"><span class="eyebrow">${p.kicker}</span><h3 style="font-size:26px">${p.title}</h3><p class="dim" style="margin:0;font-size:14.5px">${p.blurb}</p><div class="hint">Needs: ${p.needs}</div>
      <div class="row between"><span class="mono faint" style="font-size:12px">${p.interest} would run this</span><button class="btn sm" data-int="${p.slug}">I’d run this</button></div></div>`)}</div>
  </div>`);
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-int]'); if (!b) return;
    try { const me = await getIdentity(); await api.post('/api/interest', { experiment: b.dataset.int, observer_id: me.id }); toast('Noted — thank you'); b.disabled = true; b.textContent = 'Counted ✓'; } catch (err) { toast(err.message, 'bad'); }
  });
}
