// GET  /api/runs            → all runs (newest first, slim)
// GET  /api/runs?id=R-xxx   → one run
// POST /api/runs {id, action: 'approve'|'reject', note, reviewer} → human review decision
import { readBody, send, query } from './_lib/http.js';
import { listRuns, getRun, saveRun, addToLedger } from './_lib/store.js';
import { ledgerEntryFromRun } from './_lib/pipeline.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { id } = query(req);
      if (id) { const r = await getRun(id); return r ? send(res, 200, r) : send(res, 404, { error: 'Run not found' }); }
      const runs = await listRuns();
      return send(res, 200, runs.map(({ stages, rulesUsed, ...rest }) => rest));
    }
    if (req.method === 'POST') {
      const { id, action, note, reviewer } = await readBody(req);
      const run = await getRun(id);
      if (!run) return send(res, 404, { error: 'Run not found' });
      if (run.decision.status !== 'needs_review') return send(res, 409, { error: 'Only held invoices can be reviewed' });
      if (!['approve', 'reject'].includes(action)) return send(res, 400, { error: 'Bad action' });
      if (!note || !note.trim()) return send(res, 400, { error: 'A note is required for the audit trail' });
      const at = new Date().toISOString();
      const who = (reviewer || 'AP reviewer').slice(0, 60);
      run.review = { action, note: note.slice(0, 500), who, at, previous: run.decision.status };
      run.decision = {
        ...run.decision,
        status: action === 'approve' ? 'approved' : 'rejected',
        label: action === 'approve' ? 'Approved (manual)' : 'Rejected (manual)',
        nextAction: action === 'approve' ? 'Approved by a person with a note; posted to the ledger for payment.' : 'Rejected by a person; vendor to be informed.',
      };
      run.audit.push({ at, who, what: `${action === 'approve' ? 'Approved' : 'Rejected'} after review — “${note.slice(0, 140)}”` });
      if (action === 'approve') await addToLedger(ledgerEntryFromRun(run));
      await saveRun(run);
      return send(res, 200, run);
    }
    send(res, 405, { error: 'Method not allowed' });
  } catch (e) { send(res, 500, { error: e.message }); }
}
