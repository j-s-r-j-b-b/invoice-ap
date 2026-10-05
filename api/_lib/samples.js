// The AP inbox: six vendor emails with the invoice PDFs attached. `invoice` is exactly what is
// printed on each PDF (the files in /samples are generated from it) — the pipeline never sees it;
// it reads the PDF itself. kind/title/blurb are presenter notes only, not shown in the product.

const BUYER = { name: 'Meridian Retail Pvt Ltd', gstin: '27AAECM4321J1ZJ' };

export const SAMPLES = [
  {
    id: 's1', email: {"fromName":"Brightline Office Supplies","from":"accounts@brightline.example","subject":"Invoice BOS/26-27/0317 — PO-4501 office consumables","receivedAt":"2026-09-28T10:14:00+05:30","body":"Dear Sir/Madam, please find attached our invoice for the Q3 restock delivered on 26 Sep against PO-4501."}, file: 's1-brightline.pdf', kind: 'Happy path',
    title: 'Clean invoice, perfect match',
    blurb: 'Office supplies. PO referenced, goods received, prices match.',
    expect: 'approved',
    invoice: {
      vendor_name: 'Brightline Office Supplies Pvt Ltd', vendor_gstin: '27AABCB1234F1Z8',
      vendor_address: '12 Saki Vihar Road, Andheri East, Mumbai 400072',
      invoice_number: 'BOS/26-27/0317', invoice_date: '2026-09-28', due_date: '2026-10-28', po_reference: 'PO-4501',
      buyer_name: BUYER.name, buyer_gstin: BUYER.gstin, currency: 'INR',
      line_items: [
        { description: 'A4 copier paper 75 GSM (box of 5 reams)', quantity: 40, unit_price: 1450, amount: 58000 },
        { description: 'HP 76A black toner cartridge', quantity: 12, unit_price: 6200, amount: 74400 },
        { description: 'Whiteboard markers, assorted (pack of 10)', quantity: 30, unit_price: 380, amount: 11400 },
      ],
      subtotal: 143800,
      tax_lines: [{ label: 'CGST', rate_pct: 9, amount: 12942 }, { label: 'SGST', rate_pct: 9, amount: 12942 }],
      tax_total: 25884, total: 169684, amounts_tax_inclusive: false,
    },
    quality: 'clean',
  },
  {
    id: 's2', email: {"fromName":"Northwind Logistics","from":"billing@northwind.example","subject":"PAYMENT REMINDER — Invoice INV1042-A overdue","receivedAt":"2026-09-29T17:42:00+05:30","body":"Gentle reminder: the attached freight invoice is pending. Kindly arrange payment at the earliest."}, file: 's2-northwind.pdf', kind: 'Edge case',
    title: 'Disguised duplicate',
    blurb: 'Same freight bill as INV-1042 (already paid), resent as “INV1042-A” with a new date.',
    expect: 'rejected',
    invoice: {
      vendor_name: 'Northwind Logistics LLP', vendor_gstin: '29AAFFN5678K1ZJ',
      vendor_address: '88 Peenya Industrial Area, Phase 2, Bengaluru 560058',
      invoice_number: 'INV1042-A', invoice_date: '2026-09-29', due_date: '2026-10-14', po_reference: 'PO-4388',
      buyer_name: BUYER.name, buyer_gstin: BUYER.gstin, currency: 'INR',
      line_items: [
        { description: 'FTL freight Mumbai → Pune (32 ft container)', quantity: 6, unit_price: 18500, amount: 111000 },
        { description: 'Loading & unloading charges', quantity: 6, unit_price: 2000, amount: 12000 },
      ],
      subtotal: 123000,
      tax_lines: [{ label: 'IGST', rate_pct: 18, amount: 22140 }],
      tax_total: 22140, total: 145140, amounts_tax_inclusive: false,
    },
    observations: ['Stamped “PAYMENT REMINDER” at the top of the page.'],
    quality: 'clean',
  },
  {
    id: 's3', email: {"fromName":"Apex Cloud Services","from":"finance@apexcloud.example","subject":"APX-INV-0957 | Managed cloud ops — Milestone 3","receivedAt":"2026-09-25T09:03:00+05:30","body":"Hi team, attaching the milestone 3 invoice for September under PO-2207. Thanks!"}, file: 's3-apex.pdf', kind: 'Edge case',
    title: 'One PO, billed in parts — overrun',
    blurb: '3rd milestone invoice. Looks fine alone, but the three together exceed the PO by ₹45,000.',
    expect: 'needs_review',
    invoice: {
      vendor_name: 'Apex Cloud Services Pvt Ltd', vendor_gstin: '07AAKCA9012M1ZF',
      vendor_address: '4th Floor, Ambience Tower, Nehru Place, New Delhi 110019',
      invoice_number: 'APX-INV-0957', invoice_date: '2026-09-25', due_date: '2026-10-25', po_reference: 'PO-2207',
      buyer_name: BUYER.name, buyer_gstin: BUYER.gstin, currency: 'INR',
      line_items: [
        { description: 'Managed cloud operations — Milestone 3 (September 2026)', quantity: 1, unit_price: 195000, amount: 195000 },
      ],
      subtotal: 195000,
      tax_lines: [{ label: 'IGST', rate_pct: 18, amount: 35100 }],
      tax_total: 35100, total: 230100, amounts_tax_inclusive: false,
    },
    quality: 'clean',
  },
  {
    id: 's4', email: {"fromName":"Kestrel Industrial Supplies","from":"ar@kestrel.example","subject":"Tax invoice KIS/26-27/0412 against PO-4610","receivedAt":"2026-09-30T12:26:00+05:30","body":"Please find our tax invoice for safety gear supplied. Note revised rates due to raw material costs."}, file: 's4-kestrel.pdf', kind: 'Edge case',
    title: 'Close, but not exact',
    blurb: 'Helmets billed 1.5% above PO price (inside tolerance), gloves 6% above (outside).',
    expect: 'needs_review',
    invoice: {
      vendor_name: 'Kestrel Industrial Supplies', vendor_gstin: '24AAGFK3456P1ZX',
      vendor_address: 'Plot 221, GIDC Estate, Vatva, Ahmedabad 382445',
      invoice_number: 'KIS/26-27/0412', invoice_date: '2026-09-30', due_date: '2026-11-14', po_reference: 'PO-4610',
      buyer_name: BUYER.name, buyer_gstin: BUYER.gstin, currency: 'INR',
      line_items: [
        { description: 'Safety helmet, ISI marked, white', quantity: 200, unit_price: 456.75, amount: 91350 },
        { description: 'Nitrile gloves, powder-free (box of 100)', quantity: 150, unit_price: 551.2, amount: 82680 },
        { description: 'Hi-visibility reflective vest', quantity: 200, unit_price: 310, amount: 62000 },
      ],
      subtotal: 236030,
      tax_lines: [{ label: 'IGST', rate_pct: 18, amount: 42485.4 }],
      tax_total: 42485.4, total: 278515.4, amounts_tax_inclusive: false,
    },
    quality: 'clean',
  },
  {
    id: 's5', email: {"fromName":"Greenleaf Facility Services","from":"accounts@greenleaf.example","subject":"Sept bill","receivedAt":"2026-10-01T08:51:00+05:30","body":"Sir, scan of September housekeeping bill attached. Regards, R. Nair"}, file: 's5-greenleaf-scan.pdf', kind: 'Edge case',
    title: 'Scanned, no PO number',
    blurb: 'A phone-scan of a paper invoice. No PO printed — the process has to work out which PO it belongs to.',
    expect: 'needs_review',
    invoice: {
      vendor_name: 'Greenleaf Facility Services', vendor_gstin: '27AADFG7890Q1ZI',
      vendor_address: 'Shop 7, Hiranandani Gardens, Powai, Mumbai 400076',
      invoice_number: 'GFS-1189', invoice_date: '2026-09-30', due_date: '2026-10-30', po_reference: null,
      buyer_name: BUYER.name, buyer_gstin: BUYER.gstin, currency: 'INR',
      line_items: [
        { description: 'Housekeeping staff — September 2026 (8 staff)', quantity: 8, unit_price: 21000, amount: 168000 },
        { description: 'Cleaning consumables — September 2026', quantity: 1, unit_price: 14500, amount: 14500 },
      ],
      subtotal: 182500,
      tax_lines: [{ label: 'CGST', rate_pct: 9, amount: 16425 }, { label: 'SGST', rate_pct: 9, amount: 16425 }],
      tax_total: 32850, total: 215350, amounts_tax_inclusive: false,
    },
    observations: ['Scanned image; slight skew. Handwritten signature over the total.'],
    quality: 'scanned',
    confidence: { vendor_name: 0.95, invoice_number: 0.88, invoice_date: 0.9, po_reference: 0.9, line_items: 0.85, total: 0.93 },
  },
  {
    id: 's6', email: {"fromName":"Zenith Event Caterers","from":"zenithcaterers@gmail.example","subject":"Bill for team offsite lunch","receivedAt":"2026-09-27T19:30:00+05:30","body":"Hello, sharing the bill for the offsite lunch on 26th. Please transfer to the account below. Thanks, Zenith"}, file: 's6-zenith.pdf', kind: 'Edge case',
    title: 'Messy bill from an unknown vendor',
    blurb: 'Caterer not in vendor master, no invoice number, malformed GSTIN, tax buried inside the total.',
    expect: 'rejected',
    invoice: {
      vendor_name: 'Zenith Event Caterers', vendor_gstin: '27ABCDE1234F1Z',
      vendor_address: '3 Marol Pipeline, Andheri East, Mumbai 400059',
      invoice_number: null, invoice_date: '2026-09-27', due_date: null, po_reference: null,
      buyer_name: 'Meridian Retail', buyer_gstin: null, currency: 'INR',
      line_items: [
        { description: 'Lunch buffet for team offsite — 85 pax', quantity: 85, unit_price: 500, amount: 42500 },
        { description: 'Live counter & service staff', quantity: 1, unit_price: 6000, amount: 6000 },
      ],
      subtotal: null, tax_lines: [], tax_total: null, total: 48500, amounts_tax_inclusive: true,
    },
    observations: ['Printed note: “Amount inclusive of all taxes”.', 'Titled “BILL”, not “TAX INVOICE”.'],
    quality: 'clean',
  },
];


export const sampleById = (id) => SAMPLES.find((s) => s.id === id);
