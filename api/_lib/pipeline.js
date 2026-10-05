// The invoice pipeline. Each stage is a plain function that returns checks:
//   pass  – fine            info – worth knowing, no action
//   warn  – needs a human   block – cannot be paid as-is
// The decision is mechanical: any block → rejected, any warn → needs review, else approved.
import crypto from 'node:crypto';
import { COMPANY, VENDORS, PURCHASE_ORDERS, GOODS_RECEIPTS } from './seed.js';
import { extract, extractorKind } from './extract.js';

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
  if (ctx.previousRead) {
    ctx.hash = ctx.input.hash; ctx.format = ctx.input.format;
    return stageResult([{ level: 'pass', code: 'received', msg: `${ctx.input.filename} · ${ctx.format} · re-check of case ${ctx.caseId}` }], ctx.format, { filename: ctx.input.filename, format: ctx.format });
  }
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
  const checks = [];
  let data, source;
  if (ctx.previousRead) {
    // Re-check of an existing case: the document hasn't changed, so reuse what was read and re-apply the rules.
    data = ctx.previousRead.details.fields;
    source = ctx.previousRead.details.source + ' (re-used)';
    checks.push({ level: 'info', code: 'reused', msg: 'Same document as before — re-using the earlier reading and applying the current rules.' });
  } else {
    if (!extractorKind()) {
      checks.push({ level: 'block', code: 'unreadable', msg: 'No AI service is configured on the server, so the document could not be read. Route to manual data entry.' });
      return stageResult(checks, 'Could not read document', {});
    }
    try {
      const t = Date.now();
      const out = await extract(ctx.input);
      data = out.data; source = `${out.model} · ${((Date.now() - t) / 1000).toFixed(1)}s`;
    } catch (e) {
      checks.push({ level: 'block', code: 'unreadable', msg: `Could not read this document (${e.message}). Route to manual data entry.` });
      return stageResult(checks, 'Could not read document', { error: e.message });
    }
  }
  ctx.x = data;
  const assessment = assessReading(data, ctx);
  ctx.assessment = assessment;
  data.confidence_ai = data.confidence_ai || data.confidence;
  data.confidence = Object.fromEntries(Object.entries(assessment).map(([k, v]) => [k, v.score]));
  const n = (data.line_items || []).length;
  checks.unshift({ level: 'pass', code: 'extracted', msg: `Read ${n} line item${n === 1 ? '' : 's'}, total ${inr(data.total)}${data.document_quality !== 'clean' ? ` (${data.document_quality} document)` : ''}.` });
  (data.observations || []).forEach((o) => checks.push({ level: 'info', code: 'observation', msg: 'AI noticed: ' + o }));
  const verified = Object.values(assessment).filter((a) => a.kind === 'verified').length;
  const doubtful = Object.entries(assessment).filter(([, a]) => a.kind === 'contradiction');
  checks.push(doubtful.length
    ? { level: 'info', code: 'reading_doubt', msg: `Cross-checked the reading: ${verified} of ${Object.keys(assessment).length} key fields confirmed independently; doubt on ${doubtful.map(([k]) => FIELD_NAMES[k]).join(', ')}.` }
    : { level: 'pass', code: 'reading_verified', msg: `Cross-checked the reading: ${verified} of ${Object.keys(assessment).length} key fields confirmed independently (checksums, vendor master, PO register, arithmetic).` });
  return stageResult(checks, `${data.vendor_name || 'Unknown vendor'} · ${data.invoice_number || 'no invoice no.'} · ${inr(data.total)}`, { source, fields: data, assessment });
}

// ---------- how sure are we about the reading? ----------
// The model's self-reported confidence is close to useless (it says 100% for almost everything).
// So each key field is checked against independent evidence:
//   verified      – evidence confirms the value (checksum passes, matches master data, maths adds up)
//   contradiction – evidence says the value is probably misread → a person checks it
//   unverifiable  – nothing to check against → we fall back on the AI's own estimate, capped
export const FIELD_NAMES = { vendor_name: 'vendor name', vendor_gstin: 'vendor GSTIN', invoice_number: 'invoice number', invoice_date: 'invoice date', po_reference: 'PO reference', line_items: 'line items', total: 'total' };
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function gstinChecksumOk(g) {
  if (!GSTIN_RE.test(g || '')) return false;
  let s = 0;
  for (let i = 0; i < 14; i++) { const p = GST_CHARS.indexOf(g[i]) * (i % 2 ? 2 : 1); s += Math.floor(p / 36) + (p % 36); }
  return GST_CHARS[(36 - (s % 36)) % 36] === g[14];
}
function assessReading(x, ctx) {
  const ai = x.confidence_ai || x.confidence || {};
  const scanned = x.document_quality !== 'clean' || /scanned|Image/.test(ctx.format || '');
  const capAI = (k) => Math.min(ai[k] ?? 0.7, scanned ? 0.88 : 0.92); // never trust self-report fully
  const A = {};
  const set = (k, kind, score, basis) => { A[k] = { kind, score: r2(score), ai: ai[k] ?? null, basis }; };
  const tol = ctx.rules.amountMatchTolerance;
  const gst = (x.vendor_gstin || '').toUpperCase();
  const master = VENDORS.find((v) => v.gstin === gst);

  // GSTIN: the 15th character is a checksum of the first 14 — a single misread character breaks it.
  if (!gst) set('vendor_gstin', 'unverifiable', capAI('vendor_name'), 'No GSTIN printed');
  else if (gstinChecksumOk(gst)) set('vendor_gstin', 'verified', 0.99, master ? 'Checksum valid and on file in the vendor master' : 'GSTIN checksum is valid');
  else if (GSTIN_RE.test(gst)) set('vendor_gstin', 'contradiction', 0.35, 'Checksum fails — a character was probably misread (or the vendor printed it wrong)');
  else set('vendor_gstin', 'contradiction', 0.5, 'Not a valid 15-character GSTIN');

  // Vendor name: compare with the registered name for that GSTIN.
  if (master) {
    const same = normName(master.name) === normName(x.vendor_name);
    const close = similarity(master.name, x.vendor_name || '') >= 0.6;
    if (same) set('vendor_name', 'verified', 0.99, `Matches the registered name for ${master.gstin}`);
    else if (close) set('vendor_name', 'verified', 0.9, `Close to the registered name “${master.name}”`);
    else set('vendor_name', 'contradiction', 0.45, `Registered name for this GSTIN is “${master.name}”`);
  } else {
    const byName = VENDORS.find((v) => normName(v.name) === normName(x.vendor_name));
    if (byName) set('vendor_name', 'verified', 0.9, 'Matches a vendor in the master (by name)');
    else set('vendor_name', 'unverifiable', capAI('vendor_name'), 'Vendor not in our master — nothing to compare against');
  }

  // Invoice number: nothing external to check; sanity-check its shape.
  if (!x.invoice_number) set('invoice_number', 'unverifiable', capAI('invoice_number'), 'Not printed');
  else if (!/\d/.test(x.invoice_number) || x.invoice_number.length > 30) set('invoice_number', 'contradiction', 0.5, 'Does not look like an invoice number');
  else set('invoice_number', 'unverifiable', capAI('invoice_number'), scanned ? 'Read from a scan — cannot be cross-checked' : 'Cannot be cross-checked; format looks right');

  // Dates: valid, not in the future, due date after invoice date.
  const d = x.invoice_date;
  if (!d) set('invoice_date', 'unverifiable', capAI('invoice_date'), 'Not printed');
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(new Date(d).getTime())) set('invoice_date', 'contradiction', 0.4, 'Not a valid date');
  else if (x.due_date && x.due_date < d) set('invoice_date', 'contradiction', 0.6, 'Comes after the due date — one of them is probably misread');
  else if (daysBetween(ctx.today, d) < 0) set('invoice_date', 'contradiction', 0.6, 'In the future — possibly misread');
  else set('invoice_date', 'verified', Math.max(capAI('invoice_date'), 0.9), x.due_date ? 'Valid, in the past, and consistent with the due date' : 'Valid and in the past');

  // PO reference: does it exist in the register, for this vendor?
  if (!x.po_reference) set('po_reference', 'unverifiable', capAI('po_reference'), 'No PO printed');
  else {
    const po = PURCHASE_ORDERS.find((p) => poDigits(p.po) === poDigits(x.po_reference));
    if (po && (!master || po.vendorId === master.id)) set('po_reference', 'verified', 0.99, `${po.po} exists in the PO register${master ? ' for this vendor' : ''}`);
    else if (po) set('po_reference', 'contradiction', 0.5, `${po.po} exists but belongs to another vendor`);
    else set('po_reference', 'contradiction', 0.5, 'Not found in the PO register — possibly misread');
  }

  // Line items: every quantity × rate = amount, and they add up to the subtotal.
  const lines = x.line_items || [];
  const lineOk = lines.length > 0 && lines.every((l) => l.quantity == null || l.unit_price == null || l.amount == null || near(r2(l.quantity * l.unit_price), l.amount, tol));
  const lineSum = r2(lines.reduce((s, l) => s + (l.amount || 0), 0));
  const sumOk = x.subtotal == null ? (x.amounts_tax_inclusive ? near(lineSum, x.total, tol) : true) : near(lineSum, x.subtotal, tol);
  if (!lines.length) set('line_items', 'contradiction', 0.4, 'No line items read');
  else if (lineOk && sumOk) set('line_items', 'verified', 0.98, `Every qty × rate = amount, and the ${lines.length} line(s) add up to the ${x.subtotal != null ? 'subtotal' : 'total'}`);
  else set('line_items', 'contradiction', 0.55, !lineOk ? 'A line’s qty × rate ≠ its amount — misread or a vendor error' : 'Lines don’t add up to the subtotal — misread or a vendor error');

  // Total: subtotal + taxes = total.
  const taxSum = r2((x.tax_lines || []).reduce((s, t) => s + (t.amount || 0), 0));
  if (x.total == null) set('total', 'contradiction', 0.3, 'No total read');
  else if (x.subtotal != null && near(r2(x.subtotal + taxSum), x.total, tol)) set('total', 'verified', 0.99, 'Subtotal + tax = total');
  else if (x.amounts_tax_inclusive && near(lineSum, x.total, tol)) set('total', 'verified', 0.95, 'Lines add up to the (tax-inclusive) total');
  else if (x.subtotal == null) set('total', 'unverifiable', capAI('total'), 'No subtotal to check against');
  else set('total', 'contradiction', 0.55, 'Subtotal + tax ≠ total — misread or a vendor error');
  return A;
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
  // Reading confidence (from the cross-checks in the Read stage, not the model's self-report).
  // Skip fields whose problem is already raised by a specific check below/elsewhere, so nothing is said twice.
  const covered = (k, a) => ['line_items', 'total', 'po_reference'].includes(k) || (k === 'vendor_gstin' && !GSTIN_RE.test(x.vendor_gstin || '')) || (k === 'invoice_date' && /future|due date/.test(a.basis));
  Object.entries(ctx.assessment || {}).forEach(([k, a]) => {
    if (a.score < R.minConfidence && !covered(k, a)) checks.push({ level: 'warn', code: 'low_conf', msg: `Not sure the ${FIELD_NAMES[k]} was read correctly (${Math.round(a.score * 100)}%): ${a.basis}. A person should check it against the document.` });
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
  // Bundled invoice: vendor billed the whole order as one lump line. Line-level matching is
  // impossible, so match on value instead (whole PO, or the remaining balance) and say so.
  const unmatched = rows.filter((r) => !r.po);
  const valueNow = poValue(po), remainingNow = valueNow - prior.reduce((s, l) => s + l.subtotal, 0);
  const tolAmt = (v) => v * (R.priceTolerancePct / 100) + R.amountMatchTolerance;
  if (unmatched.length && unmatched.length === rows.length && po.lines.length > 1 &&
      (near(ctx.subtotal, valueNow, tolAmt(valueNow)) || near(ctx.subtotal, remainingNow, tolAmt(remainingNow)))) {
    for (let i = checks.length - 1; i >= 0; i--) if (checks[i].code === 'line_not_on_po') checks.splice(i, 1);
    checks.push({ level: 'info', code: 'bundled', msg: `Invoice bundles the order into ${rows.length} line(s) instead of itemising ${po.lines.length} PO lines — matched on value instead: ${inr(ctx.subtotal)} vs ${inr(near(ctx.subtotal, valueNow, tolAmt(valueNow)) ? valueNow : remainingNow)}.` });
    if (po.type === 'goods') {
      const short = po.lines.filter((pl) => grn.flatMap((g) => g.lines).filter((gl) => gl.line === pl.line).reduce((s, g) => s + g.qty, 0) < pl.qty);
      if (grn.length && short.length) checks.push({ level: 'warn', code: 'qty_over_received', msg: `Bundled bill covers the full order, but ${short.map((s) => s.description).join(', ')} not fully received.`, vendorAsk: 'Your invoice bills the full order, but not all items have been received yet.' });
    }
  }
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
    ...ctx.runs.filter((r) => PENDING.includes(r.decision?.status)).map((r) => ({ vkey: r.vendorId || normName(r.vendorName), invoiceNumber: r.invoiceNumber, total: r.total, date: r.invoiceDate, where: `open case ${r.id} (${r.decision.label.toLowerCase()})`, runId: r.id })),
  ];
  const sameFile = ctx.runs.find((r) => r.source?.hash === ctx.hash);
  if (sameFile) checks.push({ level: 'block', code: 'dup_file', atRisk: x.total, msg: `This exact file was already received as case ${sameFile.id} (${sameFile.decision?.label || 'earlier'}).`, ref: sameFile.id });
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
const TITLES = {
  dup_file: 'Exact same file already processed', dup_number: 'Duplicate of an invoice already on record', dup_number_amount: 'Same invoice number, different amount', dup_amount: 'Possible duplicate (same amount, same vendor)',
  no_invoice_no: 'Not a valid tax invoice (no invoice number)', no_total: 'No total found', no_date: 'Invoice date missing', no_vendor: 'Vendor name missing',
  line_math: 'Line arithmetic is wrong', subtotal_math: 'Lines don’t add up to subtotal', total_math: 'Subtotal + tax ≠ total', tax_math: 'Tax miscalculated', tax_inclusive: 'GST not shown separately',
  gst_type: 'Wrong GST type (IGST vs CGST+SGST)', buyer_gstin: 'Billed to the wrong GSTIN', buyer_gstin_missing: 'Our GSTIN missing', future_date: 'Dated in the future', stale: 'Invoice too old', due_before: 'Due date before invoice date', low_conf: 'A field may be misread — check it',
  gstin_format: 'Invalid vendor GSTIN', unknown_vendor: 'Vendor not onboarded', gstin_mismatch: 'GSTIN differs from vendor master', vendor_blocked: 'Vendor is blocked',
  po_not_found: 'Quoted PO doesn’t exist', po_other_vendor: 'PO belongs to another vendor', po_closed: 'PO is closed', no_po: 'No purchase order', po_inferred: 'PO inferred — needs confirmation',
  line_not_on_po: 'Item not on the PO', price_variance: 'Price above PO rate (beyond tolerance)', qty_over_received: 'Billed more than received', qty_over_po: 'Billed more than ordered', no_grn: 'Goods receipt missing', po_overrun: 'Total billing would exceed the PO', over_limit: 'Above auto-approval limit',
  unreadable: 'Could not read the document', error: 'Processing error',
};
export const LABELS = { approved: 'Approved for payment', vendor_hold: 'On hold — vendor query', needs_approval: 'Needs approval', rejected: 'Rejected' };
export const PENDING = ['vendor_hold', 'needs_approval'];
function decide(ctx, stages) {
  const all = stages.flatMap((s) => (s.checks || []).map((c) => ({ ...c, stage: s.id })));
  const blocks = all.filter((c) => c.level === 'block'), warns = all.filter((c) => c.level === 'warn');
  const x = ctx.x || {};
  // Four outcomes, mirroring how an AP team actually routes work:
  //   rejected       – must not be paid as-is (duplicate, not a valid tax invoice, blocked vendor)
  //   vendor_hold    – the vendor has to fix something (overcharge, overbilling, missing GST…) → query drafted
  //   needs_approval – only an internal decision is needed (confirm inferred PO, large amount, unsure AI read)
  //   approved       – every check passed → ready to pay
  const unreadable = blocks.some((b) => b.code === 'unreadable');
  // If the reading itself is in doubt, a person confirms it against the document BEFORE we tell the vendor
  // they made a mistake — the mistake might be ours.
  const doubt = Object.entries(ctx.assessment || {}).filter(([, a]) => a.kind === 'contradiction').map(([k]) => FIELD_NAMES[k]);
  const status = unreadable ? 'needs_approval' : blocks.length ? 'rejected' : doubt.length && warns.length ? 'needs_approval' : warns.some((w) => w.vendorAsk) ? 'vendor_hold' : warns.length ? 'needs_approval' : 'approved';
  const label = unreadable ? 'Manual entry needed' : LABELS[status];
  const reasons = [...blocks, ...warns];
  let headline, nextAction;
  const due = x.due_date || (x.invoice_date && ctx.vendor ? new Date(new Date(x.invoice_date).getTime() + ctx.vendor.terms * 86400000).toISOString().slice(0, 10) : null);
  if (status === 'approved') {
    headline = `All checks passed — ${inr(x.total)} to ${ctx.vendor?.name}${ctx.po ? ` against ${ctx.po.po}` : ''}.`;
    nextAction = `Posted to the ledger. Payment due ${due || 'per vendor terms'}.`;
  } else {
    const titles = [...new Set(reasons.map((c) => TITLES[c.code] || c.msg))];
    headline = titles.slice(0, 3).join(' · ') + (titles.length > 3 ? ` · +${titles.length - 3} more` : '');
    nextAction = {
      rejected: 'Do not pay. Send the drafted note to the vendor so they know why.',
      vendor_hold: 'Not paid yet. Send the drafted query; when the vendor replies, re-check or decide.',
      needs_approval: unreadable ? 'Key the invoice in manually or try a clearer copy.' : doubt.length && warns.some((w) => w.vendorAsk) ? `First check the ${doubt.join(', ')} against the document. If it really says that, send the drafted vendor query; if it was misread, the invoice may be fine.` : 'An approver decides — everything they need is below.',
    }[status];
  }
  const asks = reasons.filter((c) => c.vendorAsk);
  let email = null;
  if (asks.length) {
    const who = ctx.vendor?.name || x.vendor_name || 'Vendor';
    const ref = x.invoice_number ? `invoice ${x.invoice_number}` : `your bill dated ${x.invoice_date || '(undated)'} for ${inr(x.total)}`;
    email = {
      to: ctx.vendor?.email || '(no email on file — vendor not onboarded)',
      subject: `${status === 'rejected' ? 'Not processed' : 'On hold'}: ${x.invoice_number || 'your bill'} — action needed`,
      body: `Hello ${who} team,\n\nWe received ${ref}${ctx.po ? ` (${ctx.po.po})` : ''}. ${status === 'rejected' ? 'We are unable to process it' : 'It is on hold and has not been paid yet'} for the following reason${asks.length > 1 ? 's' : ''}:\n\n${asks.map((a, i) => `${i + 1}. ${a.vendorAsk}`).join('\n')}\n\n${status === 'rejected' ? 'Please do not resend this document; reply to this email if you believe this is in error.' : `Please reply with the corrected document${asks.length > 1 ? 's' : ''} and we will process it promptly.`}\n\nRegards,\nAccounts Payable\n${COMPANY.name}`,
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
  ctx.decision = decision;
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
