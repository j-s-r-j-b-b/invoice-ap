// Case view: streams pipeline events and renders each stage as it executes, then the decision
// with the actions that make sense for it.
import { useEffect, useState, useReducer, useRef } from 'preact/hooks';
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

// Starts processing (new document or re-check); resolves with the case id once the server assigns it.
export function startRun(payload, meta = {}) {
  return new Promise((resolve) => {
    let id = null;
    api.process(payload, (ev) => {
      if (ev.type === 'run') {
        id = ev.id;
        live[id] = { id, startedAt: ev.startedAt, recheck: ev.recheck, inboxId: payload.inboxId, filename: meta.filename, fileUrl: meta.fileUrl, stages: {}, running: 'intake', run: null, error: null };
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

export const fileUrlFor = (run, meta) => {
  const inboxItem = run?.source?.inboxId && meta?.inbox.find((m) => m.id === run.source.inboxId);
  return inboxItem ? '/samples/' + inboxItem.file : run ? '/api/runs?file=' + run.id : null;
};

// ---------- page ----------
export function RunView({ id, meta }) {
  useLiveTick();
  const [stored, setStored] = useState(null);
  const [err, setErr] = useState(null);
  const L = live[id];
  const run = L ? L.run : stored;
  useEffect(() => {
    if (L) return;
    setStored(null); setErr(null);
    api.run(id).then(setStored).catch((e) => setErr(e.message));
  }, [id]);
  const [, setTick] = useState(0);
  const isLive = L && !L.run && !L.error;
  useEffect(() => { if (!isLive) return; const t = setInterval(() => setTick((x) => x + 1), 250); return () => clearInterval(t); }, [isLive]);

  if (err) return html`<div class="page"><a class="back" href="#/"><${Icon} n="back" /> Dashboard</a><div class="card pad">Couldn't load case ${id}: ${err}</div></div>`;
  if (!L && !stored) return html`<div class="page"><div class="skeleton tall"></div></div>`;

  const stageMap = run ? Object.fromEntries(run.stages.map((s) => [s.id, s])) : L.stages;
  const runningId = run ? null : L.running;
  const stateOf = (sid) => stageMap[sid]?.status || (runningId === sid ? 'running' : 'idle');
  const read = stageMap.read?.details?.fields;
  const started = L?.startedAt || run?.createdAt;
  const elapsed = L ? (Date.now() - new Date(L.startedAt)) / 1000 : 0;
  const fileUrl = L?.fileUrl || fileUrlFor(run || stored, meta);
  const title = run?.invoiceNumber || read?.invoice_number || run?.source?.filename || L?.filename;
  const onUpdate = (r) => { if (L) L.run = r; else setStored(r); };
  const recheck = async () => { const rid = await startRun({ recheck: id }, { fileUrl }); if (!rid) return; };

  return html`<div class="page run-page">
    <a class="back" href="#/"><${Icon} n="back" /> Dashboard</a>
    <header class="run-head">
      <div>
        <div class="eyebrow">Case ${id}${run?.version > 1 ? ` · re-checked ${run.version - 1}×` : ''} · via ${run?.source?.channel || (L?.recheck ? 're-check' : L?.inboxId ? 'AP inbox' : 'upload')} · ${fmtTime(run?.createdAt || started)}${isLive ? ` · ${elapsed.toFixed(1)}s` : ''}</div>
        <h1>${title || 'Invoice'} <span class="muted thin">${run?.vendorName || read?.vendor_name || ''}</span></h1>
      </div>
      <div class="run-head-r">
        ${(run?.total ?? read?.total) != null && html`<div class="amt">${inr(run?.total ?? read?.total)}</div>`}
        ${run ? html`<${Pill} status=${run.decision.status} label=${run.decision.label} />` : L?.error ? html`<${Pill} status="error" />` : html`<${Pill} status="running" label=${L?.recheck ? 'Re-checking' : 'Processing'} />`}
      </div>
    </header>

    <ol class="stepper">
      ${STAGES.map((s) => html`<li class=${'st ' + stateOf(s.id)}>
        <${StageGlyph} state=${stateOf(s.id)} />
        <div><b>${s.title}</b><small>${stageMap[s.id]?.summary || (runningId === s.id ? (s.id === 'read' ? 'AI is reading the document…' : 'Running…') : s.sub)}</small></div>
      </li>`)}
    </ol>

    <div class="run-grid">
      <div class="run-main">
        ${L?.error && html`<div class="card pad bad-card"><b>Processing stopped:</b> ${L.error}</div>`}
        ${run ? html`<${Decision} run=${run} onUpdate=${onUpdate} onRecheck=${recheck} />` : !L?.error && html`<div class="card decision pending"><div class="dec-body"><div class="spin big"></div><div><div class="eyebrow">${L?.recheck ? 'Re-checking with current rules' : 'Processing'}</div><h2>${STAGES.find((s) => s.id === runningId)?.title || 'Starting'}…</h2><p class="muted">${runningId === 'read' ? 'The AI is reading the invoice. It only extracts what is printed — every later step is a rule and runs in milliseconds.' : 'Applying the rules to what was read.'}</p></div></div></div>`}
        ${STAGES.filter((s) => s.id !== 'decide' && (stageMap[s.id] || runningId === s.id)).map((s) => html`<${StageCard} key=${s.id + (run?.version || 0)} def=${s} st=${stageMap[s.id]} />`)}
      </div>
      <aside class="run-side">
        <div class="card doc">
          <div class="card-h"><span><${Icon} n="file" /> ${run?.source?.filename || L?.filename || 'Document'}</span>${fileUrl && html`<a href=${fileUrl} target="_blank" rel="noopener" class="link">Open <${Icon} n="arrow" s=${13} /></a>`}</div>
          <${DocViewer} url=${fileUrl} mime=${run?.source?.mimeType} />
        </div>
        ${run && html`<div class="card">
          <div class="card-h"><span><${Icon} n="shield" /> Audit trail</span></div>
          <ul class="audit">${run.audit.map((a) => html`<li><time>${fmtTime(a.at)}</time><div><b>${a.who}</b> · ${a.what}</div></li>`)}</ul>
          <div class="pad-x small muted">Rules applied: price tolerance ${run.rulesUsed?.priceTolerancePct}% · PO overrun ${run.rulesUsed?.poOverrunTolerancePct}% · auto-approve up to ${inr(run.rulesUsed?.autoApproveLimit)} · <a href="#/rules">change</a></div>
        </div>`}
      </aside>
    </div>
  </div>`;
}

// Renders PDFs with pdf.js (works in every browser, unlike an <iframe>); images directly.
let pdfjsP = null;
const loadPdfjs = () => pdfjsP || (pdfjsP = new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; res(window.pdfjsLib); };
  s.onerror = rej; document.head.appendChild(s);
}));
function DocViewer({ url, mime }) {
  const box = useRef(null);
  const [state, setState] = useState('loading');
  useEffect(() => {
    if (!url) return;
    let dead = false;
    const el = box.current; el.innerHTML = ''; setState('loading');
    (async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error('missing');
      const type = r.headers.get('content-type') || mime || '';
      const buf = await r.arrayBuffer();
      if (dead) return;
      if (type.startsWith('image/')) {
        const img = document.createElement('img'); img.src = URL.createObjectURL(new Blob([buf], { type })); el.appendChild(img);
      } else {
        const pdfjs = await loadPdfjs();
        const pdf = await pdfjs.getDocument({ data: buf }).promise;
        for (let p = 1; p <= Math.min(pdf.numPages, 3); p++) {
          const page = await pdf.getPage(p);
          const vp = page.getViewport({ scale: 2 });
          const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          if (dead) return; el.appendChild(c);
        }
      }
      setState('ok');
    })().catch(() => !dead && setState('missing'));
    return () => { dead = true; };
  }, [url]);
  if (!url) return html`<div class="pad muted small">No document.</div>`;
  return html`<div class="docview">${state === 'loading' && html`<div class="pad"><div class="skeleton"></div></div>`}${state === 'missing' && html`<div class="pad muted small">The original file wasn't stored (too large for the demo database) — only what was read from it.</div>`}<div ref=${box} class="pages"></div></div>`;
}

function Decision({ run, onUpdate, onRecheck }) {
  const d = run.decision;
  const [note, setNote] = useState('');
  const [who, setWho] = useState(() => { try { return localStorage.getItem('ap:reviewer') || ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  const act = async (action) => {
    if (action !== 'query_sent' && !note.trim()) return toast('Add a short reason — it goes in the audit trail.', 'bad');
    setBusy(true);
    try {
      try { localStorage.setItem('ap:reviewer', who); } catch {}
      onUpdate(await api.review({ id: run.id, action, note, reviewer: who || 'AP team' }));
      toast({ approve: 'Approved and posted to the ledger', reject: 'Rejected', query_sent: 'Marked as sent — case stays on hold' }[action]);
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
  };
  const copy = () => { navigator.clipboard?.writeText(`To: ${d.email.to}\nSubject: ${d.email.subject}\n\n${d.email.body}`); toast('Email copied'); };
  const cls = { approved: 'ok', needs_approval: 'warn', vendor_hold: 'hold', rejected: 'bad' }[d.status];
  const icon = { approved: 'check', needs_approval: 'alert', vendor_hold: 'mail', rejected: 'x' }[d.status];
  const open = ['needs_approval', 'vendor_hold'].includes(d.status) && !run.review;
  const vendorAsks = d.reasons.filter((r) => r.vendorAsk);
  const internal = d.reasons.filter((r) => !r.vendorAsk);
  return html`<div class=${'card decision ' + cls}>
    <div class="dec-body">
      <div class="dec-ic"><${Icon} n=${icon} s=${22} w=${2.4} /></div>
      <div class="grow">
        <div class="eyebrow">Decision</div>
        <h2>${d.label}</h2>
        <p class="headline">${d.headline}</p>
        <p class="next"><${Icon} n="arrow" s=${14} /> ${d.nextAction}</p>
        ${d.atRisk > 0 && !(run.review?.action === 'approve') && html`<p class="risk"><${Icon} n="shield" s=${14} /> ${inr(d.atRisk)} kept from being paid</p>`}
      </div>
    </div>

    ${d.reasons.length > 0 && html`<div class="dec-sec">
      ${vendorAsks.length > 0 && html`<h4>What the vendor must fix</h4><ul class="checks">${vendorAsks.map((c) => html`<li><${LevelIcon} level=${c.level} /><span>${c.msg} <em class="tag">${STAGES.find((s) => s.id === c.stage)?.title}</em></span></li>`)}</ul>`}
      ${internal.length > 0 && html`<h4 class=${vendorAsks.length ? 'mt' : ''}>What we need to decide internally</h4><ul class="checks">${internal.map((c) => html`<li><${LevelIcon} level=${c.level} /><span>${c.msg} <em class="tag">${STAGES.find((s) => s.id === c.stage)?.title}</em></span></li>`)}</ul>`}
    </div>`}

    ${d.email && d.status !== 'approved' && html`<div class="dec-sec">
      <h4><${Icon} n="mail" /> Message to vendor <span class="muted thin">· drafted, not sent${run.vendorQuery ? ` · marked sent by ${run.vendorQuery.who}, ${fmtTime(run.vendorQuery.at)}` : ''}</span></h4>
      <div class="email"><div class="small muted">To: ${d.email.to}<br />Subject: <b>${d.email.subject}</b></div><pre>${d.email.body}</pre>
        <div class="row gap wrap">
          ${d.email.to.includes('@') && html`<a class="btn sm" href=${`mailto:${d.email.to}?subject=${encodeURIComponent(d.email.subject)}&body=${encodeURIComponent(d.email.body)}`}><${Icon} n="mail" s=${14} /> Open in mail app</a>`}
          <button class="btn sm ghost" onClick=${copy}><${Icon} n="copy" s=${14} /> Copy</button>
          ${open && d.status === 'vendor_hold' && !run.vendorQuery && html`<button class="btn sm ghost" disabled=${busy} onClick=${() => act('query_sent')}><${Icon} n="check" s=${14} /> Mark as sent</button>`}
        </div>
      </div>
    </div>`}

    ${run.review && html`<div class="dec-sec"><h4>Decided by a person</h4><p><b>${run.review.who}</b> ${run.review.action === 'approve' ? (run.review.override ? 'overrode the hold and approved' : 'approved') : 'rejected'} this on ${fmtTime(run.review.at)}: “${run.review.note}”</p></div>`}

    ${open && html`<div class="dec-sec review">
      <h4>${d.status === 'needs_approval' ? 'Your decision' : 'When the vendor replies'}</h4>
      <p class="small muted">${d.status === 'needs_approval'
        ? (run.poInferred ? `Approving confirms ${run.po} as the purchase order this invoice is booked against.` : 'Approve to release for payment, or reject. Your reason is saved to the audit trail.')
        : 'If the vendor sends a corrected invoice, process it as a new document. If they justify the difference (e.g. an agreed price change), update the rule or approve with a reason.'}</p>
      <div class="row gap wrap">
        <input class="inp" placeholder="Your name" value=${who} onInput=${(e) => setWho(e.target.value)} style="max-width:170px" />
        <input class="inp grow" placeholder=${run.poInferred ? `e.g. Confirmed with facilities — September housekeeping` : d.status === 'vendor_hold' ? 'e.g. Procurement agreed the new glove price on 29 Sep' : 'Reason'} value=${note} onInput=${(e) => setNote(e.target.value)} />
      </div>
      <div class="row gap wrap">
        <button class="btn ok" disabled=${busy} onClick=${() => act('approve')}><${Icon} n="check" s=${15} /> ${run.poInferred && d.status === 'needs_approval' ? `Confirm ${run.po} & approve` : d.status === 'vendor_hold' ? 'Approve anyway' : 'Approve for payment'}</button>
        <button class="btn bad ghost" disabled=${busy} onClick=${() => act('reject')}><${Icon} n="x" s=${15} /> Reject</button>
        <span class="grow"></span>
        <button class="btn ghost" disabled=${busy} onClick=${onRecheck} title="Re-apply the current rules to this same invoice"><${Icon} n="refresh" s=${14} /> Re-check with current rules</button>
      </div>
    </div>`}

    ${run.history?.length > 0 && html`<div class="dec-sec"><h4>Earlier decisions on this case</h4><ul class="hist">${run.history.map((h) => html`<li><time>${fmtTime(h.at)}</time><${Pill} status=${h.status} label=${h.label} /><span class="small muted">${h.headline}</span></li>`)}</ul></div>`}
  </div>`;
}

function StageCard({ def, st }) {
  const [open, setOpen] = useState(def.id === 'read' || def.id === 'match' || (def.id === 'po' && st?.details?.inferred));
  if (!st) return html`<div class="card stage running"><div class="stage-h"><${StageGlyph} state="running" /><div class="grow"><b>${def.title}</b><div class="small muted">${def.id === 'read' ? 'Reading the document — the only step that uses AI.' : 'Running…'}</div></div></div></div>`;
  const hasDetails = ['read', 'match', 'po', 'vendor'].includes(def.id) && st.details && Object.keys(st.details).length > 0 && DETAILS[def.id]?.(st.details);
  return html`<div class=${'card stage ' + st.status}>
    <div class="stage-h">
      <${StageGlyph} state=${st.status} />
      <div class="grow"><b>${def.title}</b> <span class="muted">— ${st.summary}</span></div>
      <span class="ms">${st.ms >= 1000 ? (st.ms / 1000).toFixed(1) + 's' : st.ms + 'ms'}</span>
    </div>
    <ul class="checks">${st.checks.map((c) => html`<li><${LevelIcon} level=${c.level} /><span>${c.msg}</span></li>`)}</ul>
    ${hasDetails && html`<button class="disclose" onClick=${() => setOpen(!open)}>${open ? 'Hide' : 'Show'} details</button>`}
    ${hasDetails && open && html`<div class="details">${DETAILS[def.id](st.details)}</div>`}
  </div>`;
}

const Conf = ({ v }) => v == null ? null : html`<span class=${'conf ' + (v >= 0.9 ? 'hi' : v >= 0.8 ? 'mid' : 'lo')} title="How sure the AI is that it read this correctly">${Math.round(v * 100)}%</span>`;

const DETAILS = {
  read: (d) => {
    const f = d.fields || {}, c = f.confidence || {};
    const kv = [['Vendor', f.vendor_name, c.vendor_name], ['Vendor GSTIN', f.vendor_gstin], ['Invoice no.', f.invoice_number, c.invoice_number], ['Invoice date', f.invoice_date && fmtDate(f.invoice_date), c.invoice_date], ['Due date', f.due_date && fmtDate(f.due_date)], ['PO reference', f.po_reference, c.po_reference], ['Billed to', f.buyer_name], ['Buyer GSTIN', f.buyer_gstin], ['Subtotal', f.subtotal != null ? inr(f.subtotal) : null], ['Tax', (f.tax_lines || []).map((t) => `${t.label} ${t.rate_pct ?? ''}%: ${inr(t.amount)}`).join(' · ') || (f.amounts_tax_inclusive ? 'Included in total (not shown)' : null)], ['Total', inr(f.total), c.total]];
    return html`<div class="small muted mb">Read by ${d.source} · document quality: ${f.document_quality} · <span class="conf hi">90%+</span> sure <span class="conf mid">80–89%</span> <span class="conf lo">${'under 80%'}</span> check by eye</div>
      <dl class="kv">${kv.map(([k, v, cf]) => html`<div><dt>${k}</dt><dd class=${v == null || v === '—' ? 'nil' : ''}>${v ?? 'not on document'} <${Conf} v=${cf} /></dd></div>`)}</dl>
      <table class="tbl mt"><thead><tr><th>Line item <${Conf} v=${c.line_items} /></th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
      <tbody>${(f.line_items || []).map((l) => html`<tr><td>${l.description}</td><td class="r">${l.quantity ?? '—'}</td><td class="r">${inr(l.unit_price)}</td><td class="r">${inr(l.amount)}</td></tr>`)}</tbody></table>`;
  },
  vendor: (d) => d.vendor ? html`<dl class="kv">${[['Vendor ID', d.vendor.id], ['Registered name', d.vendor.name], ['GSTIN on file', d.vendor.gstin], ['State', d.vendor.state], ['Bank on file', d.vendor.bank], ['Payment terms', 'Net ' + d.vendor.terms + ' days'], ['Matched by', d.matchedBy]].map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` : null,
  po: (d) => d.candidates?.length ? html`<div class="small muted mb">No PO number was printed, so every open PO for this vendor was scored:</div>
    <table class="tbl"><thead><tr><th>PO</th><th>Descriptions match</th><th>Fits remaining balance</th><th>Billed this amount before</th><th class="r">Confidence</th></tr></thead>
    <tbody>${d.candidates.map((c, i) => html`<tr class=${i === 0 && c.score >= 0.6 ? 'hl' : ''}><td><b>${c.po}</b><div class="small muted">${c.title}</div></td><td>${Math.round(c.desc * 100)}%</td><td>${c.fits ? 'Yes' : 'No'}</td><td>${c.recurring ? 'Yes — monthly' : 'No'}</td><td class="r"><div class="bar"><i style=${`width:${c.score * 100}%`}></i></div>${Math.round(c.score * 100)}%</td></tr>`)}</tbody></table>`
    : null,
  match: (d) => {
    const cu = d.cumulative;
    if (!cu) return null;
    const scale = Math.max(cu.value, cu.after);
    const pctOf = (n) => Math.min(100, (n / scale) * 100);
    return html`${d.rows?.length > 0 && html`<table class="tbl"><thead><tr><th>Invoice line → PO line</th><th class="r">Billed qty</th>${d.type === 'goods' && html`<th class="r">Received</th>`}<th class="r">PO rate</th><th class="r">Billed rate</th><th class="r">Difference</th></tr></thead>
      <tbody>${d.rows.map((r) => html`<tr><td>${r.inv.description}${r.po ? html`<div class="small muted">↳ PO line ${r.po.line}: ${r.po.description}</div>` : html`<div class="small warn-t">No matching PO line</div>`}</td>
        <td class="r">${r.inv.quantity ?? '—'}${r.billedBefore ? html`<div class="small muted">+${r.billedBefore} billed earlier</div>` : ''}</td>
        ${d.type === 'goods' && html`<td class="r">${r.received ?? '—'}</td>`}
        <td class="r">${r.po ? (r.po.unitPrice != null ? inr(r.po.unitPrice) : 'lump sum') : '—'}</td><td class="r">${inr(r.inv.unit_price)}</td>
        <td class=${'r ' + (r.variancePct > 0.001 ? 'warn-t' : '')}>${r.variancePct == null ? '—' : Math.abs(r.variancePct) < 0.001 ? 'none' : (r.variancePct > 0 ? '+' : '') + r.variancePct.toFixed(1) + '%'}</td></tr>`)}</tbody></table>`}
      <div class="cum">
        <div class="cum-h"><span>Billing against ${d.po}</span><span>${inr(cu.after)} of ${inr(cu.value)}</span></div>
        <div class="cum-bar">
          <i class="prior" style=${`width:${pctOf(cu.before)}%`}></i><i class=${'this ' + (cu.after > cu.value + 1 ? 'over' : '')} style=${`width:${pctOf(cu.thisInvoice)}%`}></i>
          <b class="limit" style=${`left:${pctOf(cu.value)}%`}></b>
        </div>
        <div class="cum-l small muted"><span><i class="sw prior"></i> Billed earlier ${inr(cu.before)}${cu.priorInvoices.length ? ` (${cu.priorInvoices.map((p) => p.invoiceNumber).join(', ')})` : ''}</span><span><i class="sw this"></i> This invoice ${inr(cu.thisInvoice)}</span><span><i class="sw limit"></i> PO value</span></div>
      </div>`;
  },
};
