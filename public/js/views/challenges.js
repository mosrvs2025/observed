import { html, mount, esc, fmtUTC, toast, $, $$, raw } from '../dom.js';
import { observerName } from '/shared/names.js';
import { sealRecord } from '../submit.js';
import { serverNow } from '../identity.js';
import { placeName } from '../places.js';

export function effectText(e) {
  if (e.kind === 'exclude') return 'If upheld: this observation is excluded from the analysis.';
  if (e.kind === 'inflate') return `If upheld: this observation’s uncertainty is widened ×${e.factor}.`;
  return 'Note only — does not change any numbers by itself.';
}

export function challengeCard(c, { models = [], onVote } = {}) {
  const tgt = c.target.type === 'observation' ? `<a href="#/o/${c.target.id}">observation ${c.target.id.slice(4, 10)}</a>` : c.target.type === 'model' ? `model <b>${esc(models.find((m) => m.id === c.target.id)?.name || c.target.id)}</b>` : 'the experiment as a whole';
  return html`<div class="chal ${c.status}" data-chal="${c.id}">
    <div class="row between"><div class="row" style="gap:8px"><span class="pill ${c.status === 'upheld' ? 'bad' : c.status === 'open' ? 'amber' : ''}">${c.status}</span><b>${c.type_label}</b></div><span class="faint mono" style="font-size:12px">${fmtUTC(c.received_ms)}</span></div>
    <div class="dim" style="font-size:13.5px">Against ${raw(tgt)} · raised by ${observerName(c.observer_id)}${c.synthetic ? ' ' : ''}${c.synthetic ? raw('<span class="pill sim">simulated</span>') : ''}</div>
    <p style="margin:0">${c.body}</p>
    <div class="hint">${effectText(c.effect)}</div>
    <div class="row between"><span class="mono" style="font-size:13px">support ${c.support} · dispute ${c.dispute}${c.concession ? ' · conceded by the observer' : ''} <span class="faint">(upheld at net +3 or on the observer’s concession; rejected at net −3)</span></span>
      ${c.status === 'open' && onVote ? html`<span class="row" style="gap:8px"><button class="btn sm" data-vote="support">Support</button><button class="btn sm ghost" data-vote="dispute">Dispute</button></span>` : ''}</div>
  </div>`;
}

export function wireVotes(el, afterVote) {
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-vote]');
    if (!b) return;
    const id = b.closest('[data-chal]').dataset.chal;
    b.disabled = true;
    try {
      await sealRecord('vote', { made_ms: await serverNow(), challenge_id: id, stance: b.dataset.vote, note: '' });
      toast('Vote recorded'); afterVote();
    } catch (err) { toast(err.message, 'bad'); b.disabled = false; }
  });
}

export async function renderChallenges(el, ctx) {
  const { slug, def, data } = ctx;
  const types = Object.entries(def.challenge_types).filter(([, t]) => t.targets.includes('experiment') || t.targets.includes('model'));
  const order = { open: 0, upheld: 1, rejected: 2 };
  const list = [...data.challenges].sort((a, b) => order[a.status] - order[b.status] || b.received_ms - a.received_ms);
  mount(el, html`
    <div class="grid g2" style="gap:28px;align-items:start">
      <div class="stack">
        <div class="callout"><b>Disagreement, structured.</b> A challenge names a specific problem, proposes a specific effect, and shows what the result would look like if it holds. Anyone who has contributed an observation to this experiment can support or dispute it. Upheld challenges change the numbers; the rest stay on the record.</div>
        ${list.length ? list.map((c) => challengeCard(c, { models: data.models, onVote: true })) : html`<div class="card dim">No challenges yet. Found something wrong? Challenge an observation from its page, or raise an experiment-wide issue here.</div>`}
      </div>
      <div class="card"><h3 class="h-md" style="margin-bottom:6px">Raise an experiment-level challenge</h3>
        <p class="hint" style="margin:0 0 14px">Observation-specific challenges (bad GPS, tilted stick, refraction…) are filed from the observation’s own page, where you can see what the result would be if you’re right.</p>
        <form id="c-form" class="stack">
          <div class="field"><label for="c-type">Kind</label><select id="c-type">${raw([].concat(types.map(([k, t]) => `<option value="${esc(k)}">${esc(t.label)}</option>`)).join(''))}</select></div>
          <p class="hint" id="c-blurb" style="margin:0"></p>
          <div class="field"><label for="c-target">Concerning</label><select id="c-target"><option value="experiment:${slug}">The experiment as a whole</option>${raw([].concat(data.models.map((m) => `<option value="model:${esc(m.id)}">Model — ${esc(m.name)}</option>`)).join(''))}</select></div>
          <div class="field"><label for="c-body">What’s wrong, specifically?</label><textarea id="c-body" maxlength="1200" minlength="20" required placeholder="Be concrete: what should be checked or changed, and why?"></textarea></div>
          <button class="btn primary">Submit challenge</button>
        </form></div>
    </div>`);
  const blurb = () => { $('#c-blurb', el).textContent = def.challenge_types[$('#c-type', el).value].blurb; };
  $('#c-type', el).addEventListener('change', blurb); blurb();
  wireVotes(el, () => window.dispatchEvent(new HashChangeEvent('hashchange')));
  $('#c-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const [type, id] = $('#c-target', el).value.split(':');
    const kind = $('#c-type', el).value;
    if (!def.challenge_types[kind].targets.includes(type)) { toast(`“${def.challenge_types[kind].label}” can’t target a ${type}.`, 'warn'); return; }
    try {
      await sealRecord('challenge', { experiment: slug, made_ms: await serverNow(), target: { type, id: type === 'experiment' ? slug : id }, challenge_type: kind, body: $('#c-body', el).value.trim(), effect: { kind: 'note' } });
      toast('Challenge filed'); window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) { toast(err.message, 'bad'); }
  });
}
