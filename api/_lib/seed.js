// Reference data for the demo company "Meridian Retail Pvt Ltd".
// This is the "procurement system" side: vendor master, purchase orders,
// goods receipts, and invoices already processed before this tool existed.

export const COMPANY = {
  name: 'Meridian Retail Pvt Ltd',
  gstin: '27AAECM4321J1Z3',
  address: 'Unit 4, Lotus Corporate Park, Goregaon East, Mumbai 400063',
};

export const VENDORS = [
  { id: 'V001', name: 'Brightline Office Supplies Pvt Ltd', gstin: '27AABCB1234F1Z5', state: 'Maharashtra', email: 'accounts@brightline.example', bank: 'HDFC Bank ••4521', terms: 30, status: 'active' },
  { id: 'V002', name: 'Northwind Logistics LLP', gstin: '29AAFFN5678K1Z2', state: 'Karnataka', email: 'billing@northwind.example', bank: 'ICICI Bank ••7310', terms: 15, status: 'active' },
  { id: 'V003', name: 'Apex Cloud Services Pvt Ltd', gstin: '07AAKCA9012M1Z8', state: 'Delhi', email: 'finance@apexcloud.example', bank: 'Axis Bank ••0098', terms: 30, status: 'active' },
  { id: 'V004', name: 'Kestrel Industrial Supplies', gstin: '24AAGFK3456P1Z4', state: 'Gujarat', email: 'ar@kestrel.example', bank: 'Kotak Bank ••6642', terms: 45, status: 'active' },
  { id: 'V005', name: 'Greenleaf Facility Services', gstin: '27AADFG7890Q1Z6', state: 'Maharashtra', email: 'accounts@greenleaf.example', bank: 'SBI ••2287', terms: 30, status: 'active' },
  { id: 'V006', name: 'Orbit Print Solutions', gstin: '27AAHCO2345R1Z9', state: 'Maharashtra', email: 'hello@orbitprint.example', bank: 'Under verification', terms: 30, status: 'blocked', blockReason: 'Bank account change request under verification' },
];

// type 'goods' → three-way match (PO + goods receipt + invoice)
// type 'service' → two-way match (PO + invoice); lines with unitPrice are rate cards,
// lines without unitPrice are lump-sum / milestone budgets.
export const PURCHASE_ORDERS = [
  {
    po: 'PO-4501', vendorId: 'V001', type: 'goods', date: '2026-09-10', status: 'open',
    title: 'Office consumables — Q3 restock',
    lines: [
      { line: 1, description: 'A4 copier paper 75 GSM (box of 5 reams)', qty: 40, unitPrice: 1450 },
      { line: 2, description: 'HP 76A black toner cartridge', qty: 12, unitPrice: 6200 },
      { line: 3, description: 'Whiteboard markers, assorted (pack of 10)', qty: 30, unitPrice: 380 },
    ],
  },
  {
    po: 'PO-4388', vendorId: 'V002', type: 'service', date: '2026-08-28', status: 'open',
    title: 'Freight — Mumbai DC to Pune stores (September)',
    lines: [
      { line: 1, description: 'FTL freight Mumbai to Pune (32 ft container)', qty: 6, unitPrice: 18500 },
      { line: 2, description: 'Loading & unloading charges', qty: 6, unitPrice: 2000 },
    ],
  },
  {
    po: 'PO-2207', vendorId: 'V003', type: 'service', date: '2026-04-02', status: 'open',
    title: 'Managed cloud operations FY26-27 (milestone billing)',
    lines: [
      { line: 1, description: 'Managed cloud operations FY26-27 — milestone billing', qty: 1, amount: 600000 },
    ],
  },
  {
    po: 'PO-4610', vendorId: 'V004', type: 'goods', date: '2026-09-15', status: 'open',
    title: 'Warehouse safety gear',
    lines: [
      { line: 1, description: 'Safety helmet, ISI marked, white', qty: 200, unitPrice: 450 },
      { line: 2, description: 'Nitrile gloves, powder-free (box of 100)', qty: 150, unitPrice: 520 },
      { line: 3, description: 'Hi-visibility reflective vest', qty: 200, unitPrice: 310 },
    ],
  },
  {
    po: 'PO-4720', vendorId: 'V005', type: 'service', date: '2026-04-01', status: 'open',
    title: 'Housekeeping services — head office FY26-27',
    lines: [
      { line: 1, description: 'Housekeeping staff (per staff per month)', qty: 96, unitPrice: 21000 },
      { line: 2, description: 'Cleaning consumables (monthly)', qty: 12, unitPrice: 14500 },
    ],
  },
  {
    po: 'PO-4733', vendorId: 'V005', type: 'service', date: '2026-04-01', status: 'open',
    title: 'Pest control — quarterly',
    lines: [
      { line: 1, description: 'Quarterly pest control service', qty: 4, unitPrice: 22000 },
    ],
  },
  {
    po: 'PO-4602', vendorId: 'V006', type: 'goods', date: '2026-09-12', status: 'open',
    title: 'Festive in-store signage',
    lines: [
      { line: 1, description: 'Vinyl standee 6x3 ft, printed', qty: 40, unitPrice: 1850 },
    ],
  },
];

export const GOODS_RECEIPTS = [
  { grn: 'GRN-9101', po: 'PO-4501', date: '2026-09-26', lines: [{ line: 1, qty: 40 }, { line: 2, qty: 12 }, { line: 3, qty: 30 }] },
  { grn: 'GRN-9140', po: 'PO-4610', date: '2026-09-29', lines: [{ line: 1, qty: 200 }, { line: 2, qty: 150 }, { line: 3, qty: 200 }] },
];

// Invoices already booked in the ERP before this run history started.
// lines: [{ poLine, qty, amount }] lets cumulative / received-vs-billed checks work.
const gfs = (num, date) => ({
  vendorId: 'V005', invoiceNumber: num, date, po: 'PO-4720', subtotal: 182500, total: 215350, status: 'paid', source: 'ERP history',
  lines: [{ poLine: 1, qty: 8, amount: 168000 }, { poLine: 2, qty: 1, amount: 14500 }],
});
export const LEDGER = [
  { vendorId: 'V002', invoiceNumber: 'INV-1042', date: '2026-09-12', po: 'PO-4388', subtotal: 123000, total: 145140, status: 'paid', paidOn: '2026-09-20', source: 'ERP history',
    lines: [{ poLine: 1, qty: 6, amount: 111000 }, { poLine: 2, qty: 6, amount: 12000 }] },
  { vendorId: 'V003', invoiceNumber: 'APX-INV-0881', date: '2026-07-15', po: 'PO-2207', subtotal: 240000, total: 283200, status: 'paid', source: 'ERP history',
    lines: [{ poLine: 1, qty: 1, amount: 240000 }] },
  { vendorId: 'V003', invoiceNumber: 'APX-INV-0912', date: '2026-08-20', po: 'PO-2207', subtotal: 210000, total: 247800, status: 'paid', source: 'ERP history',
    lines: [{ poLine: 1, qty: 1, amount: 210000 }] },
  gfs('GFS-1101', '2026-04-30'),
  gfs('GFS-1124', '2026-05-31'),
  gfs('GFS-1139', '2026-06-30'),
  gfs('GFS-1152', '2026-07-31'),
  gfs('GFS-1170', '2026-08-31'),
  { vendorId: 'V001', invoiceNumber: 'BOS/26-27/0244', date: '2026-08-04', po: 'PO-4410', subtotal: 52600, total: 62068, status: 'paid', source: 'ERP history', lines: [] },
];

export const DEFAULT_RULES = {
  priceTolerancePct: 2,        // unit price may exceed PO price by this % and still auto-approve
  poOverrunTolerancePct: 2,    // cumulative billing may exceed PO value by this %
  amountMatchTolerance: 1,     // ₹ rounding allowed in arithmetic checks
  autoApproveLimit: 500000,    // invoices above this total always need a human
  duplicateWindowDays: 15,     // same vendor + same amount within N days = possible duplicate
  minConfidence: 0.8,          // AI-reported confidence below this → human verifies the field
  maxInvoiceAgeDays: 180,
  allowInferredPoAutoApprove: false, // an inferred PO match never auto-approves unless this is on
};
