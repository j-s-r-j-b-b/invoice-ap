import { render } from 'preact';
import { useEffect, useState, useMemo } from 'preact/hooks';
import { html, Icon, Pill, Empty, toast } from './ui.js';
import { api, fileToBase64, inr, inrShort, fmtDate, ago } from './api.js';
import { RunView, startRun, live, useLiveTick, STAGES } from './run.js';

// ---------- routing ----------
const parse = () => {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  return { parts: path.split('/').filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || '')) };
};
const go = (h) => { location.hash = h; };

function App() {
  const [route, setRoute] = useState(parse());
  const [meta, setMeta] = useState(null);
  const [metaErr, setMetaErr] = useState(null);
  const loadMeta = () => api.meta().then(setMeta).catch((e) => setMetaErr(e.message));
  useEffect(() => { const f = () => { setRoute(parse()); window.scrollTo(0, 0); if (/^#\/(data|rules)/.test(location.hash)) loadMeta(); }; addEventListener('hashchange', f); loadMeta(); return () => removeEventListener('hashchange', f); }, []);
  const [p0, p1] = route.parts;
  let page;
  if (metaErr) page = html`<div class="page"><div class="card pad bad-card">Can't reach the server: ${metaErr}</div></div>`;
  else if (!meta) page = html`<div class="page"><div class="skeleton tall"></div></div>`;
  else if (p0 === 'run' && p1) page = html`<${RunView} id=${p1} meta=${meta} go=${go} />`;
  else if (p0 === 'new') page = html`<${NewRun} meta=${meta} />`;
  else if (p0 === 'rules') page = html`<${Rules} meta=${meta} reload=${loadMeta} />`;
  else if (p0 === 'data') page = html`<${Data} meta=${meta} tab=${route.q.tab} />`;
  else page = html`<${Dashboard} meta=${meta} filter=${route.q.f || 'all'} />`;
  const nav = [['', 'grid', 'Dashboard'], ['new', 'play', 'Process invoice'], ['?f=needs_review', 'inbox', 'Review queue'], ['rules', 'sliders', 'Rules'], ['data', 'db', 'Reference data']];
  const active = (k) => k === '' ? !p0 && route.q.f !== 'needs_review' : k.startsWith('?') ? !p0 && route.q.f === 'needs_review' : p0 === k;
  return html`<div class="shell">
    <aside class="side">
      <a class="brand" href="#/"><span class="logo"><${Icon} n="check" s=${16} w=${3} /></span><span><b>Checkpoint</b><small>Accounts payable</small></span></a>
      <nav>${nav.map(([k, ic, label]) => html`<a href=${'#/' + k} class=${active(k) ? 'on' : ''}><${Icon} n=${ic} s=${17} /> <span>${label}</span></a>`)}</nav>
      <div class="side-foot">
        <div class="small"><b>${meta?.company.name || ''}</b></div>
        <div class="small muted">GSTIN ${meta?.company.gstin || ''}</div>
        ${meta && html`<div class="env small"><span class=${'dot ' + (meta.env.extractor ? 'ok' : 'warn')}></span>${meta.env.extractor ? `AI: ${meta.env.extractor === 'claude' ? 'Claude' : 'Gemini'}` : 'AI: offline (stored readings)'}</div>
        <div class="env small"><span class=${'dot ' + (meta.env.store === 'redis' ? 'ok' : 'warn')}></span>${meta.env.store === 'redis' ? 'History: shared database' : meta.env.store === 'local-file' ? 'History: local file' : 'History: temporary'}</div>`}
      </div>
    </aside>
    <main>${page}</main>
  </div>`;
}

// ---------- dashboard ----------
function useRuns() {
  useLiveTick();
  const [runs, setRuns] = useState(null);
  const liveDone = Object.values(live).filter((l) => l.run).length;
  useEffect(() => { api.runs().then(setRuns).catch((e) => toast(e.message, 'bad')); }, [liveDone]);
  return runs;
}

function Dashboard({ meta, filter }) {
  const runs = useRuns();
  const inFlight = Object.values(live).filter((l) => !l.run && !l.error);
  const k = useMemo(() => {
    if (!runs) return null;
    const by = (s) => runs.filter((r) => r.decision.status === s);
    const auto = runs.filter((r) => r.decision.status === 'approved' && !r.review).length;
    return {
      total: runs.length, auto, review: by('needs_review').length, rejected: by('rejected').length, approved: by('approved').length,
      value: runs.reduce((s, r) => s + (r.total || 0), 0),
      risk: runs.reduce((s, r) => s + (r.decision.atRisk || 0), 0),
      stp: runs.length ? Math.round((auto / runs.length) * 100) : 0,
    };
  }, [runs]);
  const shown = runs ? (filter === 'all' ? runs : runs.filter((r) => r.decision.status === filter)) : [];
  const tabs = [['all', 'All', k?.total], ['needs_review', 'Needs review', k?.review], ['approved', 'Approved', k?.approved], ['rejected', 'Rejected', k?.rejected]];
  return html`<div class="page">
    <header class="page-h">
      <div><h1>${filter === 'needs_review' ? 'Review queue' : 'Overview'}</h1><p class="muted">${filter === 'needs_review' ? 'Invoices the rules could not clear on their own. Each one says exactly why.' : 'Every invoice, what the process decided, and why.'}</p></div>
      <a class="btn primary" href="#/new"><${Icon} n="upload" s=${16} /> Process invoice</a>
    </header>

    ${filter !== 'needs_review' && html`<div class="how card">
      <div class="how-l"><div class="eyebrow">How it works</div><b>AI reads. Rules decide. People handle exceptions.</b><p class="small muted">The AI only extracts what's printed. Every decision comes from rules you can see and change.</p></div>
      <ol class="how-steps">${STAGES.map((s, i) => html`<li><span>${i + 1}</span>${s.title}</li>`)}</ol>
    </div>`}

    ${k && filter !== 'needs_review' && html`<div class="kpis">
      <div class="kpi"><small>Invoices processed</small><b>${k.total}</b><span class="muted">${inrShort(k.value)} total value</span></div>
      <div class="kpi"><small>Straight-through</small><b>${k.stp}%</b><span class="muted">${k.auto} approved with no human touch</span></div>
      <a class="kpi click" href="#/?f=needs_review"><small>Waiting for review</small><b class=${k.review ? 'warn-t' : ''}>${k.review}</b><span class="muted">Open the queue →</span></a>
      <div class="kpi"><small>Rejected</small><b class=${k.rejected ? 'bad-t' : ''}>${k.rejected}</b><span class="muted">Returned to vendor</span></div>
      <div class="kpi accent"><small>Stopped before payment</small><b>${inrShort(k.risk)}</b><span class="muted">Duplicates + overcharges caught</span></div>
    </div>`}

    <div class="card">
      <div class="tabs">${tabs.map(([key, label, n]) => html`<a href=${key === 'all' ? '#/' : '#/?f=' + key} class=${filter === key ? 'on' : ''}>${label}${n != null && html`<span class="count">${n}</span>`}</a>`)}</div>
      ${inFlight.map((l) => html`<a class="row-run live" href=${'#/run/' + l.id}><span class="spin"></span><b>${l.filename}</b><span class="muted">Running · ${STAGES.find((s) => s.id === l.running)?.title || ''}</span></a>`)}
      ${!runs ? html`<div class="pad"><div class="skeleton"></div></div>`
        : !shown.length ? html`<${Empty} title=${filter === 'needs_review' ? 'Nothing waiting' : 'No invoices yet'}>${filter === 'needs_review' ? 'Every processed invoice has been cleared.' : html`<a href="#/new">Process an invoice</a> — or run one of the six prepared samples.`}<//>`
        : html`<div class="tbl-wrap"><table class="tbl runs">
          <thead><tr><th>Invoice</th><th>Vendor</th><th>PO</th><th class="r">Amount</th><th>Decision</th><th>Main reason</th><th></th></tr></thead>
          <tbody>${shown.map((r) => html`<tr onClick=${() => go('/run/' + r.id)}>
            <td><b>${r.invoiceNumber || html`<span class="muted">no number</span>`}</b><div class="small muted">${r.id} · ${ago(r.createdAt)}</div></td>
            <td>${r.vendorName}</td>
            <td>${r.po || '—'}${r.poInferred ? html` <span class="tag">inferred</span>` : ''}</td>
            <td class="r num">${inr(r.total)}</td>
            <td><${Pill} status=${r.decision.status} label=${r.decision.label} /></td>
            <td class="reason">${r.decision.status === 'approved' && !r.review ? html`<span class="muted">All checks passed</span>` : r.review ? html`<span class="muted">${r.review.who}: “${r.review.note}”</span>` : r.decision.reasons[0]?.msg}</td>
            <td class="r"><${Icon} n="arrow" s=${15} cls="muted" /></td>
          </tr>`)}</tbody></table></div>`}
    </div>
  </div>`;
}

// ---------- process invoice ----------
function NewRun({ meta }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(null);
  const canAI = !!meta.env.extractor;
  const [offline, setOffline] = useState(false);
  const runFile = async (file, sampleId) => {
    if (!file) return;
    const okType = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type);
    if (!okType) return toast('Please choose a PDF or an image (PNG / JPG).', 'bad');
    if (file.size > 3.2 * 1024 * 1024) return toast('File is over 3 MB — please compress it first.', 'bad');
    if (!sampleId && !canAI) return toast('Uploads need an AI key on the server. Samples work offline.', 'bad');
    setBusy(sampleId || 'upload');
    const base64 = await fileToBase64(file);
    const id = await startRun({ base64, mimeType: file.type, filename: file.name, sampleId, mode: offline ? 'cached' : undefined }, sampleId ? null : URL.createObjectURL(file));
    setBusy(null);
    if (id) go('/run/' + id);
  };
  const runSample = async (s) => {
    const blob = await fetch('/samples/' + s.file).then((r) => r.blob());
    runFile(new File([blob], s.file, { type: 'application/pdf' }), s.id);
  };
  const runAll = async () => {
    setBusy('all');
    for (const s of meta.samples) {
      const blob = await fetch('/samples/' + s.file).then((r) => r.blob());
      const id = await startRun({ base64: await fileToBase64(blob), mimeType: 'application/pdf', filename: s.file, sampleId: s.id, mode: offline ? 'cached' : undefined });
      if (!id) break;
      await new Promise((res) => { const t = setInterval(() => { if (live[id].run || live[id].error) { clearInterval(t); res(); } }, 300); });
    }
    setBusy(null); go('/');
  };
  return html`<div class="page">
    <header class="page-h"><div><h1>Process an invoice</h1><p class="muted">Drop in a vendor invoice — clean PDF, scanned PDF or a photo. You'll watch every step run.</p></div></header>
    <label class=${'drop card ' + (drag ? 'drag' : '')} onDragOver=${(e) => { e.preventDefault(); setDrag(true); }} onDragLeave=${() => setDrag(false)} onDrop=${(e) => { e.preventDefault(); setDrag(false); runFile(e.dataTransfer.files[0]); }}>
      <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange=${(e) => runFile(e.target.files[0])} />
      <div class="drop-ic">${busy === 'upload' ? html`<span class="spin big"></span>` : html`<${Icon} n="upload" s=${26} />`}</div>
      <b>${busy === 'upload' ? 'Uploading…' : 'Drop an invoice here, or click to choose'}</b>
      <span class="small muted">PDF, PNG or JPG · up to 3 MB${canAI ? '' : ' · needs an AI key on the server'}</span>
    </label>

    <div class="sec-h">
      <div><h2>Prepared test invoices</h2><p class="muted small">One happy path and five edge cases, built against the PO register, goods receipts and payment history in <a href="#/data">Reference data</a>.</p></div>
      <div class="row gap wrap">
        ${canAI && html`<label class="switch small" title="Skip the AI call and use a stored reading of the sample — a safety net for flaky networks"><input type="checkbox" checked=${offline} onChange=${(e) => setOffline(e.target.checked)} /><i></i> Offline demo mode</label>`}
        <button class="btn" disabled=${!!busy} onClick=${runAll}>${busy === 'all' ? html`<span class="spin"></span> Running all…` : html`<${Icon} n="play" s=${14} /> Run all six`}</button>
      </div>
    </div>
    <div class="samples">${meta.samples.map((s) => html`<div class="card sample">
      <div class="row between"><span class=${'kind ' + (s.kind === 'Happy path' ? 'ok' : '')}>${s.kind}</span><span class="small muted">Expected: <${Pill} status=${s.expect} /></span></div>
      <h3>${s.title}</h3>
      <p class="small muted">${s.blurb}</p>
      <div class="row gap mt-auto">
        <button class="btn primary sm" disabled=${!!busy} onClick=${() => runSample(s)}>${busy === s.id ? html`<span class="spin"></span> Starting…` : html`<${Icon} n="play" s=${13} /> Run`}</button>
        <a class="btn ghost sm" href=${'/samples/' + s.file} target="_blank" rel="noopener"><${Icon} n="eye" s=${14} /> View PDF</a>
      </div>
    </div>`)}</div>
  </div>`;
}

// ---------- rules ----------
const RULES = [
  ['priceTolerancePct', 'Price tolerance', '%', 'A billed unit price may exceed the PO price by this much and still auto-approve.'],
  ['poOverrunTolerancePct', 'PO overrun tolerance', '%', 'Total billed against a PO (all invoices together) may exceed the PO value by this much.'],
  ['autoApproveLimit', 'Auto-approval limit', '₹', 'Invoices above this total always need a person, even if every check passes.'],
  ['duplicateWindowDays', 'Duplicate window', 'days', 'Same vendor + same amount within this many days is flagged as a possible duplicate.'],
  ['minConfidence', 'Minimum AI confidence', '0–1', 'If the AI is less sure than this about a key field, a person verifies it.'],
  ['maxInvoiceAgeDays', 'Maximum invoice age', 'days', 'Older invoices are flagged (possible stale or re-sent bill).'],
  ['amountMatchTolerance', 'Rounding allowance', '₹', 'Arithmetic differences up to this amount are ignored.'],
];
function Rules({ meta, reload }) {
  const [r, setR] = useState(meta.rules);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(r) !== JSON.stringify(meta.rules);
  const save = async () => { setSaving(true); try { await api.saveRules(r); await reload(); toast('Rules saved — they apply to the next run'); } catch (e) { toast(e.message, 'bad'); } setSaving(false); };
  const reset = async () => { if (!confirm('Delete all runs and restore the original ledger and rules?')) return; await api.reset(); Object.keys(live).forEach((k) => delete live[k]); await reload(); setR({ ...meta.defaultRules }); toast('Demo data reset'); go('/'); };
  return html`<div class="page narrow">
    <header class="page-h"><div><h1>Rules</h1><p class="muted">The policy the process applies after the AI has read an invoice. Change a number, re-run an invoice, and the decision changes — no code, no retraining.</p></div></header>
    <div class="card">
      ${RULES.map(([key, label, unit, hint]) => html`<div class="rule">
        <div><b>${label}</b><div class="small muted">${hint}</div></div>
        <div class="rule-in"><input class="inp num" type="number" step="any" min="0" value=${r[key]} onInput=${(e) => setR({ ...r, [key]: e.target.value === '' ? '' : Number(e.target.value) })} /><span class="unit">${unit}</span></div>
      </div>`)}
      <div class="rule">
        <div><b>Let inferred POs auto-approve</b><div class="small muted">When an invoice has no PO number, allow a ≥90% confident match to clear without a person. Off by default — a guess shouldn't release money.</div></div>
        <label class="switch"><input type="checkbox" checked=${r.allowInferredPoAutoApprove} onChange=${(e) => setR({ ...r, allowInferredPoAutoApprove: e.target.checked })} /><i></i></label>
      </div>
      <div class="rule-foot row gap"><button class="btn primary" disabled=${!dirty || saving} onClick=${save}>${saving ? 'Saving…' : 'Save rules'}</button><button class="btn ghost" onClick=${() => setR({ ...meta.defaultRules })}>Restore defaults</button></div>
    </div>
    <div class="card pad mt danger">
      <div class="row between wrap gap"><div><b>Reset demo data</b><div class="small muted">Clears every run and puts the payment ledger and rules back to their starting state.</div></div><button class="btn bad ghost" onClick=${reset}><${Icon} n="refresh" s=${14} /> Reset</button></div>
    </div>
  </div>`;
}

// ---------- reference data ----------
function Data({ meta, tab = 'pos' }) {
  const vendorName = (id) => meta.vendors.find((v) => v.id === id)?.name || id;
  const billed = (po) => meta.ledger.filter((l) => l.po === po).reduce((s, l) => s + l.subtotal, 0);
  const value = (p) => p.lines.reduce((s, l) => s + (l.amount ?? l.qty * l.unitPrice), 0);
  const tabs = [['pos', 'Purchase orders'], ['vendors', 'Vendors'], ['grn', 'Goods receipts'], ['ledger', 'Payment ledger']];
  return html`<div class="page">
    <header class="page-h"><div><h1>Reference data</h1><p class="muted">The procurement side every invoice is checked against. (In production this would come from the ERP.)</p></div></header>
    <div class="card">
      <div class="tabs">${tabs.map(([k, l]) => html`<a href=${'#/data?tab=' + k} class=${tab === k ? 'on' : ''}>${l}</a>`)}</div>
      <div class="tbl-wrap">
      ${tab === 'pos' && html`<table class="tbl"><thead><tr><th>PO</th><th>Vendor</th><th>Type</th><th>Lines</th><th class="r">Value</th><th style="width:22%">Billed so far</th></tr></thead><tbody>
        ${meta.purchaseOrders.map((p) => { const v = value(p), b = billed(p.po); return html`<tr><td><b>${p.po}</b><div class="small muted">${p.title}</div></td><td>${vendorName(p.vendorId)}</td><td><span class="tag">${p.type === 'goods' ? 'Goods · 3-way' : 'Services · 2-way'}</span></td>
          <td class="small">${p.lines.map((l) => html`<div>${l.description} — ${l.unitPrice != null ? `${l.qty} × ${inr(l.unitPrice)}` : inr(l.amount)}</div>`)}</td><td class="r num">${inr(v)}</td>
          <td><div class="bar"><i style=${`width:${Math.min(100, (b / v) * 100)}%`}></i></div><div class="small muted">${inr(b)} · ${Math.round((b / v) * 100)}%</div></td></tr>`; })}</tbody></table>`}
      ${tab === 'vendors' && html`<table class="tbl"><thead><tr><th>Vendor</th><th>GSTIN</th><th>State</th><th>Bank on file</th><th>Terms</th><th>Status</th></tr></thead><tbody>
        ${meta.vendors.map((v) => html`<tr><td><b>${v.name}</b><div class="small muted">${v.id} · ${v.email}</div></td><td class="mono">${v.gstin}</td><td>${v.state}</td><td>${v.bank}</td><td>Net ${v.terms}</td><td>${v.status === 'active' ? html`<span class="pill ok"><i></i>Active</span>` : html`<span class="pill bad" title=${v.blockReason}><i></i>Blocked</span>`}</td></tr>`)}</tbody></table>`}
      ${tab === 'grn' && html`<table class="tbl"><thead><tr><th>Goods receipt</th><th>PO</th><th>Date</th><th>Received</th></tr></thead><tbody>
        ${meta.goodsReceipts.map((g) => { const po = meta.purchaseOrders.find((p) => p.po === g.po); return html`<tr><td><b>${g.grn}</b></td><td>${g.po}</td><td>${fmtDate(g.date)}</td><td class="small">${g.lines.map((l) => html`<div>${l.qty} × ${po.lines.find((pl) => pl.line === l.line)?.description}</div>`)}</td></tr>`; })}
        <tr><td colspan="4" class="small muted">Service POs have no goods receipt — they are matched two-way (invoice vs PO).</td></tr></tbody></table>`}
      ${tab === 'ledger' && html`<table class="tbl"><thead><tr><th>Invoice</th><th>Vendor</th><th>PO</th><th>Date</th><th class="r">Pre-tax</th><th class="r">Total</th><th>Source</th></tr></thead><tbody>
        ${[...meta.ledger].reverse().map((l) => html`<tr><td><b>${l.invoiceNumber}</b></td><td>${vendorName(l.vendorId)}</td><td>${l.po}</td><td>${fmtDate(l.date)}</td><td class="r num">${inr(l.subtotal)}</td><td class="r num">${inr(l.total)}</td><td>${l.runId ? html`<a href=${'#/run/' + l.runId}>This tool · ${l.runId}</a>` : html`<span class="muted">${l.source}${l.paidOn ? ' · paid ' + fmtDate(l.paidOn) : ''}</span>`}</td></tr>`)}</tbody></table>`}
      </div>
    </div>
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
