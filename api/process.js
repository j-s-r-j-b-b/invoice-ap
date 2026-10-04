// POST /api/process — runs one invoice through the pipeline, streaming NDJSON events.
import { readBody, send } from './_lib/http.js';
import { runPipeline, ledgerEntryFromRun } from './_lib/pipeline.js';
import { getRules, getLedger, listRuns, saveRun, addToLedger } from './_lib/store.js';

const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const newId = () => 'R-' + Date.now().toString(36).slice(-4).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  let input;
  try { input = await readBody(req); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
  if (!input.base64 || !ALLOWED.includes(input.mimeType)) return send(res, 400, { error: 'Send a PDF, PNG, JPG or WEBP file.' });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  const emit = (e) => res.write(JSON.stringify(e) + '\n');

  const id = newId();
  const startedAt = new Date().toISOString();
  emit({ type: 'run', id, startedAt });
  try {
    const [rules, ledger, runs] = await Promise.all([getRules(), getLedger(), listRuns()]);
    const ctx = { input: { ...input, filename: input.filename || 'invoice' }, rules, ledger, runs, today: startedAt.slice(0, 10) };
    const { stages, decision } = await runPipeline(ctx, emit);
    const x = ctx.x || {};
    const run = {
      id, createdAt: startedAt, finishedAt: new Date().toISOString(),
      source: { filename: ctx.input.filename, sampleId: input.sampleId || null, hash: ctx.hash, format: ctx.format },
      vendorId: ctx.vendor?.id || null, vendorName: ctx.vendor?.name || x.vendor_name || 'Unknown vendor',
      invoiceNumber: x.invoice_number || null, invoiceDate: x.invoice_date || null,
      po: ctx.po?.po || null, poInferred: !!ctx.poInferred, subtotal: ctx.subtotal ?? null, total: x.total ?? null,
      rulesUsed: rules, stages, decision, review: null,
      audit: [{ at: startedAt, who: 'system', what: `Processed — ${decision.label}` }],
    };
    if (decision.status === 'approved') await addToLedger(ledgerEntryFromRun(run));
    await saveRun(run);
    emit({ type: 'done', run });
  } catch (e) {
    emit({ type: 'error', message: e.message });
  }
  res.end();
}
