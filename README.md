# Checkpoint AP — invoice PDF → reasoned decision

A working accounts-payable process for **PS-1 (Finance / AP)**. Vendor invoices arrive in an **AP inbox** (or are uploaded: clean PDF, scanned PDF or photo). Each one becomes a **case** that is read, checked against the procurement system and decided, with every step visible as it runs.

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
| 8 | Decision | One of four AP outcomes (below) |

### Four outcomes, because an AP team routes work four ways
| Outcome | When | What happens |
|---|---|---|
| **Approved for payment** | every check passed | posted to the ledger with its due date |
| **Needs approval** | only an internal call is needed: inferred PO, above the auto-approve limit, AI unsure of a field, possible duplicate by amount | an approver decides with a reason, which goes to the audit trail |
| **On hold — vendor query** | the vendor must fix something: overcharge, overbilling, wrong GST, missing GSTIN | a query email is drafted with exactly what to fix; AP marks it sent. Never auto-sent |
| **Rejected** | must not be paid as sent: duplicate, not a valid tax invoice, blocked vendor | an explanation to the vendor is drafted |

Open cases can be **re-checked with the current rules**. The same case is re-decided (the document isn't re-read) and the earlier decision is kept in its history. A case never collides with itself in duplicate detection.


## Edge cases built

1. **Disguised duplicate**: Northwind resends paid invoice INV-1042 as "INV1042-A" with a new date and a "payment reminder" stamp. Caught by number normalisation; the PO also shows as already fully billed. → **Rejected**, ₹1,45,140 stopped, vendor email drafted.
2. **One PO billed in parts**: Apex's 3rd milestone invoice looks fine on its own, but with the two earlier invoices it takes PO-2207 ₹45,000 (7.5%) over. → **On hold — vendor query** (revise to ₹1,50,000 or share a change order), with the cumulative billing bar shown.
3. **Close but not exact**: Kestrel bills helmets +1.5% (inside the 2% tolerance, accepted and noted) and gloves +6% (outside). → **On hold — vendor query**, ₹4,680 overcharge, credit note requested. *Live demo:* procurement agreed the new price, so raise the tolerance to 7% on Rules, then press **Re-check** on the same case → **Approved for payment**, with the earlier hold kept in the case history.
4. **Scanned, no PO**: an image-only phone scan from Greenleaf. The AI reads it visually; the process infers PO-4720 at 83% confidence and explains why. → **Needs approval** with a one-click "Confirm PO-4720 & approve". A guess never releases money on its own (configurable).
5. **Messy bill from an unknown vendor**: a caterer not in the vendor master, with no invoice number, a malformed GSTIN, tax buried in the total and no GSTIN for us. → **Rejected**, and the drafted email asks for onboarding documents and a proper tax invoice.
6. **Bundled line items** (handled in logic): if an invoice bills a multi-line PO as one lump line, it is matched on value (whole PO or remaining balance) instead of failing line matching. For goods, it checks that everything was received.
7. **Exact re-send**: a vendor emailing the identical PDF again is caught by file fingerprint.

## Assumptions (made deliberately; to discuss in the interview)
- Indian GST context (₹, GSTIN, CGST/SGST/IGST); the buyer is "Meridian Retail Pvt Ltd", Maharashtra.
- The reference data (vendors, POs, goods receipts, earlier paid invoices) stands in for the ERP. See the **Reference data** page.
- Matching is on pre-tax value. For tax-inclusive bills, the pre-tax value is estimated at 18% and flagged.
- Services have no goods receipt, so they get a 2-way match. Milestone/lump-sum POs are policed on cumulative value.
- Vendor emails are **drafted, never sent**: a human stays in the loop for outbound communication.
- AI confidence is model-reported. It is used only to route fields to a person, never to approve.
- If the AI can't read a document (service down, unreadable scan), the case is routed to **Manual entry needed**. No invented data.
- The inbox is a simulated mailbox containing six real PDFs. In production this would be an email webhook (e.g. a forwarding address) feeding the same /api/process endpoint.

## Running it
- **Live**: Vercel (static frontend + Node serverless functions in `/api`).
- **Environment**: `ANTHROPIC_API_KEY` (or `GEMINI_API_KEY` as a fallback). Run history goes to Upstash Redis via Vercel Storage (`KV_REST_API_URL` / `KV_REST_API_TOKEN`); without it, history falls back to a temporary store.
- **Local**: `node dev.mjs` → http://localhost:5180 (put keys in `.env.local`). `DEV_FIXTURE=1` simulates the AI step for the six sample files, for UI work only. It is never used in production.
- **Sample PDFs**: `samples/`, generated from `api/_lib/samples.js` by `samples/src/build.sh`.

## Code map
- `api/_lib/pipeline.js`: every stage and rule, and the decision logic
- `api/_lib/extract.js`: the AI extraction (JSON-schema-constrained output)
- `api/_lib/seed.js`: the procurement system (vendor master, POs, GRNs, ledger, default rules)
- `api/process.js`: runs the pipeline and streams each stage to the browser (NDJSON)
- `src/run.js`: live run view · `src/main.js`: dashboard, upload, rules, reference data
