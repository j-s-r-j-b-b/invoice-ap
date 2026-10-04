import { render } from 'preact';
import { useEffect, useState, useMemo } from 'preact/hooks';
import { html, Icon, Pill, Empty, toast } from './ui.js';
import { api, fileToBase64, inr, inrShort, fmtDate, fmtTime, ago } from './api.js';
import { RunView, startRun, live, useLiveTick, STAGES } from './run.js';

// ---------- routing ----------
const parse = () => {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  return { parts: path.split('/').filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || '')) };
};
const go = (h) => { location.hash = h; };
const OPEN = ['needs_approval', 'vendor_hold'];

function App() {
  const [route, setRoute] = useState(parse());
  const [meta, setMeta] = useState(null);
  const [metaErr, setMetaErr] = useState(null);
  const runs = useRuns();
  const loadMeta = () => api.meta().then(setMeta).catch((e) => setMetaErr(e.message));
  useEffect(() => { const f = () => { setRoute(parse()); window.scrollTo(0, 0); if (/^#\/(data|rules)/.test(location.hash)) loadMeta(); }; addEventListener('hashchange', f); loadMeta(); return () => removeEventListener('hashchange', f); }, []);
  const [p0, p1] = route.parts;
  const openCount = runs ? runs.filter((r) => OPEN.includes(r.decision.status)).length : 0;
  const newCount = meta && runs ? meta.inbox.filter((m) => !runs.some((r) => r.source?.inboxId === m.id)).length : 0;
  let page;
  if (metaErr) page = html`<div class="page"><div class="card pad bad-card">Can't reach the server: ${metaErr}</div></div>`;
  else if (!meta) page = html`<div class="page"><div class="skeleton tall"></div></div>`;
  else if (p0 === 'run' && p1) page = html`<${RunView} id=${p1} meta=${meta} />`;
  else if (p0 === 'inbox') page = html`<${Inbox} meta=${meta} runs=${runs} />`;
  else if (p0 === 'rules') page = html`<${Rules} meta=${meta} reload=${loadMeta} />`;
  else if (p0 === 'data') page = html`<${Data} meta=${meta} tab=${route.q.tab} />`;
  else page = html`<${Dashboard} runs=${runs} filter=${route.q.f || 'all'} />`;
  const nav = [['', 'grid', 'Dashboard'], ['inbox', 'mail', 'AP inbox', newCount], ['?f=open', 'inbox', 'Needs action', openCount], ['rules', 'sliders', 'Rules'], ['data', 'db', 'Reference data']];
  const active = (k) => k === '' ? !p0 && route.q.f !== 'open' : k.startsWith('?') ? !p0 && route.q.f === 'open' : p0 === k;
  return html`<div class="shell">
    <aside class="side">
      <a class="brand" href="#/"><span class="logo"><${Icon} n="check" s=${16} w=${3} /></span><span><b>Checkpoint</b><small>Accounts payable</small></span></a>
      <nav>${nav.map(([k, ic, label, n]) => html`<a href=${'#/' + k} class=${active(k) ? 'on' : ''}><${Icon} n=${ic} s=${17} /> <span>${label}</span>${n ? html`<em class="nav-n">${n}</em>` : ''}</a>`)}</nav>
      <div class="side-foot">
        <div class="small"><b>${meta?.company.name || ''}</b></div>
        <div class="small muted">GSTIN ${meta?.company.gstin || ''}</div>
        ${meta && html`<div class="env small"><span class=${'dot ' + (meta.env.extractor ? 'ok' : 'bad')}></span>${meta.env.extractor ? `Reading with ${{ claude: 'Claude', gemini: 'Gemini' }[meta.env.extractor] || 'test fixture (local)'}` : 'No AI key configured'}</div>
        <div class="env small"><span class=${'dot ' + (meta.env.store === 'redis' ? 'ok' : 'warn')}></span>${meta.env.store === 'redis' ? 'Cases saved to database' : meta.env.store === 'local-file' ? 'Cases saved locally' : 'Cases saved temporarily'}</div>`}
      </div>
    </aside>
    <main>${page}</main>
  </div>`;
}

function useRuns() {
  useLiveTick();
  const [runs, setRuns] = useState(null);
  const liveDone = Object.values(live).filter((l) => l.run).map((l) => l.id + l.run.version + l.run.decision.status).join();
  const [bump, setBump] = useState(0);
  useEffect(() => { api.runs().then(setRuns).catch((e) => toast(e.message, 'bad')); }, [liveDone, bump, location.hash]);
  return runs;
}

// ---------- dashboard ----------
function Dashboard({ runs, filter }) {
  const inFlight = Object.values(live).filter((l) => !l.run && !l.error);
  const k = useMemo(() => {
    if (!runs) return null;
    const by = (s) => runs.filter((r) => r.decision.status === s);
    const sum = (a) => a.reduce((s, r) => s + (r.total || 0), 0);
    const approved = by('approved');
    return {
      total: runs.length, value: sum(runs),
      approved: approved.length, approvedValue: sum(approved), auto: approved.filter((r) => !r.review).length,
      approval: by('needs_approval').length, hold: by('vendor_hold').length, rejected: by('rejected').length,
      kept: runs.filter((r) => r.decision.status !== 'approved').reduce((s, r) => s + (r.decision.atRisk || 0), 0),
    };
  }, [runs]);
  const shown = runs ? (filter === 'all' ? runs : filter === 'open' ? runs.filter((r) => OPEN.includes(r.decision.status)) : runs.filter((r) => r.decision.status === filter)) : [];
  const tabs = [['all', 'All', k?.total], ['open', 'Needs action', k && k.approval + k.hold], ['approved', 'Approved', k?.approved], ['rejected', 'Rejected', k?.rejected]];
  return html`<div class="page">
    <header class="page-h">
      <div><h1>${filter === 'open' ? 'Needs action' : 'Dashboard'}</h1><p class="muted">${filter === 'open' ? 'Cases the rules could not clear. Each says exactly what is wrong and who has to act — us, or the vendor.' : 'Every invoice received, what was decided, and why.'}</p></div>
      <a class="btn primary" href="#/inbox"><${Icon} n="mail" s=${16} /> Go to AP inbox</a>
    </header>

    ${filter !== 'open' && html`<div class="how card">
      <div class="how-l"><div class="eyebrow">How every invoice is handled</div><b>AI reads. Rules decide. People handle exceptions.</b><p class="small muted">The AI only copies what is printed on the invoice. Every decision comes from rules you can see and change on the Rules page.</p></div>
      <ol class="how-steps">${STAGES.map((s, i) => html`<li><span>${i + 1}</span>${s.title}</li>`)}</ol>
    </div>`}

    ${k && filter !== 'open' && html`<div class="kpis">
      <div class="kpi"><small>Invoices received</small><b>${k.total}</b><span class="muted">${inrShort(k.value)} billed</span></div>
      <div class="kpi"><small>Approved for payment</small><b class=${k.approved ? 'ok-t' : ''}>${k.approved}</b><span class="muted">${inrShort(k.approvedValue)} · ${k.auto} with no human touch</span></div>
      <a class="kpi click" href="#/?f=open"><small>Needs action</small><b class=${k.approval + k.hold ? 'warn-t' : ''}>${k.approval + k.hold}</b><span class="muted">${k.approval} to approve · ${k.hold} waiting on vendor</span></a>
      <div class="kpi"><small>Rejected</small><b class=${k.rejected ? 'bad-t' : ''}>${k.rejected}</b><span class="muted">Not payable as sent</span></div>
      <div class="kpi accent"><small>Kept from being paid</small><b>${inrShort(k.kept)}</b><span class="muted">Duplicates, overcharges, overbilling</span></div>
    </div>`}

    <div class="card">
      <div class="tabs">${tabs.map(([key, label, n]) => html`<a href=${key === 'all' ? '#/' : '#/?f=' + key} class=${filter === key ? 'on' : ''}>${label}${n != null && html`<span class="count">${n}</span>`}</a>`)}</div>
      ${inFlight.map((l) => html`<a class="row-run live" href=${'#/run/' + l.id}><span class="spin"></span><b>${l.filename || l.id}</b><span class="muted">${l.recheck ? 'Re-checking' : 'Processing'} · ${STAGES.find((s) => s.id === l.running)?.title || ''}</span></a>`)}
      ${!runs ? html`<div class="pad"><div class="skeleton"></div></div>`
        : !shown.length ? html`<${Empty} title=${filter === 'open' ? 'Nothing needs action' : 'No invoices processed yet'}>${filter === 'open' ? 'Every case is closed.' : html`Open the <a href="#/inbox">AP inbox</a> and process the vendor emails waiting there, or upload an invoice.`}<//>`
        : html`<div class="tbl-wrap"><table class="tbl runs">
          <thead><tr><th>Invoice</th><th>Vendor</th><th>PO</th><th class="r">Amount</th><th>Decision</th><th>Why</th><th></th></tr></thead>
          <tbody>${shown.map((r) => html`<tr onClick=${() => go('/run/' + r.id)}>
            <td><b>${r.invoiceNumber || html`<span class="muted">no number</span>`}</b><div class="small muted">${r.id} · ${ago(r.createdAt)}</div></td>
            <td>${r.vendorName}</td>
            <td>${r.po || '—'}${r.poInferred ? html` <span class="tag">inferred</span>` : ''}</td>
            <td class="r num">${inr(r.total)}</td>
            <td><${Pill} status=${r.decision.status} label=${r.decision.label} />${r.vendorQuery && r.decision.status === 'vendor_hold' ? html`<div class="small muted">query sent ${ago(r.vendorQuery.at)}</div>` : ''}</td>
            <td class="reason">${r.decision.status === 'approved' && !r.review ? html`<span class="muted">All checks passed</span>` : r.review ? html`<span class="muted">${r.review.who}: “${r.review.note}”</span>` : r.decision.headline}</td>
            <td class="r"><${Icon} n="arrow" s=${15} cls="muted" /></td>
          </tr>`)}</tbody></table></div>`}
    </div>
  </div>`;
}

// ---------- AP inbox ----------
function Inbox({ meta, runs }) {
  useLiveTick();
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(null);
  const caseFor = (m) => runs?.find((r) => r.source?.inboxId === m.id);
  const liveFor = (m) => Object.values(live).find((l) => l.inboxId === m.id && !l.run && !l.error);
  const fresh = meta.inbox.filter((m) => !caseFor(m) && !liveFor(m));

  const processItem = async (m, navigate = true) => {
    const blob = await fetch('/samples/' + m.file).then((r) => r.blob());
    const id = await startRun({ base64: await fileToBase64(blob), mimeType: 'application/pdf', filename: m.file, inboxId: m.id }, { filename: m.file, fileUrl: '/samples/' + m.file });
    if (id) live[id].inboxId = m.id;
    if (id && navigate) go('/run/' + id);
    return id;
  };
  const processAll = async () => {
    setBusy('all');
    for (const m of fresh) {
      const id = await processItem(m, false);
      if (!id) break;
      await new Promise((res) => { const t = setInterval(() => { if (live[id].run || live[id].error) { clearInterval(t); res(); } }, 300); });
    }
    setBusy(null); go('/');
  };
  const upload = async (file) => {
    if (!file) return;
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast('Please choose a PDF or an image (PNG / JPG).', 'bad');
    if (file.size > 3.2 * 1024 * 1024) return toast('File is over 3 MB — please compress it first.', 'bad');
    setBusy('upload');
    const id = await startRun({ base64: await fileToBase64(file), mimeType: file.type, filename: file.name }, { filename: file.name, fileUrl: URL.createObjectURL(file) });
    setBusy(null);
    if (id) go('/run/' + id);
  };

  return html`<div class="page" onDragOver=${(e) => { e.preventDefault(); setDrag(true); }} onDragLeave=${(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }} onDrop=${(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}>
    <header class="page-h">
      <div><h1>AP inbox</h1><p class="muted">Vendors email invoices to <b>ap@meridianretail.example</b>. Each email's attachment becomes a case. You can also upload any invoice — PDF, scan or photo.</p></div>
      <div class="row gap wrap">
        <label class="btn"><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange=${(e) => upload(e.target.files[0])} />${busy === 'upload' ? html`<span class="spin"></span> Uploading…` : html`<${Icon} n="upload" s=${15} /> Upload invoice`}</label>
        ${fresh.length > 0 && html`<button class="btn primary" disabled=${!!busy} onClick=${processAll}>${busy === 'all' ? html`<span class="spin"></span> Processing…` : html`<${Icon} n="play" s=${14} /> Process ${fresh.length} new`}</button>`}
      </div>
    </header>
    ${drag && html`<div class="dropmask"><div><${Icon} n="upload" s=${28} /><b>Drop to process this invoice</b></div></div>`}
    <div class="card mail">
      ${meta.inbox.map((m) => {
        const c = caseFor(m), l = liveFor(m);
        return html`<div class=${'mail-row ' + (c || l ? 'done' : 'new')}>
          <div class="avatar">${m.fromName[0]}</div>
          <div class="mail-main">
            <div class="row gap"><b>${m.fromName}</b><span class="small muted">${m.from}</span><span class="grow"></span><time class="small muted">${fmtTime(m.receivedAt)}</time></div>
            <div class="subj">${m.subject}</div>
            <div class="small muted snippet">${m.body}</div>
            <a class="attach" href=${'/samples/' + m.file} target="_blank" rel="noopener"><${Icon} n="file" s=${14} /> ${m.file}</a>
          </div>
          <div class="mail-act">
            ${l ? html`<a class="btn sm ghost" href=${'#/run/' + l.id}><span class="spin"></span> ${STAGES.find((s) => s.id === l.running)?.title || 'Processing'}</a>`
              : c ? html`<${Pill} status=${c.decision.status} label=${c.decision.label} /><a class="link small" href=${'#/run/' + c.id}>Open case ${c.id} →</a>`
              : html`<button class="btn primary sm" disabled=${!!busy} onClick=${() => processItem(m)}><${Icon} n="play" s=${13} /> Process</button>`}
          </div>
        </div>`;
      })}
    </div>
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
  const save = async () => { setSaving(true); try { await api.saveRules(r); await reload(); toast('Rules saved — applied to new invoices and to any case you re-check'); } catch (e) { toast(e.message, 'bad'); } setSaving(false); };
  const reset = async () => { if (!confirm('Delete all cases and restore the inbox, ledger and rules?')) return; await api.reset(); Object.keys(live).forEach((k) => delete live[k]); await reload(); setR({ ...meta.defaultRules }); toast('Demo data reset'); go('/'); };
  return html`<div class="page narrow">
    <header class="page-h"><div><h1>Rules</h1><p class="muted">The policy the process applies after the AI has read an invoice. Change a number, then open a held case and press “Re-check with current rules” — the same invoice is re-decided. No code, no retraining.</p></div></header>
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
      <div class="row between wrap gap"><div><b>Reset demo data</b><div class="small muted">Deletes every case, marks all inbox emails as unprocessed, and puts the payment ledger and rules back to their starting state.</div></div><button class="btn bad ghost" onClick=${reset}><${Icon} n="refresh" s=${14} /> Reset</button></div>
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
