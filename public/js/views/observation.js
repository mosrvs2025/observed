import { html, mount, esc, raw, fmt, fmtUTC, fmtLatLon, fmtDur, fmtSigned, ago, toast, $, $$ } from '../dom.js';
import { api } from '../api.js';
import { modelColor } from '../lib.js';
import { placeName } from '../places.js';
import { observerName, shortId } from '/shared/names.js';
import { hashRecord, verifyRecordSignature, ledgerEntryHash } from '/shared/canonical.js';
import { getIdentity } from '../identity.js';
import { sealRecord } from '../submit.js';
import { serverNow } from '../identity.js';
import { challengeCard, wireVotes, effectText } from './challenges.js';

export const title = ([id]) => `Observation ${id.slice(4, 10)}`;

export async function render(root, { params: [id] }) {
  const [d, me] = await Promise.all([api.get(`/api/observations/${id}`), getIdentity()]);
  const o = d.observation, r = o.record, slug = o.experiment;
  const def = await api.cached(`/api/experiments/${slug}`);
  const isShadow = slug === 'shadow-angle';
  const place = placeName(r.location.lat, r.location.lon);
  const mine = me.id === o.observer.id;
  const dv = d.derived;
  const failed = r.outcome === 'failed';
  const unit = isShadow ? '°' : ' s';

  mount(root, html`<div class="wrap" style="padding-top:34px">
    <a class="dim" href="#/e/${slug}/observatory">← ${def.title}</a>
    <div class="row between" style="margin:14px 0 6px;align-items:flex-end">
      <div><div class="eyebrow">Observation · ledger #${o.ledger_seq}</div><h1 class="h-xl" style="font-size:clamp(38px,6vw,68px);margin-top:12px">${place}</h1>
        <div class="dim mono" style="margin-top:8px">${fmtUTC(r.captured_ms, { sec: true })} · ${fmtLatLon(r.location.lat, r.location.lon)}${r.location.alt_m != null ? ` · ${Math.round(r.location.alt_m)} m` : ''}</div></div>
      <div class="row">${o.synthetic ? raw('<span class="pill sim">simulated demo data</span>') : raw('<span class="pill real">real device</span>')}${o.amendments.length ? raw('<span class="pill amber">amended</span>') : ''}${r.replicates ? raw(`<a class="pill" href="#/o/${r.replicates}">replication of ${r.replicates.slice(4, 10)}</a>`) : ''}${failed ? raw('<span class="pill bad">failed attempt</span>') : ''}</div>
    </div>
    <p class="dim">by <b>${observerName(o.observer.id)}</b> <span class="mono faint">${shortId(o.observer.id)}</span>${r.notes ? html` — “${r.notes}”` : ''}</p>
    ${o.synthetic ? html`<div class="callout sim" style="margin:14px 0">Simulated: generated from the round-Earth model with realistic instrument error. The flag lives inside the signed record, so it can’t be removed later.</div>` : ''}
    <div class="grid g2" style="gap:24px;align-items:start;margin-top:22px">
      <div class="stack" style="min-width:0">
        ${failed ? html`<div class="card"><h3 class="h-md">Why it failed</h3><p style="font-size:18px">${r.failure_reason}</p><p class="hint">Failed attempts are public on purpose: they keep success rates honest.</p></div>` : measurement(d, isShadow)}
        ${!failed && d.predictions.length ? predictionsCard(d, isShadow, unit) : ''}
        ${d.prediction ? html`<div class="card tight"><div class="row between"><b>Their own prediction, made first</b><span class="pill ${d.prediction.preregistered ? 'ok' : 'bad'}">${d.prediction.preregistered ? 'locked before measuring' : 'made after capture'}</span></div>
          <p class="dim" style="margin:8px 0 0">${isShadow ? html`They guessed <b class="mono">${fmt(d.prediction.value.zenith_deg, 1)}°</b> — actual <b class="mono">${fmt(dv?.value, 1)}°</b>.` : html`They predicted <b class="mono">${fmtUTC(d.prediction.value.sunset_ms, { sec: true, date: false })}</b>.`} <span class="faint">Locked ${fmtUTC(d.prediction.received_ms, { sec: true })} · ledger #${d.prediction.ledger_seq}</span></p></div>` : ''}
        ${mine && !failed ? amendCard(r, isShadow) : ''}
        ${o.amendments.length ? html`<div class="card tight"><b>Corrections</b>${o.amendments.map((a) => html`<div class="callout" style="margin-top:10px"><b>${observerName(a.observer.id)}</b> amended ${Object.entries(a.changes.measurements).map(([k, v]) => `${k}: ${o.original.measurements[k]} → ${v}`).join(', ')}<br>“${a.reason}” <span class="faint">· ${fmtUTC(a.received_ms)} · ledger #${a.ledger_seq}</span></div>`)}<p class="hint" style="margin:10px 0 0">The original record is untouched and still verifiable; analyses use the corrected values.</p></div>` : ''}
      </div>
      <div class="stack" style="min-width:0">
        ${integrityCard(o, d)}
        <div class="card tight"><div class="lbl" style="margin-bottom:10px">Trust signals</div><div class="trust">${d.trust.map((t) => html`<div class="t ${t.ok ? 'ok' : ''}"><span class="d"></span><div>${t.label}<small>${t.detail}</small></div></div>`)}</div></div>
        ${failed ? '' : replicationCard(d, o, slug)}
      </div>
    </div>
    <section style="margin-top:44px"><div class="row between"><h2 class="h-md">Challenges <span class="faint mono" style="font-size:14px">${d.challenges.length}</span></h2></div>
      <div class="grid g2" style="gap:24px;align-items:start;margin-top:16px">
        <div class="stack">${d.challenges.length ? d.challenges.map((c) => html`<div>${challengeCard({ ...c, type_label: c.type_label, target: { type: 'observation', id }, synthetic: false }, { onVote: true })}${c.sensitivity ? sensitivity(c.sensitivity, isShadow) : ''}</div>`) : html`<div class="card dim">No challenges. If you think this measurement is wrong, say specifically how.</div>`}</div>
        ${challengeForm(def, slug, isShadow)}
      </div></section>
  </div>`);

  wireVotes(root, () => window.dispatchEvent(new HashChangeEvent('hashchange')));
  wireVerify(root, o, d);
  wireReplicate(root, o, slug, me);
  wireChallenge(root, slug, id, def);
  wireAmend(root, o);
}

function measurement(d, isShadow) {
  const o = d.observation, r = o.record, dv = d.derived;
  if (!dv) return '';
  const b = dv.budget;
  if (isShadow) {
    const m = r.measurements;
    const maxB = Math.max(b.rulers, b.tilt, b.refraction, 0.01);
    const bar = (label, v, note) => `<div style="display:grid;gap:3px"><div class="row between" style="font-size:13.5px"><span>${label}</span><span class="mono">±${fmt(v, 2)}°</span></div><div class="bar"><i style="width:${(v / maxB) * 100}%"></i></div>${note ? `<div class="hint">${note}</div>` : ''}</div>`;
    const L = Math.min(m.shadow_cm / m.stick_cm, 3.2) * 80 + 4;
    return html`<div class="card glow"><div class="eyebrow">Sun’s angle from the shadow</div>
      <div class="row" style="gap:22px;align-items:flex-end;margin:10px 0 4px"><div class="big-readout">${fmt(dv.value, 1)}°</div><div class="mono dim" style="padding-bottom:12px">± ${fmt(dv.sigma, 2)}° <span class="faint">(1σ)</span></div></div>
      <div class="hint">tan⁻¹(${m.shadow_cm} cm ÷ ${m.stick_cm} cm) = ${fmt(dv.value_app, 2)}°, plus ${fmt(b.refraction_applied, 3)}° refraction → true zenith angle</div>
      <svg class="shadow-diagram" viewBox="0 0 380 130" style="margin:14px 0"><line x1="20" y1="100" x2="365" y2="100" stroke="var(--line-2)"/><line x1="80" y1="100" x2="80" y2="30" stroke="var(--text)" stroke-width="4" stroke-linecap="round"/><line x1="80" y1="100" x2="${80 + L}" y2="100" stroke="var(--amber)" stroke-width="5" stroke-linecap="round"/><line x1="80" y1="30" x2="${80 + L}" y2="100" stroke="var(--amber)" stroke-dasharray="4 4" opacity=".7"/><text x="${80 + L / 2}" y="120" text-anchor="middle" style="font:11px var(--mono);fill:var(--dim)">shadow ${m.shadow_cm} cm</text><text x="70" y="62" text-anchor="end" style="font:11px var(--mono);fill:var(--dim)">stick ${m.stick_cm} cm</text></svg>
      <dl class="kv"><dt>Shadow points</dt><dd>${m.shadow_dir}${m.heading_deg != null ? ` (compass ${m.heading_deg}°)` : ''}</dd><dt>Stick tilt</dt><dd>${m.tilt_deg != null ? m.tilt_deg + '° measured' : 'not measured — assumed ±1.5°'}</dd><dt>Local solar noon</dt><dd>${dv.noon_offset_min >= 0 ? '+' : '−'}${fmt(Math.abs(dv.noon_offset_min), 0)} min</dd></dl>
      <div class="lbl" style="margin:18px 0 10px">Uncertainty budget</div><div class="stack" style="gap:10px">${raw(bar('Ruler & shadow-tip blur', b.rulers, 'Reading error plus the Sun’s ½° disc smearing the tip.') + bar('Stick tilt', b.tilt, b.tilt_assumed ? 'Not measured, so a generous 1.5° is assumed.' : 'Measured with the phone level.') + bar('Refraction correction', b.refraction, 'Only matters for a low Sun.'))}</div></div>`;
  }
  const m = r.measurements;
  return html`<div class="card glow"><div class="eyebrow">The Sun vanished at</div>
    <div class="big-readout">${new Date(m.sunset_ms).toISOString().slice(11, 19)} <span style="font-size:.4em" class="dim">UTC</span></div>
    <dl class="kv" style="margin-top:12px"><dt>Sun’s elevation then</dt><dd>${fmt(dv.elev_at_vanish, 2)}° (referred to sea level)</dd><dt>Eye height</dt><dd>${m.eye_height_m} m</dd><dt>Horizon · sky</dt><dd>${m.horizon} · ${m.sky}</dd><dt>Timing uncertainty</dt><dd>± ${fmt(dv.sigma, 0)} s (judgement ${dv.budget.judgement} s, horizon ${dv.budget.horizon} s, clock ${fmt(dv.budget.clock, 2)} s)</dd></dl></div>`;
}

function predictionsCard(d, isShadow, unit) {
  return html`<div class="card"><h3 class="h-md" style="margin-bottom:6px">What each model predicted for this place and time</h3><p class="hint" style="margin:0 0 14px">${isShadow ? 'Residual = measured − predicted.' : 'Residual = observed − predicted time.'} “Blind” means this observation arrived after the model was locked.</p>
    <div class="reveal-grid">${d.predictions.map((p, i) => { const col = modelColor({ family: p.family, params: p.params }, i); return html`<div class="reveal-row" style="--mc:${col};animation-delay:${i * 70}ms"><div><b>${p.name}</b><div class="hint">${p.blind ? 'blind prediction' : 'registered after this observation'}</div></div><div style="text-align:right" class="mono">${isShadow ? `${fmt(p.predicted, 1)}°` : p.predicted ? new Date(p.predicted).toISOString().slice(11, 19) : '—'}<div style="color:${col}">${p.residual == null ? '' : fmtSigned(p.residual, isShadow ? 1 : 0) + unit}</div></div></div>`; })}</div></div>`;
}

function integrityCard(o, d) {
  const rc = d.receipt;
  return html`<div class="card"><div class="row between"><h3 class="h-md">Integrity</h3><button class="btn sm primary" id="verify">Verify in my browser</button></div>
    <p class="hint" style="margin:6px 0 12px">Recomputed locally — no trust in this server required.</p><div class="proof" id="proof"></div>
    <dl class="kv" style="margin-top:14px;font-size:13px"><dt>Content hash</dt><dd class="hash">${rc.content_hash}</dd><dt>Ledger entry</dt><dd class="hash">#${rc.ledger_seq} ${rc.entry_hash}</dd><dt>Previous entry</dt><dd class="hash">${rc.prev_hash}</dd><dt>Received (server)</dt><dd>${fmtUTC(rc.received_ms, { sec: true })}</dd><dt>Device signature</dt><dd class="hash">${o.signature}</dd><dt>Observer key</dt><dd class="hash">${o.record.observer.key}</dd></dl>
    <div class="row" style="margin-top:12px"><a class="btn sm ghost" href="/api/observations/${o.id}">Raw JSON</a><a class="btn sm ghost" href="#/ledger">Ledger</a></div></div>`;
}

function replicationCard(d, o, slug) {
  const reps = d.replications, links = d.links.filter((l) => l.original === o.id);
  return html`<div class="card"><h3 class="h-md" style="margin-bottom:6px">Replication</h3>
    ${reps.length ? html`<p>Reproduced by <b>${new Set(reps.map((r) => r.observer.id)).size}</b> independent observer${reps.length > 1 ? 's' : ''}; <b>${links.filter((l) => l.agree).length} of ${links.length}</b> agree within 2σ.</p>
      ${links.map((l) => html`<div class="row between" style="padding:8px 0;border-top:1px solid var(--line);font-size:13.5px"><a href="#/o/${l.replication}">${l.replication.slice(4, 10)}</a><span class="mono dim">${fmt(l.distance_km, 0)} km away · Δ ${fmtSigned(l.delta, 2)} (z = ${fmt(l.z, 1)})</span><span class="pill ${l.agree ? 'ok' : 'bad'}">${l.agree ? 'agrees' : 'disagrees'}</span></div>`)}`
      : html`<p class="dim">Nobody has reproduced this yet.</p>`}
    ${d.links.filter((l) => l.replication === o.id).map((l) => html`<p class="hint">This observation replicates <a href="#/o/${l.original}">${l.original.slice(4, 10)}</a>: Δ ${fmtSigned(l.delta, 2)}, z = ${fmt(l.z, 1)}.</p>`)}
    <p class="hint">Agreement compares each observation’s residual against a shared reference model — a common yardstick, not an assumption that it’s true.</p>
    <div class="row between"><span class="hint">${d.intents} planning to reproduce</span><button class="btn primary" id="repro">I want to reproduce this</button></div></div>`;
}

function sensitivity(s, isShadow) {
  return html`<div class="card tight" style="margin-top:-6px;border-top:0;border-radius:0 0 14px 14px;background:var(--ink-2)"><div class="lbl" style="margin-bottom:8px">If this challenge is upheld, the headline numbers become</div>
    ${s.after.map((a, i) => { const b = s.before[i]; return html`<div class="row between mono" style="font-size:13px"><span class="dim">${a.name}</span><span>${fmt(b.rms, isShadow ? 3 : 1)} → <b class="${Math.abs(a.rms - b.rms) < 1e-3 ? 'dim' : 'amber'}">${fmt(a.rms, isShadow ? 3 : 1)}${isShadow ? '°' : ' s'}</b> RMS</span></div>`; })}</div>`;
}

function challengeForm(def, slug, isShadow) {
  const types = Object.entries(def.challenge_types).filter(([, t]) => t.targets.includes('observation'));
  return html`<div class="card"><h3 class="h-md" style="margin-bottom:6px">Challenge this observation</h3><p class="hint" style="margin:0 0 14px">Be specific and propose an effect. You’ll see what it would do to the result.</p>
    <form id="c-form" class="stack">
      <div class="field"><label for="c-type">Problem</label><select id="c-type">${raw([].concat(types.map(([k, t]) => `<option value="${esc(k)}">${esc(t.label)}</option>`)).join(''))}</select></div><p class="hint" id="c-blurb" style="margin:0"></p>
      <div class="grid g2" style="gap:10px"><div class="field"><label for="c-eff">If upheld</label><select id="c-eff"><option value="inflate">Widen its uncertainty</option><option value="exclude">Exclude it</option><option value="note">Note only</option></select></div><div class="field"><label for="c-fac">Widen by ×</label><input id="c-fac" type="number" min="1.2" max="10" step="0.1" value="2"></div></div>
      <div class="field"><label for="c-body">What’s wrong, specifically?</label><textarea id="c-body" required minlength="20" maxlength="1200"></textarea></div>
      <button class="btn primary">File challenge</button></form></div>`;
}

function amendCard(r, isShadow) {
  const m = r.measurements;
  return html`<details class="card tight"><summary style="cursor:pointer"><b>Correct a mistake</b> <span class="hint">— only you can; the original stays on record</span></summary>
    <form id="a-form" class="stack" style="margin-top:14px">${isShadow ? html`<div class="grid g2" style="gap:10px"><div class="field"><label>Stick height (cm)</label><input id="a-stick" type="number" step="0.1" value="${m.stick_cm}"></div><div class="field"><label>Shadow length (cm)</label><input id="a-shadow" type="number" step="0.1" value="${m.shadow_cm}"></div></div>` : html`<div class="field"><label>Eye height (m)</label><input id="a-eye" type="number" step="0.1" value="${m.eye_height_m}"></div>`}
    <div class="field"><label>Reason</label><textarea id="a-why" required minlength="10" maxlength="400" placeholder="What was wrong?"></textarea></div><button class="btn">Submit correction</button></form></details>`;
}

// ── wiring ──
function wireVerify(root, o, d) {
  $('#verify', root).addEventListener('click', async () => {
    const box = $('#proof', root);
    const rows = [];
    const show = (cls, text, extra = '') => { rows.push(`<div class="st ${cls}"><span class="ic">${cls === 'ok' ? '✓' : cls === 'bad' ? '✕' : cls === 'skip' ? '–' : ''}</span><span>${esc(text)}</span><span class="faint mono" style="font-size:11.5px">${esc(extra)}</span></div>`); box.innerHTML = rows.join(''); };
    const rc = d.receipt;
    const original = o.original || o.record; // the record exactly as signed
    try {
      const h = await hashRecord(original);
      show(h === rc.content_hash ? 'ok' : 'bad', 'SHA-256 of the signed record matches the ledger', h.slice(0, 12) + '…');
      const sigOk = await verifyRecordSignature(original, o.signature);
      show(sigOk ? 'ok' : 'bad', 'Device signature verifies against the observer’s public key', o.record.observer.id);
      const eh = await ledgerEntryHash({ seq: rc.ledger_seq, kind: rc.kind, ref: rc.id, content_hash: rc.content_hash, received_ms: rc.received_ms, prev_hash: rc.prev_hash });
      show(eh === rc.entry_hash ? 'ok' : 'bad', 'Ledger entry hash recomputed', '#' + rc.ledger_seq);
      if (rc.ledger_seq > 1) {
        const prev = (await api.get(`/api/ledger/range?from=${rc.ledger_seq - 1}&limit=3`)).entries;
        show(prev[0]?.entry_hash === rc.prev_hash ? 'ok' : 'bad', 'Chained to the previous ledger entry', '#' + (rc.ledger_seq - 1));
        if (prev[2]) show(prev[2].prev_hash === rc.entry_hash ? 'ok' : 'bad', 'The next entry chains back to this one', '#' + (rc.ledger_seq + 1));
      }
      try {
        const head = await api.get('/api/ledger/head');
        const key = await crypto.subtle.importKey('jwk', head.server_key, { name: 'Ed25519' }, false, ['verify']);
        const b = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
        const hex = Uint8Array.from(rc.entry_hash.match(/../g).map((x) => parseInt(x, 16)));
        const ok = await crypto.subtle.verify('Ed25519', key, b(rc.server_sig), hex);
        show(ok ? 'ok' : 'bad', 'Server receipt signature (Ed25519) verifies', 'server key');
      } catch { show('skip', 'Server Ed25519 signature: this browser can’t verify Ed25519 — skipped'); }
      show('ok', `Server received it ${fmtDur(rc.received_ms - original.captured_ms)} after capture`, 'timestamp is the server’s, not the phone’s');
    } catch (e) { show('bad', 'Verification error: ' + e.message); }
  });
}

function wireReplicate(root, o, slug, me) {
  $('#repro', root)?.addEventListener('click', async () => {
    try { await api.post('/api/intents', { experiment: slug, target: o.id, observer_id: me.id }); } catch { /* still go */ }
    location.hash = `#/e/${slug}/run?replicate=${o.id}`;
  });
}

function wireChallenge(root, slug, id, def) {
  const blurb = () => { $('#c-blurb', root).textContent = def.challenge_types[$('#c-type', root).value].blurb; const e = def.challenge_types[$('#c-type', root).value].defaultEffect; $('#c-eff', root).value = e.kind; if (e.factor) $('#c-fac', root).value = e.factor; };
  $('#c-type', root).addEventListener('change', blurb); blurb();
  $('#c-form', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const kind = $('#c-eff', root).value;
    const effect = kind === 'inflate' ? { kind, factor: parseFloat($('#c-fac', root).value) } : { kind };
    try { await sealRecord('challenge', { experiment: slug, made_ms: await serverNow(), target: { type: 'observation', id }, challenge_type: $('#c-type', root).value, body: $('#c-body', root).value.trim(), effect }); toast('Challenge filed'); window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (err) { toast(err.message, 'bad'); }
  });
}

function wireAmend(root, o) {
  const f = $('#a-form', root);
  if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = o.record.measurements, ch = {};
    const num = (sel, key) => { const el = $(sel, root); if (el && parseFloat(el.value) !== m[key]) ch[key] = parseFloat(el.value); };
    num('#a-stick', 'stick_cm'); num('#a-shadow', 'shadow_cm'); num('#a-eye', 'eye_height_m');
    if (!Object.keys(ch).length) { toast('Nothing changed', 'warn'); return; }
    try { await sealRecord('amendment', { made_ms: await serverNow(), obs_id: o.id, changes: { measurements: ch }, reason: $('#a-why', root).value.trim() }); toast('Correction recorded'); window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (err) { toast(err.message, 'bad'); }
  });
}
