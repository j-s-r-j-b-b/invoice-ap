// GET  /api/meta          → reference data, rules, samples, environment status
// POST /api/meta {rules}  → save rules
// POST /api/meta {reset}  → wipe runs, ledger and rules back to the seed
import { readBody, send } from './_lib/http.js';
import { COMPANY, VENDORS, PURCHASE_ORDERS, GOODS_RECEIPTS, DEFAULT_RULES } from './_lib/seed.js';
import { SAMPLES } from './_lib/samples.js';
import { getRules, saveRules, getLedger, resetAll, storeKind } from './_lib/store.js';
import { extractorKind } from './_lib/extract.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (body.reset) { await resetAll(); return send(res, 200, { ok: true }); }
      if (body.rules) {
        const clean = {};
        for (const [k, def] of Object.entries(DEFAULT_RULES)) {
          const v = body.rules[k];
          if (v === undefined) continue;
          if (typeof def === 'boolean') clean[k] = !!v;
          else { const n = Number(v); if (Number.isFinite(n) && n >= 0) clean[k] = n; }
        }
        return send(res, 200, { rules: await saveRules({ ...(await getRules()), ...clean }) });
      }
      return send(res, 400, { error: 'Nothing to do' });
    }
    send(res, 200, {
      company: COMPANY, vendors: VENDORS, purchaseOrders: PURCHASE_ORDERS, goodsReceipts: GOODS_RECEIPTS,
      ledger: await getLedger(), rules: await getRules(), defaultRules: DEFAULT_RULES,
      inbox: SAMPLES.map(({ id, file, email }) => ({ id, file, ...email })).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
      env: { extractor: extractorKind(), store: storeKind },
    });
  } catch (e) { send(res, 500, { error: e.message }); }
}
