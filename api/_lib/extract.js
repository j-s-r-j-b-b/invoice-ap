// AI extraction: PDF / image → structured invoice fields with per-field confidence.
// The AI only READS. Every decision afterwards is made by deterministic rules.
import Anthropic from '@anthropic-ai/sdk';

const str = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const num = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const SCHEMA = obj({
  vendor_name: str, vendor_gstin: str, vendor_address: str,
  invoice_number: str,
  invoice_date: { ...str, description: 'YYYY-MM-DD' },
  due_date: { ...str, description: 'YYYY-MM-DD' },
  po_reference: { ...str, description: 'Purchase order number exactly as printed, or null if none is printed' },
  buyer_name: str, buyer_gstin: str, currency: str,
  line_items: { type: 'array', items: obj({ description: { type: 'string' }, quantity: num, unit_price: num, amount: num }) },
  subtotal: num,
  tax_lines: { type: 'array', items: obj({ label: { type: 'string' }, rate_pct: num, amount: num }) },
  tax_total: num, total: num,
  amounts_tax_inclusive: { type: 'boolean' },
  document_quality: { type: 'string', enum: ['clean', 'scanned', 'poor'] },
  confidence: obj({ vendor_name: { type: 'number' }, invoice_number: { type: 'number' }, invoice_date: { type: 'number' }, po_reference: { type: 'number' }, line_items: { type: 'number' }, total: { type: 'number' } }),
  observations: { type: 'array', items: { type: 'string' } },
});

const PROMPT = `You are the data-capture step of an accounts-payable pipeline. Read the attached vendor invoice and return its fields as JSON matching the schema.

Rules:
- Transcribe only what is printed. Never invent or infer a value: if a field is not printed, return null (e.g. no PO number printed → po_reference null; no invoice number → invoice_number null).
- Dates as YYYY-MM-DD. Amounts as plain numbers (no currency symbols or thousands separators).
- subtotal = pre-tax total if printed; tax_lines = each tax printed separately (CGST/SGST/IGST/VAT etc.).
- If the document says amounts include tax and shows no separate tax, set amounts_tax_inclusive true, tax_lines [], subtotal null.
- confidence: 0-1 for how sure you are that each field is read correctly (for a null field: how sure you are it is truly absent). Lower it for blurry, handwritten, cropped or ambiguous text.
- observations: short notes a careful AP clerk would flag (stamps like "duplicate"/"reminder", handwritten edits, wording like "bill" vs "tax invoice", mismatched totals). Empty array if none.`;

export function extractorKind() {
  if (globalThis.__devExtract) return 'dev-fixture'; // local UI testing only (dev.mjs with DEV_FIXTURE=1); never set on Vercel
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
}

export async function extract(input) {
  const kind = extractorKind();
  if (kind === 'dev-fixture') return globalThis.__devExtract(input);
  if (kind === 'claude') return { data: normalize(await viaClaude(input.base64, input.mimeType)), model: 'claude-opus-5-5' };
  if (kind === 'gemini') { const out = await viaGemini(input.base64, input.mimeType); return { data: normalize(out.data), model: out.model }; }
  throw new Error('No AI key configured');
}

// Models can return "1,43,800.00" or "₹ 58,000" as strings, omit keys, or nest oddly.
// Coerce everything to the exact shape the rules expect, so the rules never see garbage.
const toNum = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) && /\d/.test(String(v)) ? n : null;
};
const toStr = (v) => (v == null || String(v).trim() === '' || /^(null|n\/a|none|-)$/i.test(String(v).trim()) ? null : String(v).trim());
const toDate = (v) => {
  const s = toStr(v);
  if (!s) return null;
  const pad = (n) => String(n).padStart(2, '0');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/); // Indian invoices are day-first: 05/10/2026 = 5 Oct
  if (dmy) return `${dmy[3]}-${pad(dmy[2])}-${pad(dmy[1])}`;
  const d = new Date(s.replace(/-/g, ' '));
  return Number.isNaN(d.getTime()) ? s : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const toConf = (v) => { const n = toNum(v); return n == null ? 0.5 : n > 1 ? Math.min(1, n / 100) : Math.max(0, n); };
export function normalize(raw) {
  const x = raw && typeof raw === 'object' ? raw : {};
  const c = x.confidence || {};
  return {
    vendor_name: toStr(x.vendor_name), vendor_gstin: toStr(x.vendor_gstin)?.toUpperCase().replace(/\s/g, '') || null, vendor_address: toStr(x.vendor_address),
    invoice_number: toStr(x.invoice_number), invoice_date: toDate(x.invoice_date), due_date: toDate(x.due_date), po_reference: toStr(x.po_reference),
    buyer_name: toStr(x.buyer_name), buyer_gstin: toStr(x.buyer_gstin)?.toUpperCase().replace(/\s/g, '') || null, currency: toStr(x.currency) || 'INR',
    line_items: (Array.isArray(x.line_items) ? x.line_items : []).map((l) => ({ description: toStr(l?.description) || '(no description)', quantity: toNum(l?.quantity), unit_price: toNum(l?.unit_price), amount: toNum(l?.amount) })),
    subtotal: toNum(x.subtotal),
    tax_lines: (Array.isArray(x.tax_lines) ? x.tax_lines : []).map((t) => ({ label: toStr(t?.label) || 'Tax', rate_pct: toNum(t?.rate_pct), amount: toNum(t?.amount) })).filter((t) => t.amount != null),
    tax_total: toNum(x.tax_total), total: toNum(x.total),
    amounts_tax_inclusive: x.amounts_tax_inclusive === true || x.amounts_tax_inclusive === 'true',
    document_quality: ['clean', 'scanned', 'poor'].includes(x.document_quality) ? x.document_quality : 'clean',
    confidence: Object.fromEntries(['vendor_name', 'invoice_number', 'invoice_date', 'po_reference', 'line_items', 'total'].map((k) => [k, toConf(c[k])])),
    observations: (Array.isArray(x.observations) ? x.observations : []).map(toStr).filter(Boolean).slice(0, 6),
  };
}

async function viaClaude(base64, mimeType) {
  const client = new Anthropic();
  const block = mimeType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } };
  const res = await client.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [block, { type: 'text', text: PROMPT }] }],
  });
  if (res.stop_reason === 'refusal') throw new Error('AI declined to read this document');
  if (res.stop_reason === 'max_tokens') throw new Error('AI output was cut off');
  const text = res.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('AI returned no data');
  return JSON.parse(text);
}

// Tries the configured model first, then fallbacks — Google retires model names over time,
// and a 404 / overloaded model during a live demo shouldn't stop the process.
// Order chosen by measurement on the free tier (Oct 2026): 3.6-flash answered every time in ~6s;
// the newest flash models were frequently "high demand" (503) or over the free quota (429).
const GEMINI_MODELS = [process.env.GEMINI_MODEL, 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'].filter(Boolean);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function viaGemini(base64, mimeType) {
  let lastErr;
  const attempts = [...new Set(GEMINI_MODELS)].flatMap((m, i) => (i === 0 ? [m, m] : [m])); // primary gets one retry
  for (const [n, model] of attempts.entries()) {
    if (n > 0 && /503|429|demand|overloaded|quota|rate/i.test(lastErr?.message || '')) await wait(1200);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: PROMPT + '\n\nReturn ONLY a JSON object matching this JSON Schema (all keys required, use null when absent):\n' + JSON.stringify(SCHEMA) },
          ] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        lastErr = new Error(`Gemini ${model}: ${j.error?.message || r.status}`);
        if ([400, 401, 403].includes(r.status) && !/model/i.test(j.error?.message || '')) throw lastErr; // bad key/request: don't retry
        continue; // 404 retired model, 429 rate limit, 5xx overloaded → next model
      }
      const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
      if (!text) { lastErr = new Error(`Gemini ${model}: empty response (${j.candidates?.[0]?.finishReason || 'unknown'})`); continue; }
      const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      return { data: Array.isArray(json) ? json[0] : json, model };
    } catch (e) {
      lastErr = e;
      if (/key|permission|denied|invalid argument/i.test(e.message)) throw e;
    }
  }
  throw lastErr || new Error('Gemini: no model available');
}
