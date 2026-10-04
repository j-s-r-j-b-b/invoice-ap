// GET  /api/runs               → all cases (newest first, slim)
// GET  /api/runs?id=C-xxx      → one case
// GET  /api/runs?file=C-xxx    → the original document of a case
// POST /api/runs {id, action, note, reviewer}
//      action: 'approve' | 'reject'  → human decision on an open case (note required, audited)
//              'query_sent'          → AP marks the vendor query as sent (case stays on hold)
import { readBody, send, query } from './_lib/http.js';
import { listRuns, getRun, saveRun, addToLedger, getFile } from './_lib/store.js';
import { ledgerEntryFromRun, PENDING } from './_lib/pipeline.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { id, file } = query(req);
      if (file) {
        const f = await getFile(file);
        if (!f) return send(res, 404, { error: 'Original document not stored' });
        res.statusCode = 200;
        res.setHeader('Content-Type', f.mimeType);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.end(Buffer.from(f.base64, 'base64'));
      }
      if (id) { const r = await getRun(id); return r ? send(res, 200, r) : send(res, 404, { error: 'Case not found' }); }
      const runs = await listRuns();
      return send(res, 200, runs.map(({ stages, rulesUsed, ...rest }) => rest));
    }
    if (req.method === 'POST') {
      const { id, action, note, reviewer } = await readBody(req);
      const run = await getRun(id);
      if (!run) return send(res, 404, { error: 'Case not found' });
      if (!PENDING.includes(run.decision.status)) return send(res, 409, { error: 'This case is already closed' });
      const at = new Date().toISOString();
      const who = (reviewer || 'AP team').slice(0, 60);
      if (action === 'query_sent') {
        run.vendorQuery = { at, who };
        run.audit.push({ at, who, what: `Sent the query to ${run.decision.email?.to || 'the vendor'} — awaiting reply` });
        await saveRun(run);
        return send(res, 200, run);
      }
      if (!['approve', 'reject'].includes(action)) return send(res, 400, { error: 'Unknown action' });
      if (!note || !note.trim()) return send(res, 400, { error: 'A reason is required — it goes in the audit trail' });
      const override = run.decision.status === 'vendor_hold' && action === 'approve';
      run.review = { action, note: note.slice(0, 500), who, at, previous: run.decision.status, override };
      run.decision = {
        ...run.decision,
        status: action === 'approve' ? 'approved' : 'rejected',
        label: action === 'approve' ? (override ? 'Approved (override)' : 'Approved for payment') : 'Rejected',
        nextAction: action === 'approve' ? `Approved by ${who}; posted to the ledger for payment.` : `Rejected by ${who}; not to be paid.`,
      };
      run.audit.push({ at, who, what: `${action === 'approve' ? (override ? 'Overrode the hold and approved' : 'Approved') : 'Rejected'} — “${note.slice(0, 160)}”` });
      if (action === 'approve') await addToLedger(ledgerEntryFromRun(run));
      await saveRun(run);
      return send(res, 200, run);
    }
    send(res, 405, { error: 'Method not allowed' });
  } catch (e) { send(res, 500, { error: e.message }); }
}
