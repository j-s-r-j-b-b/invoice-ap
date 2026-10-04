// Live run view: streams pipeline events and renders each stage as it executes.
import { useEffect, useState, useReducer } from 'preact/hooks';
import { html, Icon, Pill, LevelIcon, StageGlyph, toast } from './ui.js';
import { api, inr, fmtDate, fmtTime } from './api.js';

export const STAGES = [
  { id: 'intake', title: 'Receive', sub: 'File type & fingerprint' },
  { id: 'read', title: 'Read (AI)', sub: 'Extract fields + confidence' },
  { id: 'validate', title: 'Sanity check', sub: 'Completeness, maths, GST' },
  { id: 'vendor', title: 'Verify vendor', sub: 'Vendor master, GSTIN' },
  { id: 'po', title: 'Find PO', sub: 'Quoted or inferred' },
  { id: 'match', title: 'Match', sub: 'PO, goods receipt, balance' },
  { id: 'duplicate', title: 'Duplicate check', sub: 'Number, amount, file' },
  { id: 'decide', title: 'Decision', sub: 'Rules → outcome' },
];

// ---------- live run store ----------
export const live = {};
const subs = new Set();
const notify = () => subs.forEach((f) => f());
export function useLiveTick() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => { subs.add(force); return () => subs.delete(force); }, []);
}

// Starts a run; resolves with the run id as soon as the server assigns one.
export function startRun(payload, fileUrl) {
  return new Promise((resolve) => {
    let id = null;
    api.process(payload, (ev) => {
      if (ev.type === 'run') {
        id = ev.id;
        live[id] = { id, startedAt: ev.startedAt, filename: payload.filename, fileUrl, stages: {}, running: 'intake', run: null, error: null };
        notify(); resolve(id);
      } else if (!id) return;
      else if (ev.type === 'stage_start') { live[id].running = ev.id; notify(); }
      else if (ev.type === 'stage_done') { live[id].stages[ev.stage.id] = ev.stage; notify(); }
      else if (ev.type === 'done') { live[id].run = ev.run; live[id].running = null; notify(); }
      else if (ev.type === 'error') { live[id].error = ev.message; live[id].running = null; notify(); }
    }).catch((e) => {
      if (id) { live[id].error = e.message; live[id].running = null; notify(); }
      else { toast(e.message, 'bad'); resolve(null); }
    });
  });
}

// ---------- page ----------
export function RunView({ id, meta, go }) {
  useLiveTick();
  const [stored, setStored] = useState(null);
  const [err, setErr] = useState(null);
  const L = live[id];
  const run = L?.run || stored;
  useEffect(() => {
    if (L) return;
    setStored(null); setErr(null);
    api.run(id).then(setStored).catch((e) => setErr(e.message));
  }, [id]);
  const [tick, setTick] = useState(0);
  useEffect(() => { if (!L || L.run) return; const t = setInterval(() => setTick((x) => x + 1), 250); return () => clearInterval(t); }, [L && !L.run]);

  if (err) return html`<div class="page"><a class="back" href="#/"><${Icon} n="back" /> Dashboard</a><div class="card pad">Couldn't load run ${id}: ${err}</div></div>`;
  if (!L && !stored) return html`<div class="page"><div class="skeleton tall"></div></div>`;

  const stageMap = run ? Object.fromEntries(run.stages.map((s) => [s.id, s])) : L.stages;
  const runningId = run ? null : L.running;
  const stateOf = (sid) => stageMap[sid]?.status || (runningId === sid ? 'running' : 'idle');
  const read = stageMap.read?.details?.fields;
  const elapsed = L ? ((run ? new Date(run.finishedAt) : Date.now()) - new Date(L.startedAt)) / 1000 : (new Date(run.finishedAt) - new Date(run.createdAt)) / 1000;
  const sample = meta?.samples.find((s) => s.id === run?.source?.sampleId);
  const fileUrl = L?.fileUrl || (sample ? '/samples/' + sample.file : null);
  const title = run?.invoiceNumber || read?.invoice_number || run?.source?.filename || L?.filename;
  const onUpdate = (r) => { if (L) L.run = r; setStored(r); };

  return html`<div class="page run-page">
    <a class="back" href="#/"><${Icon} n="back" /> Dashboard</a>
    <header class="run-head">
      <div>
        <div class="eyebrow">Run ${id} · ${fmtTime(run?.createdAt || L?.startedAt)} · ${elapsed.toFixed(1)}s</div>
        <h1>${title || 'Invoice'} <span class="muted thin">${run?.vendorName || read?.vendor_name || ''}</span></h1>
      </div>
      <div class="run-head-r">
        ${(run?.total ?? read?.total) != null && html`<div class="amt">${inr(run?.total ?? read?.total)}</div>`}
        ${run ? html`<${Pill} status=${run.decision.status} label=${run.decision.label} />` : L?.error ? html`<${Pill} status="error" />` : html`<${Pill} status="running" label="Running" />`}
      </div>
    </header>

    <ol class="stepper">
      ${STAGES.map((s, i) => html`<li class=${'st ' + stateOf(s.id)}>
        <${StageGlyph} state=${stateOf(s.id)} />
        <div><b>${s.title}</b><small>${stageMap[s.id]?.summary || (runningId === s.id ? (s.id === 'read' ? 'AI is reading the document…' : 'Running…') : s.sub)}</small></div>
      </li>`)}
    </ol>

    <div class="run-grid">
      <div class="run-main">
        ${L?.error && html`<div class="card pad bad-card"><b>The run stopped:</b> ${L.error}</div>`}
        ${run ? html`<${Decision} run=${run} onUpdate=${onUpdate} />` : !L?.error && html`<div class="card decision pending"><div class="dec-body"><div class="spin big"></div><div><div class="eyebrow">Processing</div><h2>${STAGES.find((s) => s.id === runningId)?.title || 'Starting'}…</h2><p class="muted">${runningId === 'read' ? 'The AI is reading the invoice. Every later step is rule-based and runs in milliseconds.' : 'Applying the rules to what was read.'}</p></div></div></div>`}
        ${STAGES.filter((s) => s.id !== 'decide' && (stageMap[s.id] || runningId === s.id)).map((s) => html`<${StageCard} key=${s.id} def=${s} st=${stageMap[s.id]} running=${runningId === s.id} />`)}
      </div>
      <aside class="run-side">
        <div class="card doc">
          <div class="card-h"><span><${Icon} n="file" /> Source document</span>${fileUrl && html`<a href=${fileUrl} target="_blank" rel="noopener" class="link">Open <${Icon} n="arrow" s=${13} /></a>`}</div>
          ${fileUrl ? html`<iframe src=${fileUrl + '#toolbar=0&navpanes=0&view=FitH'} title="Invoice document"></iframe>` : html`<div class="pad muted small">Uploaded files aren't stored in this demo — only what was read from them.</div>`}
        </div>
        ${run && html`<div class="card">
          <div class="card-h"><span><${Icon} n="shield" /> Audit trail</span></div>
          <ul class="audit">${run.audit.map((a) => html`<li><time>${fmtTime(a.at)}</time><div><b>${a.who}</b> ${a.what}</div></li>`)}</ul>
          <div class="pad-x small muted">Rules in force: price ±${run.rulesUsed?.priceTolerancePct}% · PO overrun ${run.rulesUsed?.poOverrunTolerancePct}% · auto-approve ≤ ${inr(run.rulesUsed?.autoApproveLimit)}</div>
        </div>`}
      </aside>
    </div>
  </div>`;
}

function Decision({ run, onUpdate }) {
  const d = run.decision;
  const [note, setNote] = useState('');
  const [who, setWho] = useState(() => { try { return localStorage.getItem('ap:reviewer') || ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  const review = async (action) => {
    if (!note.trim()) return toast('Add a short note — it goes in the audit trail.', 'bad');
    setBusy(true);
    try { try { localStorage.setItem('ap:reviewer', who); } catch {} onUpdate(await api.review({ id: run.id, action, note, reviewer: who || 'AP reviewer' })); toast(action === 'approve' ? 'Approved and posted to ledger' : 'Rejected'); }
    catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
  };
  const copy = () => { navigator.clipboard?.writeText(`To: ${d.email.to}\nSubject: ${d.email.subject}\n\n${d.email.body}`); toast('Email copied'); };
  const cls = { approved: 'ok', needs_review: 'warn', rejected: 'bad' }[d.status];
  const vendorAsks = d.reasons.filter((r) => r.vendorAsk).length;
  return html`<div class=${'card decision ' + cls}>
    <div class="dec-body">
      <div class="dec-ic"><${Icon} n=${d.status === 'approved' ? 'check' : d.status === 'rejected' ? 'x' : 'alert'} s=${22} w=${2.6} /></div>
      <div class="grow">
        <div class="eyebrow">Decision</div>
        <h2>${d.label}</h2>
        <p class="headline">${d.headline}</p>
        <p class="next"><${Icon} n="arrow" s=${14} /> ${d.nextAction}</p>
        ${d.atRisk > 0 && html`<p class="risk"><${Icon} n="shield" s=${14} /> ${inr(d.atRisk)} stopped before payment</p>`}
      </div>
    </div>
    ${d.reasons.length > 0 && html`<div class="dec-sec">
      <h4>Why (${d.reasons.length})</h4>
      <ul class="checks">${d.reasons.map((c) => html`<li><${LevelIcon} level=${c.level} /><span>${c.msg} <em class="tag">${STAGES.find((s) => s.id === c.stage)?.title}</em></span></li>`)}</ul>
    </div>`}
    ${d.email && html`<div class="dec-sec">
      <h4><${Icon} n="mail" /> Drafted query to vendor <span class="muted thin">· ${vendorAsks} point${vendorAsks > 1 ? 's' : ''} · nothing is sent automatically</span></h4>
      <div class="email"><div class="small muted">To: ${d.email.to}<br />Subject: <b>${d.email.subject}</b></div><pre>${d.email.body}</pre>
        <div class="row gap"><button class="btn sm" onClick=${copy}><${Icon} n="copy" s=${14} /> Copy</button>${d.email.to.includes('@') && html`<a class="btn sm ghost" href=${`mailto:${d.email.to}?subject=${encodeURIComponent(d.email.subject)}&body=${encodeURIComponent(d.email.body)}`}>Open in mail app</a>`}</div>
      </div>
    </div>`}
    ${run.review ? html`<div class="dec-sec"><h4>Human review</h4><p><b>${run.review.who}</b> ${run.review.action === 'approve' ? 'approved' : 'rejected'} this on ${fmtTime(run.review.at)}: “${run.review.note}”</p></div>`
      : d.status === 'needs_review' && html`<div class="dec-sec review">
      <h4>Your call</h4>
      <p class="small muted">${run.poInferred ? `Approving confirms ${run.po} as the matching purchase order.` : 'Approving overrides the flags above; rejecting returns it to the vendor.'} Your note is saved to the audit trail.</p>
      <div class="row gap wrap">
        <input class="inp" placeholder="Your name" value=${who} onInput=${(e) => setWho(e.target.value)} style="max-width:180px" />
        <input class="inp grow" placeholder=${run.poInferred ? `e.g. Confirmed with facilities — September housekeeping, ${run.po}` : 'e.g. Price increase agreed by procurement on call'} value=${note} onInput=${(e) => setNote(e.target.value)} />
      </div>
      <div class="row gap">
        <button class="btn ok" disabled=${busy} onClick=${() => review('approve')}><${Icon} n="check" s=${15} /> ${run.poInferred ? `Confirm ${run.po} & approve` : 'Approve for payment'}</button>
        <button class="btn bad ghost" disabled=${busy} onClick=${() => review('reject')}><${Icon} n="x" s=${15} /> Reject</button>
      </div>
    </div>`}
  </div>`;
}

function StageCard({ def, st, running }) {
  const [open, setOpen] = useState(def.id === 'read' || def.id === 'match' || def.id === 'po');
  if (!st) return html`<div class="card stage running"><div class="stage-h"><${StageGlyph} state="running" /><div class="grow"><b>${def.title}</b><div class="small muted">${def.id === 'read' ? 'Reading the document — this is the only step that uses AI.' : 'Running…'}</div></div></div></div>`;
  const hasDetails = ['read', 'match', 'po', 'vendor'].includes(def.id) && st.details && Object.keys(st.details).length > 0;
  return html`<div class=${'card stage ' + st.status}>
    <div class="stage-h">
      <${StageGlyph} state=${st.status} />
      <div class="grow"><b>${def.title}</b> <span class="muted">— ${st.summary}</span></div>
      <span class="ms">${st.ms >= 1000 ? (st.ms / 1000).toFixed(1) + 's' : st.ms + 'ms'}</span>
    </div>
    <ul class="checks">${st.checks.map((c) => html`<li><${LevelIcon} level=${c.level} /><span>${c.msg}</span></li>`)}</ul>
    ${hasDetails && html`<button class="disclose" onClick=${() => setOpen(!open)}>${open ? 'Hide' : 'Show'} details</button>`}
    ${hasDetails && open && html`<div class="details">${DETAILS[def.id]?.(st.details)}</div>`}
  </div>`;
}

const Conf = ({ v }) => v == null ? null : html`<span class=${'conf ' + (v >= 0.9 ? 'hi' : v >= 0.8 ? 'mid' : 'lo')} title="AI-reported confidence">${Math.round(v * 100)}%</span>`;

const DETAILS = {
  read: (d) => {
    const f = d.fields || {}, c = f.confidence || {};
    const kv = [['Vendor', f.vendor_name, c.vendor_name], ['Vendor GSTIN', f.vendor_gstin], ['Invoice no.', f.invoice_number, c.invoice_number], ['Invoice date', f.invoice_date && fmtDate(f.invoice_date), c.invoice_date], ['Due date', f.due_date && fmtDate(f.due_date)], ['PO reference', f.po_reference, c.po_reference], ['Billed to', f.buyer_name], ['Buyer GSTIN', f.buyer_gstin], ['Subtotal', inr(f.subtotal)], ['Tax', (f.tax_lines || []).map((t) => `${t.label} ${t.rate_pct ?? ''}%: ${inr(t.amount)}`).join(' · ') || (f.amounts_tax_inclusive ? 'Included in total' : '—')], ['Total', inr(f.total), c.total]];
    return html`<div class="small muted mb">Read by ${d.source} · document quality: ${f.document_quality}</div>
      <dl class="kv">${kv.map(([k, v, cf]) => html`<div><dt>${k}</dt><dd class=${v == null || v === '—' ? 'nil' : ''}>${v ?? 'not printed'} <${Conf} v=${cf} /></dd></div>`)}</dl>
      <table class="tbl mt"><thead><tr><th>Line item <${Conf} v=${c.line_items} /></th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
      <tbody>${(f.line_items || []).map((l) => html`<tr><td>${l.description}</td><td class="r">${l.quantity ?? '—'}</td><td class="r">${inr(l.unit_price)}</td><td class="r">${inr(l.amount)}</td></tr>`)}</tbody></table>`;
  },
  vendor: (d) => d.vendor ? html`<dl class="kv">${[['Vendor ID', d.vendor.id], ['Registered name', d.vendor.name], ['GSTIN on file', d.vendor.gstin], ['State', d.vendor.state], ['Bank on file', d.vendor.bank], ['Payment terms', 'Net ' + d.vendor.terms], ['Matched by', d.matchedBy]].map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` : null,
  po: (d) => d.candidates?.length ? html`<div class="small muted mb">Every open PO for this vendor was scored on description similarity, whether the amount fits the remaining balance, and billing history:</div>
    <table class="tbl"><thead><tr><th>PO</th><th>Description match</th><th>Fits balance</th><th>Recurring</th><th class="r">Confidence</th></tr></thead>
    <tbody>${d.candidates.map((c, i) => html`<tr class=${i === 0 && c.score >= 0.6 ? 'hl' : ''}><td><b>${c.po}</b><div class="small muted">${c.title}</div></td><td>${Math.round(c.desc * 100)}%</td><td>${c.fits ? 'Yes' : 'No'}</td><td>${c.recurring ? 'Yes' : 'No'}</td><td class="r"><div class="bar"><i style=${`width:${c.score * 100}%`}></i></div>${Math.round(c.score * 100)}%</td></tr>`)}</tbody></table>`
    : d.po ? html`<div class="small">${d.po.po} · ${d.po.title} · ${d.po.type === 'goods' ? 'Goods: invoice is matched to PO and goods receipt (3-way)' : 'Services: invoice is matched to PO (2-way)'}</div>` : null,
  match: (d) => {
    const cu = d.cumulative;
    const pctOf = (n) => Math.min(100, (n / Math.max(cu.value, cu.after)) * 100);
    return html`${d.rows?.length > 0 && html`<table class="tbl"><thead><tr><th>Invoice line → PO line</th><th class="r">Billed qty</th>${d.type === 'goods' && html`<th class="r">Received</th>`}<th class="r">PO rate</th><th class="r">Billed rate</th><th class="r">Variance</th></tr></thead>
      <tbody>${d.rows.map((r) => html`<tr><td>${r.inv.description}${r.po ? html`<div class="small muted">↳ PO line ${r.po.line}: ${r.po.description}</div>` : html`<div class="small bad-t">Not on PO</div>`}</td>
        <td class="r">${r.inv.quantity ?? '—'}${r.billedBefore ? html`<div class="small muted">+${r.billedBefore} earlier</div>` : ''}</td>
        ${d.type === 'goods' && html`<td class="r">${r.received ?? '—'}</td>`}
        <td class="r">${r.po ? inr(r.po.unitPrice ?? r.po.amount) : '—'}</td><td class="r">${inr(r.inv.unit_price)}</td>
        <td class=${'r ' + (r.variancePct > 0 ? (Math.abs(r.variancePct) > 2 ? 'bad-t' : 'warn-t') : '')}>${r.variancePct == null ? '—' : (r.variancePct > 0 ? '+' : '') + r.variancePct.toFixed(1) + '%'}</td></tr>`)}</tbody></table>`}
      ${cu && html`<div class="cum">
        <div class="cum-h"><span>Billing against ${d.po}</span><span>${inr(cu.after)} of ${inr(cu.value)}</span></div>
        <div class="cum-bar">
          <i class="prior" style=${`width:${pctOf(cu.before)}%`}></i><i class=${'this ' + (cu.after > cu.value ? 'over' : '')} style=${`width:${pctOf(cu.thisInvoice)}%`}></i>
          <b class="limit" style=${`left:${pctOf(cu.value)}%`}></b>
        </div>
        <div class="cum-l small muted"><span><i class="sw prior"></i> Earlier invoices ${inr(cu.before)}${cu.priorInvoices.length ? ` (${cu.priorInvoices.map((p) => p.invoiceNumber).join(', ')})` : ''}</span><span><i class="sw this"></i> This invoice ${inr(cu.thisInvoice)}</span><span><i class="sw limit"></i> PO value</span></div>
      </div>`}`;
  },
};
