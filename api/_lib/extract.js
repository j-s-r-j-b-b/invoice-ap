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
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
}

export async function extract({ base64, mimeType }) {
  const kind = extractorKind();
  if (kind === 'claude') return { data: await viaClaude(base64, mimeType), model: 'claude-opus-5-5' };
  if (kind === 'gemini') return { data: await viaGemini(base64, mimeType), model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' };
  throw new Error('No AI key configured');
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

async function viaGemini(base64, mimeType) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: PROMPT + '\n\nReturn ONLY JSON matching this JSON Schema:\n' + JSON.stringify(SCHEMA) },
      ] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Gemini: ' + (j.error?.message || r.status));
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
  if (!text) throw new Error('AI returned no data');
  return JSON.parse(text);
}
