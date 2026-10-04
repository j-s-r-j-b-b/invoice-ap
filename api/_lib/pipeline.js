// The invoice pipeline. Each stage is a plain function that returns checks:
//   pass  – fine            info – worth knowing, no action
//   warn  – needs a human   block – cannot be paid as-is
// The decision is mechanical: any block → rejected, any warn → needs review, else approved.
import crypto from 'node:crypto';
import { COMPANY, VENDORS, PURCHASE_ORDERS, GOODS_RECEIPTS } from './seed.js';
import { extract, extractorKind } from './extract.js';
import { sampleById, cachedExtraction } from './samples.js';

// ---------- helpers ----------
const r2 = (n) => Math.round(n * 100) / 100;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
export const inr = (n) => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const pct = (n) => (n > 0 ? '+' : '') + n.toFixed(1) + '%';
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const STOP = new Set(['pvt', 'ltd', 'private', 'limited', 'llp', 'inc', 'co', 'the', 'and', 'of', 'for', 'per', 'to', 'a', 'an', 'in', 'with', 'services', 'service']);

export const normName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).join(' ');
export function normInvNo(s) {
  if (!s) return '';
  let x = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  x = x.replace(/(\d)(REV\d*|R\d|[A-Z])$/, '$1');      // INV1042A, 1042REV2 → revision suffix dropped
  x = x.replace(/^INV(?=\d)/, '');                      // INV1042 → 1042
  return /^\d+$/.test(x) ? String(Number(x)) : x;
}
const tokens = (s) => new Set((s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)));
function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0; A.forEach((t) => B.has(t) && n++);
  return (2 * n) / (A.size + B.size);
}
const daysBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
const poValue = (po) => po.lines.reduce((s, l) => s + (l.amount ?? l.qty * l.unitPrice), 0);
const vendorOf = (id) => VENDORS.find((v) => v.id === id);
const poDigits = (s) => (s || '').replace(/\D/g, '');

function stageResult(checks, summary, details = {}) {
  const status = checks.some((c) => c.level === 'block') ? 'fail' : checks.some((c) => c.level === 'warn') ? 'warn' : 'pass';
  return { status, summary, checks, details };
}

// ---------- stages ----------
async function intake(ctx) {
  const buf = Buffer.from(ctx.input.base64, 'base64');
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  let format = ctx.input.mimeType.startsWith('image/') ? 'Image file' : 'PDF';
  if (ctx.input.mimeType === 'application/pdf') {
    const raw = buf.toString('latin1');
    const hasText = /\/Font\b/.test(raw);
    const hasImage = /\/Subtype\s*\/Image/.test(raw);
    format = hasText ? 'PDF with a text layer' : hasImage ? 'Image-only PDF (scanned)' : 'PDF';
  }
  ctx.hash = hash;
  ctx.format = format;
  const checks = [{ level: 'pass', code: 'received', msg: `${ctx.input.filename} · ${(buf.length / 1024).toFixed(0)} KB · ${format}` }];
  if (format.includes('scanned') || format === 'Image file') checks.push({ level: 'info', code: 'scanned', msg: 'No machine-readable text — the AI will read it visually (like OCR).' });
  return stageResult(checks, format, { filename: ctx.input.filename, sizeKB: Math.round(buf.length / 1024), sha256: hash.slice(0, 16) + '…', format });
}

async function read(ctx) {
  const sample = ctx.input.sampleId && sampleById(ctx.input.sampleId);
  const checks = [];
  let data, source;
  const wantCache = ctx.input.mode === 'cached' || !extractorKind();
  if (sample && wantCache) {
    data = cachedExtraction(sample); source = 'Stored reading (offline demo mode)';
    checks.push({ level: 'info', code: 'cached', msg: extractorKind() ? 'Offline demo mode: used the stored AI reading for this sample.' : 'No AI key configured: used the stored AI reading for this sample.' });
  } else {
    try {
      const t = Date.now();
      const out = await extract(ctx.input);
      data = out.data; source = `${out.model} · ${((Date.now() - t) / 1000).toFixed(1)}s`;
    } catch (e) {
      if (!sample) {
        checks.push({ level: 'block', code: 'unreadable', msg: `Could not read this document (${e.message}). Route to manual data entry.` });
        return stageResult(checks, 'Could not read document', { error: e.message });
      }
      data = cachedExtraction(sample); source = 'Stored reading (AI call failed)';
      checks.push({ level: 'info', code: 'fallback', msg: `AI call failed (${e.message}) — fell back to the stored reading for this sample.` });
    }
  }
  ctx.x = data;
  const n = (data.line_items || []).length;
  checks.unshift({ level: 'pass', code: 'extracted', msg: `Read ${n} line item${n === 1 ? '' : 's'}, total ${inr(data.total)}${data.document_quality !== 'clean' ? ` (${data.document_quality} document)` : ''}.` });
  (data.observations || []).forEach((o) => checks.push({ level: 'info', code: 'observation', msg: 'AI noticed: ' + o }));
  return stageResult(checks, `${data.vendor_name || 'Unknown vendor'} · ${data.invoice_number || 'no invoice no.'} · ${inr(data.total)}`, { source, fields: data });
}

async function validate(ctx) {
  const x = ctx.x, R = ctx.rules, tol = R.amountMatchTolerance, checks = [];
  // completeness
  if (!x.invoice_number) checks.push({ level: 'block', code: 'no_invoice_no', msg: 'No invoice number — this is not a valid tax invoice and cannot be booked.', vendorAsk: 'Please issue a proper GST tax invoice with a unique invoice number.' });
  if (!x.vendor_name) checks.push({ level: 'warn', code: 'no_vendor', msg: 'Vendor name is missing.' });
  if (x.total == null) checks.push({ level: 'block', code: 'no_total', msg: 'No invoice total could be found.', vendorAsk: 'The invoice total is missing or illegible — please resend a clear copy.' });
  if (!x.invoice_date) checks.push({ level: 'warn', code: 'no_date', msg: 'Invoice date is missing.', vendorAsk: 'Please add the invoice date.' });
  // arithmetic
  (x.line_items || []).forEach((l, i) => {
    if (l.quantity != null && l.unit_price != null && l.amount != null && !near(r2(l.quantity * l.unit_price), l.amount, tol))
      checks.push({ level: 'warn', code: 'line_math', msg: `Line ${i + 1}: ${l.quantity} × ${inr(l.unit_price)} = ${inr(r2(l.quantity * l.unit_price))}, but invoice shows ${inr(l.amount)}.`, vendorAsk: `Line ${i + 1} amount does not equal quantity × rate.` });
  });
  const lineSum = r2((x.line_items || []).reduce((s, l) => s + (l.amount || 0), 0));
  let subtotal = x.subtotal;
  if (x.amounts_tax_inclusive && subtotal == null && x.total != null) {
    subtotal = r2(x.total / 1.18);
    checks.push({ level: 'warn', code: 'tax_inclusive', msg: `Tax is buried inside the total — no GST shown. Pre-tax value estimated at ${inr(subtotal)} (assuming 18% GST); input tax credit can't be claimed on this document.`, vendorAsk: 'GST must be shown separately (taxable value, rate and tax amount) so we can claim input tax credit.' });
  } else if (subtotal == null) {
    subtotal = lineSum;
    checks.push({ level: 'info', code: 'derived_subtotal', msg: `No subtotal printed; using sum of lines ${inr(lineSum)}.` });
  } else if (!near(lineSum, subtotal, tol)) {
    checks.push({ level: 'warn', code: 'subtotal_math', msg: `Line items add up to ${inr(lineSum)}, but subtotal says ${inr(subtotal)}.`, vendorAsk: `Line items total ${inr(lineSum)} but the subtotal shows ${inr(subtotal)}.` });
  }
  ctx.subtotal = subtotal;
  const taxSum = r2((x.tax_lines || []).reduce((s, t) => s + (t.amount || 0), 0));
  if (!x.amounts_tax_inclusive && x.total != null && x.subtotal != null) {
    if (!near(r2(x.subtotal + taxSum), x.total, tol))
      checks.push({ level: 'warn', code: 'total_math', msg: `Subtotal ${inr(x.subtotal)} + tax ${inr(taxSum)} = ${inr(r2(x.subtotal + taxSum))}, but total says ${inr(x.total)}.`, vendorAsk: 'Subtotal plus tax does not equal the invoice total.' });
    (x.tax_lines || []).forEach((t) => {
      if (t.rate_pct != null && t.amount != null && !near(r2((x.subtotal * t.rate_pct) / 100), t.amount, tol))
        checks.push({ level: 'warn', code: 'tax_math', msg: `${t.label} at ${t.rate_pct}% of ${inr(x.subtotal)} should be ${inr(r2((x.subtotal * t.rate_pct) / 100))}, invoice shows ${inr(t.amount)}.`, vendorAsk: `${t.label} amount is miscalculated.` });
    });
  }
  // GST type: same state → CGST+SGST, different state → IGST
  if (x.vendor_gstin && GSTIN_RE.test(x.vendor_gstin) && (x.tax_lines || []).length) {
    const intra = x.vendor_gstin.slice(0, 2) === COMPANY.gstin.slice(0, 2);
    const labels = x.tax_lines.map((t) => (t.label || '').toUpperCase());
    const hasIGST = labels.some((l) => l.includes('IGST'));
    const hasCS = labels.some((l) => l.includes('CGST')) && labels.some((l) => l.includes('SGST'));
    if (intra && hasIGST) checks.push({ level: 'warn', code: 'gst_type', msg: 'Vendor and buyer are in the same state, so CGST+SGST is expected — invoice charges IGST.', vendorAsk: 'Intra-state supply: please charge CGST + SGST instead of IGST.' });
    else if (!intra && hasCS) checks.push({ level: 'warn', code: 'gst_type', msg: 'Inter-state supply, so IGST is expected — invoice charges CGST+SGST.', vendorAsk: 'Inter-state supply: please charge IGST instead of CGST + SGST.' });
    else checks.push({ level: 'pass', code: 'gst_type', msg: `${intra ? 'Intra-state → CGST + SGST' : 'Inter-state → IGST'} applied correctly.` });
  }
  if (x.buyer_gstin && x.buyer_gstin !== COMPANY.gstin) checks.push({ level: 'warn', code: 'buyer_gstin', msg: `Billed to GSTIN ${x.buyer_gstin}, not ours (${COMPANY.gstin}).`, vendorAsk: `Please bill to our GSTIN ${COMPANY.gstin}.` });
  if (!x.buyer_gstin) checks.push({ level: 'warn', code: 'buyer_gstin_missing', msg: 'Our GSTIN is not on the invoice — input tax credit cannot be claimed.', vendorAsk: `Please include our GSTIN ${COMPANY.gstin} on the invoice.` });
  // dates
  if (x.invoice_date) {
    const age = daysBetween(ctx.today, x.invoice_date);
    if (age < 0) checks.push({ level: 'warn', code: 'future_date', msg: `Invoice is dated in the future (${x.invoice_date}).`, vendorAsk: 'The invoice date is in the future.' });
    else if (age > R.maxInvoiceAgeDays) checks.push({ level: 'warn', code: 'stale', msg: `Invoice is ${age} days old (limit ${R.maxInvoiceAgeDays}).` });
    if (x.due_date && x.due_date < x.invoice_date) checks.push({ level: 'warn', code: 'due_before', msg: 'Due date is before the invoice date.' });
  }
  // AI confidence
  Object.entries(x.confidence || {}).forEach(([k, v]) => {
    if (v < R.minConfidence) checks.push({ level: 'warn', code: 'low_conf', msg: `AI is only ${Math.round(v * 100)}% sure about “${k.replace('_', ' ')}” — a person should verify it against the document.` });
  });
  if (!checks.some((c) => c.level !== 'pass' && c.level !== 'info')) checks.unshift({ level: 'pass', code: 'complete', msg: 'All required fields present; line items, tax and total add up.' });
  return stageResult(checks, checks.some((c) => c.level === 'block' || c.level === 'warn') ? `${checks.filter((c) => c.level === 'warn' || c.level === 'block').length} problem(s) found` : 'Complete and arithmetically correct', { lineSum, subtotal, taxSum });
}

async function verifyVendor(ctx) {
  const x = ctx.x, checks = [];
  const gst = (x.vendor_gstin || '').toUpperCase().replace(/\s/g, '');
  const validGst = GSTIN_RE.test(gst);
  let v = validGst ? VENDORS.find((vv) => vv.gstin === gst) : null;
  let by = v ? 'GSTIN' : null;
  if (!v && x.vendor_name) {
    const n = normName(x.vendor_name);
    v = VENDORS.find((vv) => normName(vv.name) === n) || VENDORS.find((vv) => { const m = normName(vv.name); return n && (m.includes(n) || n.includes(m)); });
    if (v) by = 'name';
  }
  if (gst && !validGst) checks.push({ level: 'warn', code: 'gstin_format', msg: `GSTIN “${x.vendor_gstin}” is not a valid 15-character GSTIN.`, vendorAsk: `The GSTIN printed (${x.vendor_gstin}) is invalid — please confirm your GST registration number.` });
  if (!v) {
    checks.push({ level: 'warn', code: 'unknown_vendor', msg: `“${x.vendor_name || 'Unknown'}” is not in the vendor master — they must be onboarded (KYC, bank verification) before any payment.`, vendorAsk: 'You are not yet a registered vendor with us. Please complete onboarding: PAN, GST certificate, and a cancelled cheque for bank verification.' });
    ctx.vendor = null;
    return stageResult(checks, 'Vendor not found in vendor master', { matchedBy: null });
  }
  ctx.vendor = v;
  checks.unshift({ level: 'pass', code: 'vendor_found', msg: `Matched ${v.name} (${v.id}) by ${by}.` });
  if (by === 'name' && validGst && gst !== v.gstin) checks.push({ level: 'warn', code: 'gstin_mismatch', msg: `GSTIN on invoice (${gst}) differs from vendor master (${v.gstin}) — possible impersonation or wrong entity. Verify before paying.` });
  if (v.status === 'blocked') checks.push({ level: 'block', code: 'vendor_blocked', msg: `Vendor is blocked: ${v.blockReason}.` });
  else checks.push({ level: 'pass', code: 'vendor_active', msg: `Active vendor · ${v.bank} · Net ${v.terms}.` });
  return stageResult(checks, `${v.name} · ${v.status}`, { vendor: v, matchedBy: by });
}

function ledgerFor(ctx, po) { return ctx.ledger.filter((l) => l.po === po); }

async function findPO(ctx) {
  const x = ctx.x, R = ctx.rules, checks = [];
  ctx.po = null; ctx.poInferred = false;
  if (x.po_reference) {
    const d = poDigits(x.po_reference);
    const po = PURCHASE_ORDERS.find((p) => poDigits(p.po) === d);
    if (!po) {
      checks.push({ level: 'warn', code: 'po_not_found', msg: `Invoice quotes ${x.po_reference}, which does not exist in the PO register.`, vendorAsk: `The PO number quoted (${x.po_reference}) does not match our records — please confirm the correct PO.` });
      return stageResult(checks, `${x.po_reference} not found`);
    }
    ctx.po = po;
    checks.push({ level: 'pass', code: 'po_found', msg: `${po.po} quoted on invoice — “${po.title}”, ${inr(poValue(po))}, ${po.type === 'goods' ? 'goods (3-way match)' : 'services (2-way match)'}.` });
    if (ctx.vendor && po.vendorId !== ctx.vendor.id) checks.push({ level: 'warn', code: 'po_other_vendor', msg: `${po.po} belongs to ${vendorOf(po.vendorId).name}, not ${ctx.vendor.name}.` });
    if (po.status !== 'open') checks.push({ level: 'warn', code: 'po_closed', msg: `${po.po} is ${po.status}.` });
    return stageResult(checks, `${po.po} (quoted on invoice)`, { po, inferred: false });
  }
  if (!ctx.vendor) {
    checks.push({ level: 'warn', code: 'no_po', msg: 'No PO on the invoice and vendor unknown — treat as a non-PO spend that needs budget-owner approval.' });
    return stageResult(checks, 'No PO — non-PO spend');
  }
  // infer: score every open PO of this vendor
  const cands = PURCHASE_ORDERS.filter((p) => p.vendorId === ctx.vendor.id && p.status === 'open').map((po) => {
    const descs = (x.line_items || []).map((l) => Math.max(0, ...po.lines.map((pl) => similarity(l.description, pl.description))));
    const desc = descs.length ? descs.reduce((a, b) => a + b, 0) / descs.length : 0;
    const before = ledgerFor(ctx, po.po).reduce((s, l) => s + l.subtotal, 0);
    const remaining = poValue(po) - before;
    const fits = ctx.subtotal <= remaining * (1 + R.poOverrunTolerancePct / 100);
    const recurring = ledgerFor(ctx, po.po).some((l) => near(l.subtotal, ctx.subtotal, 1));
    const score = Math.min(0.97, 0.15 + 0.5 * desc + (fits ? 0.2 : 0.05) + (recurring ? 0.15 : 0));
    return { po: po.po, title: po.title, score: r2(score), desc: r2(desc), fits, recurring, remaining };
  }).sort((a, b) => b.score - a.score);
  const best = cands[0];
  if (!best || best.score < 0.6) {
    checks.push({ level: 'warn', code: 'no_po', msg: `No PO on the invoice and none of ${ctx.vendor.name}'s open POs is a convincing match.`, vendorAsk: 'Please quote our purchase order number on the invoice.' });
    return stageResult(checks, 'No matching PO', { candidates: cands });
  }
  ctx.po = PURCHASE_ORDERS.find((p) => p.po === best.po); ctx.poInferred = true;
  const why = [best.desc >= 0.4 && 'line descriptions match', best.fits && 'amount fits remaining balance', best.recurring && 'same amount as previous monthly invoices'].filter(Boolean).join(', ');
  const auto = R.allowInferredPoAutoApprove && best.score >= 0.9;
  checks.push({ level: auto ? 'info' : 'warn', code: 'po_inferred', msg: `No PO printed. Best match is ${best.po} at ${Math.round(best.score * 100)}% confidence (${why}). ${auto ? 'Auto-accepted per rules.' : 'A person must confirm before payment.'}`, internal: true });
  return stageResult(checks, `${best.po} inferred · ${Math.round(best.score * 100)}%`, { po: ctx.po, inferred: true, candidates: cands });
}

async function match(ctx) {
  const x = ctx.x, R = ctx.rules, po = ctx.po, checks = [];
  if (!po) return { status: 'skip', summary: 'Nothing to match against', checks: [{ level: 'info', code: 'skip', msg: 'No purchase order, so no PO / receipt matching was possible.' }], details: {} };
  const grn = GOODS_RECEIPTS.filter((g) => g.po === po.po);
  const prior = ledgerFor(ctx, po.po);
  const rows = [];
  (x.line_items || []).forEach((l, i) => {
    const scored = po.lines.map((pl) => ({ pl, s: similarity(l.description, pl.description) })).sort((a, b) => b.s - a.s);
    const best = scored[0];
    if (!best || best.s < 0.35) {
      rows.push({ inv: l, po: null });
      checks.push({ level: 'warn', code: 'line_not_on_po', msg: `Line ${i + 1} “${l.description}” is not on ${po.po}.`, vendorAsk: `“${l.description}” was not part of ${po.po}.` });
      return;
    }
    const pl = best.pl, row = { inv: l, po: pl };
    // price
    if (pl.unitPrice != null && l.unit_price != null) {
      const v = ((l.unit_price - pl.unitPrice) / pl.unitPrice) * 100;
      row.variancePct = r2(v);
      const impact = r2((l.unit_price - pl.unitPrice) * (l.quantity || 0));
      if (v > R.priceTolerancePct + 1e-9) checks.push({ level: 'warn', code: 'price_variance', atRisk: impact, msg: `${pl.description}: billed ${inr(l.unit_price)} vs PO ${inr(pl.unitPrice)} (${pct(v)}) — over the ${R.priceTolerancePct}% tolerance. Overcharge ${inr(impact)}.`, vendorAsk: `${pl.description} is billed at ${inr(l.unit_price)} against the agreed PO rate of ${inr(pl.unitPrice)} (${pct(v)}). Please issue a credit note for ${inr(impact)} or a revised invoice.` });
      else if (v > 0.001) checks.push({ level: 'info', code: 'price_within', msg: `${pl.description}: ${pct(v)} above PO price — within the ${R.priceTolerancePct}% tolerance (${inr(impact)}), accepted.` });
      else if (v < -0.001) checks.push({ level: 'info', code: 'price_below', msg: `${pl.description}: billed below PO price (${pct(v)}).` });
      else checks.push({ level: 'pass', code: 'price_ok', msg: `${pl.description}: price matches PO (${inr(pl.unitPrice)}).` });
    }
    // quantity vs received / ordered
    const billedBefore = prior.flatMap((p) => p.lines || []).filter((pl2) => pl2.poLine === pl.line).reduce((s, q) => s + q.qty, 0);
    row.billedBefore = billedBefore;
    if (po.type === 'goods') {
      const received = grn.flatMap((g) => g.lines).filter((gl) => gl.line === pl.line).reduce((s, g) => s + g.qty, 0);
      row.received = received;
      if (!grn.length) { /* reported once below */ }
      else if (billedBefore + (l.quantity || 0) > received) checks.push({ level: 'warn', code: 'qty_over_received', msg: `${pl.description}: billing ${l.quantity} (+${billedBefore} earlier) but only ${received} received.`, vendorAsk: `${pl.description}: invoiced quantity exceeds what we received (${received}).` });
      else checks.push({ level: 'pass', code: 'qty_ok', msg: `${pl.description}: ${l.quantity} billed, ${received} received.` });
    } else if (pl.unitPrice != null && billedBefore + (l.quantity || 0) > pl.qty) {
      checks.push({ level: 'warn', code: 'qty_over_po', msg: `${pl.description}: ${billedBefore + l.quantity} billed in total vs ${pl.qty} on PO.` });
    }
    rows.push(row);
  });
  if (po.type === 'goods' && !grn.length) checks.push({ level: 'warn', code: 'no_grn', msg: `No goods receipt recorded for ${po.po} — confirm delivery with the warehouse before paying.` });
  if (po.type === 'goods' && grn.length) checks.push({ level: 'pass', code: 'grn', msg: `Goods receipt ${grn.map((g) => g.grn).join(', ')} found (${grn[0].date}).` });
  // cumulative billing against PO value
  const value = poValue(po), before = r2(prior.reduce((s, l) => s + l.subtotal, 0)), after = r2(before + ctx.subtotal), remaining = r2(value - before);
  const cumulative = { value, before, thisInvoice: ctx.subtotal, after, remaining, priorInvoices: prior.map((p) => ({ invoiceNumber: p.invoiceNumber, date: p.date, subtotal: p.subtotal })) };
  // Rate-card POs (every line has a unit price) are already policed line-by-line on price and
  // quantity, so a value overrun explained by accepted price tolerance shouldn't be flagged twice.
  const rateCard = po.lines.every((l) => l.unitPrice != null);
  const lineIssues = checks.some((c) => ['price_variance', 'qty_over_received', 'qty_over_po'].includes(c.code));
  const overrunTol = rateCard ? Math.max(R.poOverrunTolerancePct, R.priceTolerancePct) : R.poOverrunTolerancePct;
  if (after > value * (1 + overrunTol / 100) + 0.5 && !(rateCard && lineIssues)) {
    const over = r2(after - value);
    checks.push({ level: 'warn', code: 'po_overrun', atRisk: over, msg: `${po.po} is worth ${inr(value)}. ${prior.length} earlier invoice(s) already billed ${inr(before)}, leaving ${inr(remaining)}. This invoice (${inr(ctx.subtotal)}) takes the total to ${inr(after)} — ${inr(over)} (${pct((over / value) * 100)}) over the PO.`, vendorAsk: `${po.po} has ${inr(remaining)} remaining after earlier invoices ${prior.map((p) => p.invoiceNumber).join(', ')}. This invoice is ${inr(ctx.subtotal)}, exceeding the PO by ${inr(over)}. Please revise it to ${inr(remaining)} or share the approved change order.` });
  } else checks.push({ level: 'pass', code: 'po_balance', msg: `Billed to date incl. this invoice: ${inr(after)} of ${inr(value)} (${Math.round((after / value) * 100)}%).` });
  if (x.total > R.autoApproveLimit) checks.push({ level: 'warn', code: 'over_limit', msg: `Total ${inr(x.total)} is above the ${inr(R.autoApproveLimit)} auto-approval limit — needs a manager.` });
  const bad = checks.filter((c) => c.level === 'warn' || c.level === 'block').length;
  return stageResult(checks, bad ? `${bad} mismatch(es) vs ${po.po}` : `Matches ${po.po}${po.type === 'goods' ? ' and goods receipt' : ''}`, { po: po.po, type: po.type, rows, cumulative, grn: grn.map((g) => g.grn) });
}

async function duplicates(ctx) {
  const x = ctx.x, R = ctx.rules, checks = [];
  const vkey = ctx.vendor ? ctx.vendor.id : normName(x.vendor_name);
  const pool = [
    ...ctx.ledger.map((l) => ({ ...l, vkey: l.vendorId, where: l.source === 'ERP history' ? `ERP history (${l.status})` : `run ${l.runId}` })),
    ...ctx.runs.filter((r) => r.decision?.status === 'needs_review').map((r) => ({ vkey: r.vendorId || normName(r.vendorName), invoiceNumber: r.invoiceNumber, total: r.total, date: r.invoiceDate, where: `review queue (run ${r.id})`, runId: r.id })),
  ];
  const sameFile = ctx.runs.find((r) => r.source?.hash === ctx.hash);
  if (sameFile) checks.push({ level: 'block', code: 'dup_file', atRisk: x.total, msg: `This exact file was already processed in run ${sameFile.id} (${sameFile.decision?.label || 'earlier'}).`, ref: sameFile.id });
  const n = normInvNo(x.invoice_number);
  const numHit = n && pool.find((p) => p.vkey === vkey && normInvNo(p.invoiceNumber) === n);
  if (numHit) {
    const sameAmt = near(numHit.total, x.total, R.amountMatchTolerance);
    const exact = numHit.invoiceNumber === x.invoice_number;
    checks.push(sameAmt
      ? { level: 'block', code: 'dup_number', atRisk: x.total, msg: `${exact ? 'Same invoice number' : `“${x.invoice_number}” is a variant of “${numHit.invoiceNumber}”`} from the same vendor, same amount ${inr(x.total)} — already in ${numHit.where}${numHit.paidOn ? `, paid ${numHit.paidOn}` : ''}.`, vendorAsk: `This appears to be a duplicate of invoice ${numHit.invoiceNumber} dated ${numHit.date}, which ${numHit.paidOn ? `was paid on ${numHit.paidOn}` : 'has already been received'}. Please share the payment reference you see as outstanding if you believe otherwise.`, ref: numHit.runId }
      : { level: 'warn', code: 'dup_number_amount', msg: `Invoice number matches ${numHit.invoiceNumber} (${numHit.where}) but the amount differs (${inr(numHit.total)} → ${inr(x.total)}) — possibly a revised invoice. Confirm the earlier one is cancelled.`, vendorAsk: `Invoice ${x.invoice_number} resembles ${numHit.invoiceNumber} with a different amount. Is this a revision? If so, please confirm the original is cancelled.` });
  }
  if (!numHit && x.total != null) {
    const amtHit = pool.find((p) => p.vkey === vkey && near(p.total, x.total, R.amountMatchTolerance) && x.invoice_date && p.date && Math.abs(daysBetween(x.invoice_date, p.date)) <= R.duplicateWindowDays);
    if (amtHit) checks.push({ level: 'warn', code: 'dup_amount', msg: `Same vendor billed the same amount ${inr(x.total)} on ${amtHit.date} (${amtHit.invoiceNumber}, ${amtHit.where}) — within ${R.duplicateWindowDays} days. Possible duplicate.` });
  }
  if (!checks.length) checks.push({ level: 'pass', code: 'no_dup', msg: `No duplicates across ${pool.length} earlier invoices (number variants, amount + ${R.duplicateWindowDays}-day window, file fingerprint).` });
  const bad = checks.find((c) => c.level !== 'pass');
  return stageResult(checks, bad ? (bad.level === 'block' ? 'Duplicate found' : 'Possible duplicate') : 'No duplicates', { compared: pool.length });
}

// ---------- decision ----------
function decide(ctx, stages) {
  const all = stages.flatMap((s) => (s.checks || []).map((c) => ({ ...c, stage: s.id })));
  const blocks = all.filter((c) => c.level === 'block'), warns = all.filter((c) => c.level === 'warn');
  const x = ctx.x || {};
  const status = blocks.length ? 'rejected' : warns.length ? 'needs_review' : 'approved';
  const label = { approved: 'Approved', needs_review: 'Needs review', rejected: 'Rejected' }[status];
  const reasons = [...blocks, ...warns];
  let headline, nextAction;
  if (status === 'approved') {
    const due = x.due_date || (x.invoice_date && ctx.vendor ? new Date(new Date(x.invoice_date).getTime() + ctx.vendor.terms * 86400000).toISOString().slice(0, 10) : null);
    headline = `All checks passed — ${inr(x.total)} to ${ctx.vendor?.name}${ctx.po ? ` against ${ctx.po.po}` : ''}.`;
    nextAction = `Posted to the ledger and scheduled for payment${due ? ` on ${due}` : ''}.`;
  } else if (status === 'rejected') {
    headline = blocks[0].msg;
    nextAction = 'Do not pay. Returned to the vendor with the reasons below.';
  } else {
    headline = warns.length === 1 ? warns[0].msg : `${warns.length} issues need a person: ${[...new Set(warns.map((w) => w.code))].length > 1 ? warns.slice(0, 2).map((w) => w.msg.split(' — ')[0].split('. ')[0]).join('; ') : warns[0].msg}`;
    nextAction = `Held in the review queue${warns.some((w) => w.vendorAsk) ? '; vendor query drafted' : ''}.`;
  }
  const asks = reasons.filter((c) => c.vendorAsk);
  let email = null;
  if (asks.length) {
    const who = ctx.vendor?.name || x.vendor_name || 'Vendor';
    const ref = x.invoice_number ? `invoice ${x.invoice_number}` : `your bill dated ${x.invoice_date || '(undated)'} for ${inr(x.total)}`;
    email = {
      to: ctx.vendor?.email || '(no email on file — vendor not onboarded)',
      subject: `${status === 'rejected' ? 'Not processed' : 'On hold'}: ${x.invoice_number || 'your bill'} — action needed`,
      body: `Hello ${who} team,\n\nWe received ${ref}${ctx.po ? ` (${ctx.po.po})` : ''}. ${status === 'rejected' ? 'We are unable to process it' : 'It is on hold'} for the following reason${asks.length > 1 ? 's' : ''}:\n\n${asks.map((a, i) => `${i + 1}. ${a.vendorAsk}`).join('\n')}\n\nPlease reply to this email with the corrected document${asks.length > 1 ? 's' : ''} and we will process it promptly.\n\nRegards,\nAccounts Payable\n${COMPANY.name}`,
    };
  }
  const internal = warns.filter((w) => !w.vendorAsk).map((w) => w.msg);
  // money stopped before payment: the whole invoice if a duplicate, otherwise the overcharge
  const dup = reasons.find((c) => c.code === 'dup_file' || c.code === 'dup_number');
  const atRisk = dup ? dup.atRisk || 0 : r2(reasons.reduce((s, c) => s + (c.atRisk || 0), 0));
  return { status, label, headline, nextAction, reasons, email, internal, atRisk, counts: { block: blocks.length, warn: warns.length, info: all.filter((c) => c.level === 'info').length, pass: all.filter((c) => c.level === 'pass').length } };
}

export const STAGES = [
  { id: 'intake', title: 'Receive', sub: 'File type, fingerprint', fn: intake },
  { id: 'read', title: 'Read (AI)', sub: 'Extract fields + confidence', fn: read },
  { id: 'validate', title: 'Sanity check', sub: 'Completeness, maths, GST', fn: validate },
  { id: 'vendor', title: 'Verify vendor', sub: 'Vendor master, GSTIN', fn: verifyVendor },
  { id: 'po', title: 'Find PO', sub: 'Quoted or inferred', fn: findPO },
  { id: 'match', title: 'Match', sub: 'PO, receipt, balance', fn: match },
  { id: 'duplicate', title: 'Duplicate check', sub: 'Number, amount, file', fn: duplicates },
  { id: 'decide', title: 'Decision', sub: 'Rules → outcome', fn: null },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs the pipeline, calling emit(event) as each stage starts / finishes.
export async function runPipeline(ctx, emit) {
  const stages = [];
  for (const st of STAGES) {
    if (!st.fn) break;
    emit({ type: 'stage_start', id: st.id });
    const t = Date.now();
    let res;
    try { res = await st.fn(ctx); }
    catch (e) { res = { status: 'fail', summary: 'Stage crashed', checks: [{ level: 'block', code: 'error', msg: `Unexpected error in ${st.title}: ${e.message}` }], details: {} }; }
    const done = { id: st.id, title: st.title, ...res, ms: Date.now() - t };
    stages.push(done);
    if (st.id !== 'read') await sleep(280); // pacing so the live view is followable
    emit({ type: 'stage_done', stage: done });
    if (res.status === 'fail' && (st.id === 'read')) break; // nothing to check without data
  }
  emit({ type: 'stage_start', id: 'decide' });
  const decision = decide(ctx, stages);
  await sleep(350);
  const dstage = { id: 'decide', title: 'Decision', status: decision.status === 'approved' ? 'pass' : decision.status === 'rejected' ? 'fail' : 'warn', summary: decision.label, checks: [], details: {}, ms: 0 };
  stages.push(dstage);
  emit({ type: 'stage_done', stage: dstage });
  return { stages, decision };
}

export function ledgerEntryFromRun(run, ctxLike) {
  const rows = run.stages.find((s) => s.id === 'match')?.details?.rows || [];
  return {
    vendorId: run.vendorId, invoiceNumber: run.invoiceNumber, date: run.invoiceDate, po: run.po, subtotal: run.subtotal, total: run.total,
    status: 'approved', source: 'This tool', runId: run.id,
    lines: rows.filter((r) => r.po).map((r) => ({ poLine: r.po.line, qty: r.inv.quantity || 0, amount: r.inv.amount || 0 })),
  };
}
