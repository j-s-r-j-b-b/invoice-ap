# Checkpoint AP — invoice PDF → reasoned decision

A working accounts-payable process for **PS-1 (Finance / AP)**. Drop in a vendor invoice (clean PDF, scanned PDF or photo); the process reads it, checks it against the procurement system, and returns **Approved**, **Needs review** or **Rejected**, with every step visible as it runs.

**Core principle: AI reads, rules decide, people handle exceptions.**
- The AI (Claude Opus 5.5) does one job: turn a messy document into structured fields, with a confidence score for each key field. It never makes the decision.
- Deterministic rules make every decision, so each outcome is explainable, repeatable and auditable. Change a rule and the next run changes. No retraining.
- Anything the rules can't clear goes to a review queue. The reason is stated in plain English, a vendor query is drafted where the vendor needs to act, and every human action is written to an audit trail.

## The pipeline

| # | Stage | What it does |
|---|---|---|
| 1 | Receive | Detects file type, whether the PDF has a text layer or is a scan, and takes a SHA-256 fingerprint |
| 2 | Read (AI) | Extracts vendor, GSTIN, invoice no., dates, PO ref, line items, tax lines and totals, plus a confidence per field and "observations" (stamps, wording) |
| 3 | Sanity check | Required fields; line maths; subtotal + tax = total; tax rate maths; **CGST+SGST vs IGST by state code**; our GSTIN present; dates; low-confidence fields |
| 4 | Verify vendor | Vendor master match by GSTIN, then name; GSTIN format; GSTIN mismatch (impersonation signal); blocked vendors |
| 5 | Find PO | Uses the PO quoted on the invoice; if none is printed, **infers** it by scoring every open PO for that vendor (description similarity, fit to remaining balance, recurring-billing history) |
| 6 | Match | Goods: **3-way match** (invoice ↔ PO ↔ goods receipt). Services: 2-way. Unit-price tolerance, quantity billed vs received/ordered, and **cumulative billing across all invoices on the PO** |
| 7 | Duplicate check | Same file fingerprint; **normalised invoice number** (INV-1042 ≡ INV1042-A ≡ inv 01042); same vendor + same amount within N days; also checks invoices still sitting in the review queue |
| 8 | Decision | Any *block* → Rejected; any *warn* → Needs review; otherwise Approved and posted to the ledger |

## Edge cases built

1. **Disguised duplicate**: Northwind resends paid invoice INV-1042 as "INV1042-A" with a new date and a "payment reminder" stamp. Caught by number normalisation; the PO also shows as already fully billed. → **Rejected**, ₹1,45,140 stopped, vendor email drafted.
2. **One PO billed in parts**: Apex's 3rd milestone invoice looks fine on its own, but with the two earlier invoices it takes PO-2207 ₹45,000 (7.5%) over. → **Needs review**, with the cumulative billing bar shown.
3. **Close but not exact**: Kestrel bills helmets +1.5% (inside the 2% tolerance, accepted and noted) and gloves +6% (outside). → **Needs review**, ₹4,680 overcharge. *Live demo:* raise the price tolerance to 7% on the Rules page, re-run, and it is **Approved**.
4. **Scanned, no PO**: an image-only phone scan from Greenleaf. The AI reads it visually; the process infers PO-4720 at 83% confidence and explains why. → **Needs review** with a one-click "Confirm PO-4720 & approve". A guess never releases money on its own (configurable).
5. **Messy bill from an unknown vendor**: a caterer not in the vendor master, with no invoice number, a malformed GSTIN, tax buried in the total and no GSTIN for us. → **Rejected**, and the drafted email asks for onboarding documents and a proper tax invoice.
6. **Bonus**: re-running any approved invoice is rejected as an exact duplicate (file fingerprint).

## Assumptions (made deliberately; to discuss in the interview)
- Indian GST context (₹, GSTIN, CGST/SGST/IGST); the buyer is "Meridian Retail Pvt Ltd", Maharashtra.
- The reference data (vendors, POs, goods receipts, earlier paid invoices) stands in for the ERP. See the **Reference data** page.
- Matching is on pre-tax value. For tax-inclusive bills, the pre-tax value is estimated at 18% and flagged.
- Services have no goods receipt, so they get a 2-way match. Milestone/lump-sum POs are policed on cumulative value.
- Vendor emails are **drafted, never sent**: a human stays in the loop for outbound communication.
- AI confidence is model-reported. It is used only to route fields to a person, never to approve.
- If the AI call fails during a demo, the six samples fall back to a stored reading. This is labelled clearly on screen ("Offline demo mode").

## Running it
- **Live**: Vercel (static frontend + Node serverless functions in `/api`).
- **Environment**: `ANTHROPIC_API_KEY` (or `GEMINI_API_KEY` as a fallback). Run history goes to Upstash Redis via Vercel Storage (`KV_REST_API_URL` / `KV_REST_API_TOKEN`); without it, history falls back to a temporary store.
- **Local**: `node dev.mjs` → http://localhost:5180 (put keys in `.env.local`).
- **Sample PDFs**: `samples/`, generated from `api/_lib/samples.js` by `samples/src/build.sh`.

## Code map
- `api/_lib/pipeline.js`: every stage and rule, and the decision logic
- `api/_lib/extract.js`: the AI extraction (JSON-schema-constrained output)
- `api/_lib/seed.js`: the procurement system (vendor master, POs, GRNs, ledger, default rules)
- `api/process.js`: runs the pipeline and streams each stage to the browser (NDJSON)
- `src/run.js`: live run view · `src/main.js`: dashboard, upload, rules, reference data
