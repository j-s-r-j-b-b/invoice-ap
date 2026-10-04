// Generates the six sample invoice HTML files from api/_lib/samples.js.
// Run: node gen.mjs   (then build.sh renders them to PDF with Edge headless)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcSamples = path.resolve(here, '../../api/_lib/samples.js');
const tmp = path.join(here, '_samples.tmp.mjs');
fs.writeFileSync(tmp, fs.readFileSync(srcSamples, 'utf8'));
const { SAMPLES } = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);
const S = Object.fromEntries(SAMPLES.map((s) => [s.id, s]));

const BUYER_ADDR = 'Unit 4, Lotus Corporate Park, Goregaon East, Mumbai 400063';

// ---------- helpers ----------
function inr(n) {
  const neg = n < 0; n = Math.abs(n);
  const [i, d] = n.toFixed(2).split('.');
  let last3 = i.slice(-3), rest = i.slice(0, -3);
  if (rest) last3 = ',' + last3;
  rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return (neg ? '-' : '') + rest + last3 + '.' + d;
}
const R = (n) => '₹' + inr(n);
const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function two(n) { return n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : ''); }
function three(n) { const h = Math.floor(n / 100), r = n % 100; return (h ? ones[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : ''); }
function words(n) {
  const rupees = Math.floor(n), paise = Math.round((n - rupees) * 100);
  const parts = []; let x = rupees;
  const cr = Math.floor(x / 1e7); x %= 1e7; const lk = Math.floor(x / 1e5); x %= 1e5; const th = Math.floor(x / 1e3); x %= 1e3;
  if (cr) parts.push(two(cr) + ' Crore'); if (lk) parts.push(two(lk) + ' Lakh'); if (th) parts.push(two(th) + ' Thousand'); if (x) parts.push(three(x));
  return 'Rupees ' + parts.join(' ') + (paise ? ' and ' + two(paise) + ' Paise' : '') + ' Only';
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmt(iso, style) {
  const [y, m, d] = iso.split('-').map(Number);
  const dd = String(d).padStart(2, '0'), mm = String(m).padStart(2, '0');
  switch (style) {
    case 'dMonY': return `${dd}-${MON[m - 1]}-${y}`;
    case 'slash': return `${dd}/${mm}/${y}`;
    case 'long': return `${d} ${MONL[m - 1]} ${y}`;
    case 'dot': return `${dd}.${mm}.${y}`;
    case 'short': return `${dd}/${mm}/${String(y).slice(2)}`;
    case 'dash': return `${dd}-${mm}-${y}`;
  }
}
const qty = (q) => String(q);
function page(title, css, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}
body{width:210mm;height:297mm;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
${css}</style></head><body>${body}</body></html>`;
}
const write = (name, html) => fs.writeFileSync(path.join(here, name), html);

// ---------- s1 Brightline: clean corporate, navy band ----------
{
  const v = S.s1.invoice;
  const hsn = ['4802', '8443', '9608'];
  const css = `
body{font-family:'Segoe UI',Arial,sans-serif;color:#1d2433;font-size:10.5pt}
.band{background:#1f3a68;color:#fff;padding:14mm 16mm 9mm;display:flex;justify-content:space-between;align-items:flex-end}
.logo{display:flex;align-items:center;gap:10px}.mark{width:44px;height:44px;border-radius:50%;background:#f2b134;color:#1f3a68;font-weight:800;font-size:20pt;display:flex;align-items:center;justify-content:center}
.vn{font-size:16pt;font-weight:700}.vs{font-size:9pt;opacity:.85}
.tt{text-align:right}.tt h1{margin:0;font-size:22pt;letter-spacing:3px;font-weight:300}.tt div{font-size:9pt;opacity:.85}
.wrap{padding:8mm 16mm}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-bottom:7mm}
.lbl{font-size:8pt;text-transform:uppercase;letter-spacing:1.2px;color:#6b7690;margin-bottom:3px}
.meta td{padding:2px 0;font-size:10pt}.meta td:first-child{color:#6b7690;width:38mm}
table.items{width:100%;border-collapse:collapse;margin-top:2mm}
.items th{background:#e8edf6;color:#1f3a68;font-size:9pt;padding:7px 8px;border-bottom:2px solid #1f3a68}
.items td{padding:8px;border-bottom:1px solid #e1e5ee;font-size:10pt}.items tr:nth-child(even) td{background:#f8f9fc}
.r{text-align:right}.c{text-align:center}th{text-align:left}th.r{text-align:right}th.c{text-align:center}
.tot{width:85mm;margin-left:auto;margin-top:5mm;border-collapse:collapse}.tot td{padding:5px 8px;font-size:10pt}
.tot tr.g td{background:#1f3a68;color:#fff;font-weight:700;font-size:12pt}
.words{margin-top:5mm;font-size:9.5pt;font-style:italic;color:#3b4560}
.foot{display:grid;grid-template-columns:1.2fr 1fr;gap:10mm;margin-top:10mm;font-size:9pt}
.box{border:1px solid #d5dbe8;border-radius:6px;padding:10px 12px}
.sign{text-align:right;margin-top:16mm;font-size:9.5pt}.sign .line{border-top:1px solid #1d2433;width:55mm;margin:14mm 0 4px auto}
.bottom{position:absolute;bottom:10mm;left:16mm;right:16mm;font-size:8pt;color:#8a93a8;text-align:center;border-top:1px solid #e1e5ee;padding-top:4px}`;
  const rows = v.line_items.map((l, i) => `<tr><td class="c">${i + 1}</td><td>${l.description}</td><td class="c">${hsn[i]}</td><td class="r">${qty(l.quantity)}</td><td class="r">${R(l.unit_price)}</td><td class="r">${R(l.amount)}</td></tr>`).join('');
  const body = `
<div class="band"><div class="logo"><div class="mark">B</div><div><div class="vn">${v.vendor_name}</div><div class="vs">${v.vendor_address}<br>GSTIN: ${v.vendor_gstin} &nbsp;|&nbsp; PAN: AABCB1234F &nbsp;|&nbsp; accounts@brightlineoffice.in</div></div></div>
<div class="tt"><h1>TAX INVOICE</h1><div>Original for Recipient</div></div></div>
<div class="wrap">
<div class="grid"><div><div class="lbl">Bill To</div><b>${v.buyer_name}</b><br>${BUYER_ADDR}<br>GSTIN: ${v.buyer_gstin}<br>State: Maharashtra (27)</div>
<div><table class="meta"><tr><td>Invoice No.</td><td><b>${v.invoice_number}</b></td></tr><tr><td>Invoice Date</td><td>${fmt(v.invoice_date, 'dMonY')}</td></tr><tr><td>Due Date</td><td>${fmt(v.due_date, 'dMonY')}</td></tr><tr><td>PO Reference</td><td>${v.po_reference}</td></tr><tr><td>Place of Supply</td><td>Maharashtra (27)</td></tr></table></div></div>
<table class="items"><thead><tr><th class="c">#</th><th>Description of Goods</th><th class="c">HSN</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot"><tr><td>Subtotal</td><td class="r">${R(v.subtotal)}</td></tr>
${v.tax_lines.map((t) => `<tr><td>${t.label} @ ${t.rate_pct}%</td><td class="r">${R(t.amount)}</td></tr>`).join('')}
<tr class="g"><td>Total</td><td class="r">${R(v.total)}</td></tr></table>
<div class="words">Amount in words: ${words(v.total)}</div>
<div class="foot"><div class="box"><div class="lbl">Bank Details</div>HDFC Bank Ltd, Andheri East Branch<br>A/c Name: Brightline Office Supplies Pvt Ltd<br>A/c No: 50200048193726 &nbsp; IFSC: HDFC0000542</div>
<div class="box"><div class="lbl">Terms</div>Payment due within 30 days of invoice date. Interest @ 18% p.a. on overdue amounts. Goods once sold will not be taken back.</div></div>
<div class="sign">For <b>${v.vendor_name}</b><div class="line"></div>Authorised Signatory</div>
</div><div class="bottom">This is a computer generated invoice. Subject to Mumbai jurisdiction.</div>`;
  write('s1-brightline.html', page('Brightline Invoice', css, body));
}

// ---------- s2 Northwind: logistics, bordered grid, reminder stamp ----------
{
  const v = S.s2.invoice;
  const sac = ['996511', '996719'];
  const css = `
body{font-family:Arial,Helvetica,sans-serif;font-size:9.5pt;color:#111;padding:27mm 13mm 12mm;position:relative}
.stamp{position:absolute;top:7mm;left:62mm;transform:rotate(-7deg);border:4px double #d0141a;color:#d0141a;font-weight:900;font-size:24pt;letter-spacing:3px;padding:4px 16px;opacity:.82;font-family:Impact,'Arial Black',sans-serif;z-index:5}
.hdr{display:flex;border:2px solid #0b5563}
.hl{flex:1.4;padding:10px;display:flex;gap:10px;align-items:center;border-right:2px solid #0b5563}
.truck{width:56px;height:56px;background:#0b5563;color:#ffb000;font-weight:900;font-size:15pt;display:flex;align-items:center;justify-content:center}
.vn{font-size:15pt;font-weight:900;color:#0b5563;text-transform:uppercase}
.hr{flex:1;background:#0b5563;color:#fff;display:flex;flex-direction:column;justify-content:center;align-items:center}
.hr h1{margin:0;font-size:18pt;letter-spacing:2px}
table{border-collapse:collapse;width:100%}
td,th{border:1px solid #0b5563;padding:5px 7px;vertical-align:top}
.k{background:#e3f0f2;font-weight:bold;width:30mm}
.items th{background:#ffb000;color:#111;font-size:9pt}
.r{text-align:right}.c{text-align:center}
.sec{margin-top:4mm}
.tot td{font-size:10pt}.tot .g td{font-weight:bold;font-size:11.5pt;background:#e3f0f2}
.small{font-size:8.5pt}
.sign{height:28mm;text-align:right;vertical-align:bottom}`;
  const rows = v.line_items.map((l, i) => `<tr><td class="c">${i + 1}</td><td>${l.description}</td><td class="c">${sac[i]}</td><td class="c">${qty(l.quantity)} Trip${''}</td><td class="r">${inr(l.unit_price)}</td><td class="r">${inr(l.amount)}</td></tr>`).join('');
  const body = `
<div class="stamp">PAYMENT REMINDER</div>
<div class="hdr"><div class="hl"><div class="truck">NW</div><div><div class="vn">${v.vendor_name}</div>${v.vendor_address}<br>GSTIN: <b>${v.vendor_gstin}</b> &nbsp; Ph: +91 80 4123 7788<br>billing@northwindlogistics.co.in</div></div>
<div class="hr"><h1>TAX INVOICE</h1><div class="small">(Goods Transport Agency)</div></div></div>
<table class="sec"><tr><td class="k">Invoice No</td><td><b>${v.invoice_number}</b></td><td class="k">Invoice Date</td><td>${fmt(v.invoice_date, 'slash')}</td></tr>
<tr><td class="k">Customer PO</td><td>${v.po_reference}</td><td class="k">Due Date</td><td>${fmt(v.due_date, 'slash')}</td></tr>
<tr><td class="k">Billed To</td><td colspan="3"><b>${v.buyer_name}</b>, ${BUYER_ADDR}<br>GSTIN: ${v.buyer_gstin} &nbsp;&nbsp; Place of Supply: Maharashtra (27)</td></tr></table>
<table class="sec items"><thead><tr><th>S.No</th><th>Particulars</th><th>SAC</th><th>Qty</th><th>Rate (₹)</th><th>Amount (₹)</th></tr></thead><tbody>${rows}
<tr><td colspan="6" style="height:62mm;border-top:none"></td></tr></tbody></table>
<table class="tot"><tr><td rowspan="3" style="width:60%" class="small"><b>Amount in words:</b><br>${words(v.total)}<br><br>Tax payable on reverse charge: No</td><td>Taxable Value</td><td class="r">${inr(v.subtotal)}</td></tr>
${v.tax_lines.map((t) => `<tr><td>${t.label} @ ${t.rate_pct}%</td><td class="r">${inr(t.amount)}</td></tr>`).join('')}
<tr class="g"><td>Grand Total (₹)</td><td class="r">${inr(v.total)}</td></tr></table>
<table class="sec"><tr><td style="width:60%" class="small"><b>Bank Details</b><br>ICICI Bank, Peenya Branch, Bengaluru<br>A/c No: 039105001842 &nbsp; IFSC: ICIC0000391<br><br><b>Terms &amp; Conditions</b><br>1. Payment within 15 days of invoice.<br>2. Claims for damage/shortage must be raised within 7 days of delivery.<br>3. Subject to Bengaluru jurisdiction.</td>
<td class="sign">For ${v.vendor_name}<br><br><br><br>Authorised Signatory</td></tr></table>`;
  write('s2-northwind.html', page('Northwind Invoice', css, body));
}

// ---------- s3 Apex: modern tech, purple stripe ----------
{
  const v = S.s3.invoice;
  const css = `
body{font-family:Calibri,'Segoe UI',sans-serif;font-size:11pt;color:#2a2a35;display:flex}
.side{width:9mm;background:linear-gradient(#6c3bd1,#2fb5c9)}
.main{flex:1;padding:16mm 15mm 12mm 13mm;position:relative}
.top{display:flex;justify-content:space-between}
.brand{font-size:20pt;font-weight:700;color:#6c3bd1;letter-spacing:-.5px}.brand span{color:#2fb5c9}
.addr{font-size:9.5pt;color:#666;line-height:1.45}
.big{font-size:34pt;font-weight:300;color:#2a2a35;text-align:right;line-height:1}
.inv{font-size:9.5pt;color:#666;text-align:right;margin-top:4px}
.strip{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin:11mm 0 9mm;border-top:1px solid #ddd;border-bottom:1px solid #ddd}
.strip div{padding:8px 0}.strip .l{font-size:8.5pt;color:#888;text-transform:uppercase;letter-spacing:1px}.strip .v{font-weight:700;font-size:11pt}
.bill{font-size:10pt;line-height:1.5;margin-bottom:9mm}.bill .l{font-size:8.5pt;color:#888;text-transform:uppercase;letter-spacing:1px}
table{width:100%;border-collapse:collapse}
th{font-size:8.5pt;color:#6c3bd1;text-transform:uppercase;letter-spacing:1px;text-align:left;padding:6px 4px;border-bottom:2px solid #6c3bd1}
td{padding:10px 4px;border-bottom:1px solid #eee}
.r{text-align:right}
.tot{width:80mm;margin:6mm 0 0 auto}.tot td{border:none;padding:5px 4px}
.tot .g td{font-size:15pt;font-weight:700;color:#6c3bd1;border-top:2px solid #6c3bd1;padding-top:8px}
.words{font-size:9.5pt;color:#666;margin-top:3mm;text-align:right}
.bot{display:flex;justify-content:space-between;margin-top:14mm;font-size:9pt;color:#555;line-height:1.5}
.sig{text-align:center}.sig .ln{border-top:1px solid #999;width:50mm;margin-top:16mm;padding-top:3px}
.foot{position:absolute;bottom:10mm;left:13mm;right:15mm;font-size:8pt;color:#aaa;display:flex;justify-content:space-between}`;
  const l = v.line_items[0];
  const body = `<div class="side"></div><div class="main">
<div class="top"><div><div class="brand">apex<span>cloud</span></div><div class="addr"><b>${v.vendor_name}</b><br>${v.vendor_address}<br>GSTIN ${v.vendor_gstin} · CIN U72900DL2015PTC283114</div></div>
<div><div class="big">Invoice</div><div class="inv">Tax Invoice · ${v.invoice_number}</div></div></div>
<div class="strip"><div><div class="l">Invoice date</div><div class="v">${fmt(v.invoice_date, 'long')}</div></div><div><div class="l">Due date</div><div class="v">${fmt(v.due_date, 'long')}</div></div><div><div class="l">Purchase order</div><div class="v">${v.po_reference}</div></div><div><div class="l">Amount due</div><div class="v">${R(v.total)}</div></div></div>
<div class="bill"><div class="l">Billed to</div><b>${v.buyer_name}</b><br>${BUYER_ADDR}<br>GSTIN ${v.buyer_gstin} · Place of supply: Maharashtra (27)</div>
<table><thead><tr><th>Service</th><th>SAC</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead>
<tbody><tr><td>${l.description}<br><span style="font-size:9pt;color:#888">24x7 monitoring, patching, backup &amp; incident response — per SOW dated 02 June 2026</span></td><td>998316</td><td class="r">${qty(l.quantity)}</td><td class="r">${R(l.unit_price)}</td><td class="r">${R(l.amount)}</td></tr></tbody></table>
<table class="tot"><tr><td>Subtotal</td><td class="r">${R(v.subtotal)}</td></tr>${v.tax_lines.map((t) => `<tr><td>${t.label} (${t.rate_pct}%)</td><td class="r">${R(t.amount)}</td></tr>`).join('')}<tr class="g"><td>Total</td><td class="r">${R(v.total)}</td></tr></table>
<div class="words">${words(v.total)}</div>
<div class="bot"><div><b>Pay by NEFT / RTGS</b><br>Kotak Mahindra Bank, Nehru Place<br>Account: 7412638590 · IFSC: KKBK0000214<br><br><b>Terms</b><br>Net 30. Please quote the invoice number with your remittance.<br>Late payments attract interest at 1.5% per month.</div>
<div class="sig">for ${v.vendor_name}<div class="ln">Authorised Signatory</div></div></div>
<div class="foot"><span>billing@apexcloud.in · +91 11 4055 2200</span><span>Page 1 of 1</span></div></div>`;
  write('s3-apex.html', page('Apex Invoice', css, body));
}

// ---------- s4 Kestrel: traditional boxed Indian GST format ----------
{
  const v = S.s4.invoice;
  const hsn = ['6506', '4015', '6211'];
  const units = ['Nos', 'Box', 'Nos'];
  const css = `
body{font-family:'Times New Roman',Times,serif;font-size:10.5pt;color:#000;padding:10mm 11mm}
.outer{border:1.5px solid #000}
.title{text-align:center;font-weight:bold;font-size:14pt;border-bottom:1.5px solid #000;padding:4px;position:relative;letter-spacing:1px}
.title small{position:absolute;right:6px;top:7px;font-size:8.5pt;font-weight:normal;letter-spacing:0}
.vend{text-align:center;padding:6px;border-bottom:1.5px solid #000}
.vend .n{font-size:17pt;font-weight:bold;color:#7a1010}
table{width:100%;border-collapse:collapse}
td,th{border:1px solid #000;padding:4px 5px;vertical-align:top}
.nb td{border-top:none}
th{background:#eee;font-size:9.5pt}
.r{text-align:right}.c{text-align:center}
.items td{border-top:none;border-bottom:none}.items tr.fill td{height:52mm}
.items tr.last td{border-bottom:1px solid #000}
.b{font-weight:bold}`;
  const rows = v.line_items.map((l, i) => `<tr><td class="c">${i + 1}</td><td>${l.description}</td><td class="c">${hsn[i]}</td><td class="r">${qty(l.quantity)} ${units[i]}</td><td class="r">${inr(l.unit_price)}</td><td class="r">${inr(l.amount)}</td></tr>`).join('');
  const t = v.tax_lines[0];
  const body = `<div class="outer">
<div class="title">TAX INVOICE<small>ORIGINAL FOR RECIPIENT</small></div>
<div class="vend"><div class="n">${v.vendor_name.toUpperCase()}</div>${v.vendor_address}, Gujarat<br>Phone: 079-2583 4412 &nbsp; E-mail: sales@kestrelindustrial.in<br><b>GSTIN/UIN: ${v.vendor_gstin}</b> &nbsp; State: Gujarat, Code: 24</div>
<table><tr><td style="width:50%" rowspan="3"><b>Buyer (Bill to)</b><br><b>${v.buyer_name}</b><br>${BUYER_ADDR}<br>GSTIN/UIN: ${v.buyer_gstin}<br>State Name: Maharashtra, Code: 27</td>
<td>Invoice No.<br><b>${v.invoice_number}</b></td><td>Dated<br><b>${fmt(v.invoice_date, 'dot')}</b></td></tr>
<tr><td>Buyer's Order No.<br><b>${v.po_reference}</b></td><td>Due Date<br><b>${fmt(v.due_date, 'dot')}</b></td></tr>
<tr><td>Dispatched through<br>VRL Logistics</td><td>Mode/Terms of Payment<br>45 days</td></tr></table>
<table class="items"><thead><tr><th style="width:9mm">Sl No.</th><th>Description of Goods</th><th>HSN/SAC</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}
<tr class="fill"><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr class="last"><td></td><td class="r b">Total (Taxable Value)</td><td></td><td></td><td></td><td class="r b">${inr(v.subtotal)}</td></tr></tbody></table>
<table><tr><th>HSN/SAC</th><th>Taxable Value</th><th>${t.label} Rate</th><th>${t.label} Amount</th><th>Total Tax Amount</th></tr>
<tr><td class="c">6506, 4015, 6211</td><td class="r">${inr(v.subtotal)}</td><td class="c">${t.rate_pct}%</td><td class="r">${inr(t.amount)}</td><td class="r">${inr(v.tax_total)}</td></tr>
<tr><td colspan="4" class="r b">Grand Total</td><td class="r b">₹ ${inr(v.total)}</td></tr></table>
<table class="nb"><tr><td colspan="2">Amount Chargeable (in words)<br><b>INR ${words(v.total).replace(/^Rupees /, '')}</b></td></tr>
<tr><td style="width:55%">Company's Bank Details<br>Bank Name: State Bank of India, Vatva GIDC<br>A/c No.: 32876104452<br>Branch &amp; IFS Code: SBIN0003012<br><br><u>Declaration</u><br>We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</td>
<td class="r" style="vertical-align:top"><b>for ${v.vendor_name.toUpperCase()}</b><br><br><br><br><br><br>Authorised Signatory</td></tr></table>
</div><div style="text-align:center;font-size:9pt;margin-top:3px">SUBJECT TO AHMEDABAD JURISDICTION &nbsp;·&nbsp; This is a Computer Generated Invoice</div>`;
  write('s4-kestrel.html', page('Kestrel Invoice', css, body));
}

// ---------- s5 Greenleaf: printed bill-book, phone-scan look (rendered to PNG) ----------
{
  const v = S.s5.invoice;
  const sac = ['998533', '3402'];
  const noise = `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.3  0 0 0 0 0.3  0 0 0 0 0.28  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`)}")`;
  const css = `
body{width:1240px;height:1754px;overflow:hidden;background:#5b5852;position:relative}
.paper{position:absolute;left:38px;top:30px;width:1172px;height:1690px;transform:rotate(1.1deg);
 background:radial-gradient(ellipse at 30% 20%,#f4f1e8 0%,#e9e5d9 55%,#d6d1c2 100%);
 box-shadow:0 8px 30px rgba(0,0,0,.55);padding:70px 78px;font-family:Arial,sans-serif;color:#1d3b26;filter:blur(.7px) contrast(1.05)}
.paper:before{content:'';position:absolute;inset:0;background:${noise};opacity:.55;mix-blend-mode:multiply;pointer-events:none}
.paper:after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,0) 18%,rgba(0,0,0,0) 70%,rgba(0,0,0,.22) 100%);pointer-events:none}
.head{border:3px solid #2e6b3c;padding:18px 22px;display:flex;justify-content:space-between;align-items:center}
.leaf{font-size:62px;color:#2e6b3c;font-weight:900;font-family:Georgia,serif}
.vn{font-size:40px;font-weight:900;color:#2e6b3c;font-family:Georgia,serif}
.va{font-size:20px;line-height:1.45}
.tt{background:#2e6b3c;color:#efeadb;text-align:center;font-size:28px;font-weight:bold;letter-spacing:6px;padding:6px;margin-top:10px}
.row{display:flex;justify-content:space-between;font-size:22px;margin-top:20px;line-height:1.7}
.hw{font-family:'Ink Free','Segoe Script',cursive;color:#1b2a8a;font-size:28px;font-weight:bold}
.no{color:#b3261e;font-size:30px;font-weight:bold;font-family:'Courier New',monospace}
table{width:100%;border-collapse:collapse;margin-top:22px;font-size:21px}
th{border:2px solid #2e6b3c;background:rgba(46,107,60,.15);padding:9px}
td{border-left:2px solid #2e6b3c;border-right:2px solid #2e6b3c;padding:10px 9px}
tr.last td{border-bottom:2px solid #2e6b3c;height:220px}
.r{text-align:right}.c{text-align:center}
.tot{width:500px;margin-left:auto;margin-top:0}.tot td{border:2px solid #2e6b3c;padding:9px 12px}
.g td{font-weight:bold;font-size:25px}
.words{font-size:20px;margin-top:22px}
.bank{font-size:19px;margin-top:40px;line-height:1.5;width:560px}
.sigwrap{position:absolute;right:110px;top:1290px;text-align:center;width:360px;font-size:20px}
.sig{position:absolute;left:700px;top:1050px;font-family:'Segoe Script','Ink Free',cursive;font-size:64px;color:#14247a;transform:rotate(-11deg);opacity:.85;z-index:3}
.stamp{position:absolute;left:640px;top:1300px;width:250px;height:250px;border:6px solid #5a3fa8;border-radius:50%;color:#5a3fa8;opacity:.6;transform:rotate(-18deg);display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:bold;text-align:center;font-size:20px;filter:blur(.6px)}
.stamp:before{content:'';position:absolute;inset:12px;border:2px solid #5a3fa8;border-radius:50%}
.stamp b{font-size:26px;letter-spacing:2px}
.terms{position:absolute;left:78px;bottom:70px;font-size:17px;width:1000px}
.fold{position:absolute;left:0;right:0;top:48%;height:2px;background:linear-gradient(90deg,rgba(0,0,0,.08),rgba(255,255,255,.4),rgba(0,0,0,.1))}`;
  const rows = v.line_items.map((l, i) => `<tr><td class="c">${i + 1}</td><td>${l.description}</td><td class="c">${sac[i]}</td><td class="c">${qty(l.quantity)}</td><td class="r">${inr(l.unit_price)}</td><td class="r">${inr(l.amount)}</td></tr>`).join('');
  const body = `<div class="paper"><div class="fold"></div>
<div class="head"><div class="leaf">&#10048;</div><div style="flex:1;margin-left:22px"><div class="vn">${v.vendor_name.toUpperCase()}</div><div class="va">Housekeeping · Pest Control · Facility Management<br>${v.vendor_address}<br>Mob: 98200 41766 &nbsp; GSTIN: <b>${v.vendor_gstin}</b></div></div></div>
<div class="tt">TAX INVOICE</div>
<div class="row"><div>Invoice No: <span class="no">${v.invoice_number}</span><br>Ref: <span class="hw">September 2026 services</span></div>
<div style="text-align:right">Date: <span class="hw">${fmt(v.invoice_date, 'short')}</span><br>Due Date: <span class="hw">${fmt(v.due_date, 'short')}</span></div></div>
<div class="row" style="display:block">M/s. <span class="hw">${v.buyer_name}</span><br>Address: <span class="hw" style="font-size:25px">${BUYER_ADDR}</span><br>GSTIN: <span class="hw">${v.buyer_gstin}</span></div>
<table><thead><tr><th>Sr.</th><th>Particulars</th><th>SAC/HSN</th><th>Qty</th><th>Rate</th><th>Amount (Rs.)</th></tr></thead><tbody>${rows}<tr class="last"><td></td><td></td><td></td><td></td><td></td><td></td></tr></tbody></table>
<table class="tot"><tr><td>Sub Total</td><td class="r">${inr(v.subtotal)}</td></tr>${v.tax_lines.map((t) => `<tr><td>${t.label} @ ${t.rate_pct}%</td><td class="r">${inr(t.amount)}</td></tr>`).join('')}<tr class="g"><td>TOTAL</td><td class="r">Rs. ${inr(v.total)}</td></tr></table>
<div class="words">Rupees in words: <span class="hw" style="font-size:24px">${words(v.total).replace(/^Rupees /, '')}</span></div>
<div class="bank"><b>Bank:</b> Bank of Baroda, Powai Branch<br>A/c No. 04150200009873 &nbsp; IFSC: BARB0POWAIX</div>
<div class="sig">R. Nair</div><div class="sigwrap">For ${v.vendor_name}<br>Authorised Signatory</div>
<div class="stamp"><b>GREENLEAF</b>FACILITY<br>SERVICES<br>POWAI, MUMBAI</div>
<div class="terms">1. Payment within 30 days. 2. Cheque / NEFT in favour of "Greenleaf Facility Services". 3. Subject to Mumbai jurisdiction. E.&amp;O.E.</div>
</div>`;
  fs.writeFileSync(path.join(here, 's5-greenleaf-scan.html'), `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:0}${css}</style></head><body>${body}</body></html>`);
  // image-only wrapper page for PDF
  write('s5-wrap.html', `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}img{display:block;width:210mm;height:297mm}</style></head><body><img src="s5-greenleaf-scan.jpg"></body></html>`);
}

// ---------- s6 Zenith: simple caterer bill ----------
{
  const v = S.s6.invoice;
  const css = `
body{font-family:Georgia,'Times New Roman',serif;font-size:11pt;color:#3a1c1c;padding:16mm 20mm}
.h{text-align:center;border-bottom:3px double #8b1e2d;padding-bottom:6mm}
.n{font-size:24pt;color:#8b1e2d;font-style:italic;font-weight:bold}
.tag{font-size:10pt;letter-spacing:2px;color:#a0606a;text-transform:uppercase;margin:2px 0 6px}
.a{font-size:10pt;line-height:1.5}
.bill{font-size:20pt;letter-spacing:10px;text-align:center;margin:7mm 0;color:#8b1e2d;font-weight:bold}
.meta{display:flex;justify-content:space-between;font-size:11pt;margin-bottom:6mm}
table{width:100%;border-collapse:collapse}
th{border-top:1px solid #8b1e2d;border-bottom:1px solid #8b1e2d;padding:7px 6px;text-align:left;font-size:10pt;color:#8b1e2d}
td{padding:10px 6px;border-bottom:1px dotted #c9a0a6}
.r{text-align:right}.c{text-align:center}
.g td{border-top:2px solid #8b1e2d;border-bottom:3px double #8b1e2d;font-weight:bold;font-size:13pt}
.note{margin-top:5mm;font-style:italic;font-size:11pt}
.w{margin-top:3mm;font-size:10pt}
.foot{display:flex;justify-content:space-between;margin-top:22mm;font-size:10pt;line-height:1.5}
.thanks{text-align:center;margin-top:18mm;color:#8b1e2d;font-style:italic;font-size:12pt}`;
  const rows = v.line_items.map((l, i) => `<tr><td class="c">${i + 1}</td><td>${l.description}</td><td class="c">996334</td><td class="c">${qty(l.quantity)}</td><td class="r">${inr(l.unit_price)}</td><td class="r">${inr(l.amount)}</td></tr>`).join('');
  const body = `<div class="h"><div class="n">${v.vendor_name}</div><div class="tag">Weddings · Corporate Events · Outdoor Catering</div><div class="a">${v.vendor_address}<br>Ph: 98679 22310 / 022-2851 4409 &nbsp;|&nbsp; GSTIN: ${v.vendor_gstin}</div></div>
<div class="bill">BILL</div>
<div class="meta"><div>To,<br><b>${v.buyer_name}</b><br>Goregaon East, Mumbai</div><div style="text-align:right">Date: ${fmt(v.invoice_date, 'dash')}<br>Event: Team Offsite</div></div>
<table><thead><tr><th class="c">Sr</th><th>Particulars</th><th class="c">SAC</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}
<tr class="g"><td></td><td colspan="4">Total</td><td class="r">₹ ${inr(v.total)}</td></tr></tbody></table>
<div class="note">* Amount inclusive of all taxes</div>
<div class="w">In words: ${words(v.total)}</div>
<div class="foot"><div><b>Bank details</b><br>Saraswat Co-op Bank, Marol Branch<br>A/c No. 610000004417 &nbsp; IFSC: SRCB0000061<br>UPI: zenithcaterers@sbi<br><br>Terms: 50% advance, balance on delivery.</div>
<div style="text-align:center;padding-top:14mm">For ${v.vendor_name}<br><br><br>Authorised Signatory</div></div>
<div class="thanks">Thank you for your business!</div>`;
  write('s6-zenith.html', page('Zenith Bill', css, body));
}
console.log('HTML generated');
