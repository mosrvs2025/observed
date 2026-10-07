import { html, mount, raw, esc, fmtUTC, shortHash, $, toast } from '../dom.js';
import { api } from '../api.js';
import { observerName } from '/shared/names.js';
import { GENESIS_HASH, ledgerEntryHash } from '/shared/canonical.js';

export const title = 'Public ledger';
const ICON = { observation: '◉', model: '◇', prediction: '✦', challenge: '!', vote: '✓', amendment: '✎' };

export async function render(root) {
  const [led, anch] = await Promise.all([api.get('/api/ledger?limit=60'), api.get('/api/anchors')]);
  mount(root, html`<div class="wrap section">
    <div class="eyebrow">Evidence integrity</div><h1 class="h-xl" style="font-size:clamp(40px,6vw,72px);margin:14px 0">The public ledger</h1>
    <p class="lede">Every accepted record — observation, locked model, prediction, challenge, vote, correction — is appended here, chained to the one before by SHA-256 and signed by the server. Change one byte anywhere and every later hash breaks. Nothing is ever edited or deleted; corrections are new entries.</p>
    <div class="grid g3" style="margin:28px 0">
      <div class="card tight"><div class="lbl">Entries</div><div class="stat"><span class="n">${led.head.seq}</span></div></div>
      <div class="card tight" style="grid-column:span 2"><div class="lbl">Head hash</div><div class="hash" style="margin-top:6px;color:var(--amber-2)">${led.head.entry_hash}</div></div>
    </div>
    <div class="card"><div class="row between"><h3 class="h-md">Verify it yourself</h3><button class="btn primary" id="vfy">Verify the whole chain in my browser</button></div>
      <p class="hint" style="margin:8px 0 14px">Your browser downloads every entry and recomputes every hash link. (Observer signatures can be checked per observation, and in bulk from the raw export.)</p><div class="proof" id="proof"></div></div>
    <div class="grid g2" style="gap:24px;margin-top:28px;align-items:start">
      <div><h3 class="h-md" style="margin-bottom:12px">Latest entries</h3><div class="card tight" style="padding:0">${led.entries.map((e, i) => html`<div class="ledger-row"><span class="mono amber">#${e.seq}</span><span><span class="pill">${ICON[e.kind] || ''} ${e.kind}</span></span><span><a href="${e.kind === 'observation' ? '#/o/' + e.ref : '#/e/' + (e.experiment || 'shadow-angle')}">${e.ref}</a> ${e.synthetic ? raw('<span class="pill sim">simulated</span>') : ''}<div class="hash">${shortHash(e.entry_hash, 14)} ← ${shortHash(e.prev_hash, 8)}</div></span><span class="faint mono" style="font-size:12px">${fmtUTC(e.received_ms)}</span></div>`)}</div></div>
      <div class="stack"><div class="card"><h3 class="h-md" style="margin-bottom:8px">Checkpoints</h3>
        <p class="hint">Periodic signed snapshots of the head hash. A checkpoint becomes <b>externally witnessed</b> only when its hash is published somewhere the operator can’t rewrite — a public git commit, a newspaper, an OpenTimestamps proof, or a blockchain transaction.</p>
        ${anch.anchors.length ? anch.anchors.slice(0, 6).map((a) => html`<div class="row between" style="padding:8px 0;border-top:1px solid var(--line)"><span class="mono" style="font-size:12.5px">#${a.head_seq} · ${fmtUTC(a.ts_ms)}</span><span class="pill ${a.external_ref ? 'ok' : ''}">${a.external_ref ? 'witnessed: ' + a.external_ref : 'server-signed only'}</span></div>`) : '<div class="dim">None yet.</div>'}
        <p class="hint" style="margin-top:12px">Run <span class="mono">npm run anchor</span> to write a checkpoint file you can commit or timestamp.</p></div>
        <div class="card tight"><div class="lbl">Server signing key (Ed25519)</div><div class="hash" style="margin-top:6px">${anch.server_key.x}</div></div></div>
    </div></div>`);
  $('#vfy', root).addEventListener('click', async () => {
    const box = $('#proof', root);
    const step = (cls, text) => `<div class="st ${cls}"><span class="ic">${cls === 'ok' ? '✓' : cls === 'bad' ? '✕' : ''}</span><span>${esc(text)}</span><span></span></div>`;
    box.innerHTML = step('run', 'Downloading ledger…');
    try {
      let from = 1, all = [];
      for (;;) { const r = await api.get(`/api/ledger/range?from=${from}&limit=500`); all = all.concat(r.entries); if (r.entries.length < 500) break; from += 500; }
      let prev = GENESIS_HASH, bad = null;
      for (const e of all) {
        if (e.prev_hash !== prev) { bad = `link broken at #${e.seq}`; break; }
        if ((await ledgerEntryHash({ seq: e.seq, kind: e.kind, ref: e.ref, content_hash: e.content_hash, received_ms: e.received_ms, prev_hash: e.prev_hash })) !== e.entry_hash) { bad = `hash mismatch at #${e.seq}`; break; }
        prev = e.entry_hash;
      }
      box.innerHTML = step('ok', `Downloaded ${all.length} entries`) + (bad ? step('bad', bad) : step('ok', `All ${all.length} hash links recomputed locally — chain intact`) + step('ok', `Head matches: ${prev.slice(0, 16)}…`));
    } catch (e) { box.innerHTML = step('bad', e.message); }
  });
}
