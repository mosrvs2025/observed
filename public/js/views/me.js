import { html, mount, $, toast, fmtUTC, esc } from '../dom.js';
import { getIdentity, setNick, mine } from '../identity.js';
import { api } from '../api.js';
import { placeName } from '../places.js';

export const title = 'Your device';

export async function render(root) {
  const me = await getIdentity();
  const data = await api.get(`/api/observers/${me.id}`);
  mount(root, html`<div class="wrap section" style="max-width:860px">
    <div class="eyebrow">Your identity</div><h1 class="h-xl" style="font-size:clamp(40px,6vw,72px);margin:14px 0">${me.name}</h1>
    <p class="lede">There are no accounts. This browser holds a private key that never leaves it; every record you submit is signed with it. Clear your site data and you start a new identity.</p>
    <div class="card stack" style="margin:26px 0">
      <dl class="kv"><dt>Observer id</dt><dd class="mono">${me.id}</dd><dt>Public key</dt><dd class="hash">${me.key}</dd><dt>Private key</dt><dd>Non-extractable, stored in this browser only</dd><dt>Created</dt><dd>${fmtUTC(me.created_ms)}</dd></dl>
      <form id="nick" class="row"><input id="nk" maxlength="24" placeholder="Optional display name" value="${me.nick}" style="max-width:280px"><button class="btn">Save name</button><span class="hint">Shown on records you create from now on (not retroactive — records are immutable).</span></form>
    </div>
    <h2 class="h-md" style="margin-bottom:14px">Your observations <span class="faint mono" style="font-size:14px">${data.observations.length}</span></h2>
    ${data.observations.length ? html`<div class="table-wrap"><table><thead><tr><th>When</th><th>Where</th><th>Experiment</th><th></th></tr></thead><tbody>${data.observations.map((o) => html`<tr class="click" data-go="${o.id}"><td class="mono nowrap">${fmtUTC(o.captured_ms)}</td><td>${placeName(o.record.location.lat, o.record.location.lon)}</td><td>${o.experiment}</td><td>${o.record.outcome === 'failed' ? 'failed attempt' : ''}</td></tr>`)}</tbody></table></div>` : html`<div class="card dim">Nothing yet. <a class="amber" href="#/e/shadow-angle/run">Make your first observation →</a></div>`}
  </div>`);
  root.addEventListener('click', (e) => { const r = e.target.closest('[data-go]'); if (r) location.hash = `#/o/${r.dataset.go}`; });
  $('#nick', root).addEventListener('submit', (e) => { e.preventDefault(); setNick($('#nk', root).value); toast('Saved'); location.reload(); });
}
