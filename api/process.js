// POST /api/process — runs one invoice through the pipeline, streaming NDJSON events.
//   { base64, mimeType, filename, inboxId? }  → a new case
//   { recheck: caseId }                        → re-apply current rules to an existing case (same id, new version)
import { readBody, send } from './_lib/http.js';
import { runPipeline, ledgerEntryFromRun, PENDING } from './_lib/pipeline.js';
import { getRules, getLedger, listRuns, getRun, saveRun, addToLedger, saveFile } from './_lib/store.js';

const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const newId = () => 'C-' + Date.now().toString(36).slice(-4).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  let body;
  try { body = await readBody(req); } catch { return send(res, 400, { error: 'Invalid JSON' }); }

  let prev = null;
  if (body.recheck) {
    prev = await getRun(body.recheck);
    if (!prev) return send(res, 404, { error: 'Case not found' });
    if (!PENDING.includes(prev.decision.status)) return send(res, 409, { error: 'Only open cases can be re-checked' });
  } else if (!body.base64 || !ALLOWED.includes(body.mimeType)) return send(res, 400, { error: 'Send a PDF, PNG, JPG or WEBP file.' });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  const emit = (e) => res.write(JSON.stringify(e) + '\n');

  const id = prev ? prev.id : newId();
  const startedAt = new Date().toISOString();
  emit({ type: 'run', id, startedAt, recheck: !!prev });
  try {
    const [rules, ledger, runs] = await Promise.all([getRules(), getLedger(), listRuns()]);
    const ctx = {
      caseId: id, rules, today: startedAt.slice(0, 10),
      ledger: ledger.filter((l) => l.runId !== id),
      runs: runs.filter((r) => r.id !== id),
      input: prev ? { ...prev.source } : { base64: body.base64, mimeType: body.mimeType, filename: body.filename || 'invoice' },
      previousRead: prev ? prev.stages.find((s) => s.id === 'read' && s.status !== 'fail') : null,
    };
    if (prev && !ctx.previousRead) throw new Error('This case was never read successfully — upload the document again.');
    const { stages, decision } = await runPipeline(ctx, emit);
    const x = ctx.x || {};
    const run = {
      ...(prev || {}),
      id, createdAt: prev ? prev.createdAt : startedAt, finishedAt: new Date().toISOString(),
      source: prev ? prev.source : { filename: ctx.input.filename, mimeType: body.mimeType, inboxId: body.inboxId || null, hash: ctx.hash, format: ctx.format, channel: body.inboxId ? 'AP inbox' : 'Upload' },
      vendorId: ctx.vendor?.id || null, vendorName: ctx.vendor?.name || x.vendor_name || 'Unknown vendor',
      invoiceNumber: x.invoice_number || null, invoiceDate: x.invoice_date || null,
      po: ctx.po?.po || null, poInferred: !!ctx.poInferred, subtotal: ctx.subtotal ?? null, total: x.total ?? null,
      rulesUsed: rules, stages, decision, review: null, version: (prev?.version || 1) + (prev ? 1 : 0),
      history: prev ? [...(prev.history || []), { at: prev.finishedAt, label: prev.decision.label, status: prev.decision.status, headline: prev.decision.headline }] : [],
      audit: [...(prev?.audit || []), { at: startedAt, who: 'system', what: prev ? `Re-checked with current rules → ${decision.label}` : `Received via ${body.inboxId ? 'AP inbox' : 'upload'} and processed → ${decision.label}` }],
    };
    if (!prev && body.base64) await saveFile(id, { mimeType: body.mimeType, base64: body.base64 });
    if (decision.status === 'approved') await addToLedger(ledgerEntryFromRun(run));
    await saveRun(run);
    emit({ type: 'done', run });
  } catch (e) {
    emit({ type: 'error', message: e.message });
  }
  res.end();
}
