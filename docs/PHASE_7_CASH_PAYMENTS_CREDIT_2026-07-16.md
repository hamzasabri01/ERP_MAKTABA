# Phase 7 — Cash, Payments, and Credit Integrity

Date: 2026-07-16  
Status: Complete

## Objective

Turn payments into an immutable ledger, link every new cash settlement to an
open cash session, prevent concurrent cash openings, control session closing
differences, and derive customer credit from documents and ledger payments.

## Pre-change evidence

- Cash session uniqueness was enforced only by an application query.
- A cash payment was accepted without an open session; the cash movement was
  silently skipped.
- `payments` contained `0` rows while:
  - `186` sales had a positive paid amount;
  - `7` purchases had a positive paid amount;
  - `20` expenses represented settled costs.
- Seven customer balances were stored as zero while open invoice balances were
  non-zero.
- Payments had no unique payment reference, cash-session link, or cash
  transaction link.
- Closing stored expected, actual, and difference, but had no mandatory reason,
  approver, closer, or optimistic version.

The existing open cash session (`id=2`, opening balance `500 MAD`) was preserved
without closing it or modifying its balance.

## Backup

- File:
  `backend/backups/proerp-backup-20260716-153818.zip`
- Size: `179074` bytes
- SHA-256:
  `C78746F54141576646B0548710B32C7310F234A8B87E9F08CFE371596592674A`
- Database inside the archive:
  - `integrity_check = ok`;
  - no foreign-key violations;
  - original cash, sales, purchase, payment, and customer counts readable.

## Schema and migration

Migration:

`backend/migrations/phase7_cash_payments_credit.py`

### Cash sessions

- Partial unique database index permits only one row with `status='open'`.
- Added optimistic `version`.
- Added `closed_by`.
- Added `difference_reason`.
- Added `approved_by` and `approved_at`.

### Cash transactions

- Added immutable `operation_key`.
- Added `kind` (`movement` or `reversal`).
- Added unique `reverses_transaction_id`.
- Added unique `payment_id` link.

### Payments

- Added unique `payment_reference`.
- Added unique `operation_key`.
- Enforced one reversal per original payment.
- Added `cash_session_id`.
- Added relationship to the matching cash transaction.

### Historical backfill

The migration created one traceable legacy ledger entry for each historical
settled document:

- Sales: `186`
- Purchases: `7`
- Expenses: `20`
- Total: `213`

Historical payment methods are stored as `legacy`, because the original cash
session cannot be reconstructed safely. The original method is retained in the
payment note. No historical payment was incorrectly attached to the current
cash session.

All `213` payment references and all `213` operation keys are unique. Sales and
purchase `paid_amount` values match their payment ledger totals exactly.

Customer balances were recalculated after preserving their original values in
a migration rollback table.

## Business controls

### Cash payments

- New cash payments require an open session.
- Sales, purchases, supplier/customer credit settlements, POS settlements, and
  cash expenses use the same payment helper.
- A privileged exceptional request can bypass the open-session rule only with
  `cash.payment_without_session`.
- Card, bank, and cheque settlements do not create cash transactions.
- `credit` is not accepted as a settlement because it leaves the document
  balance open.

### Payment ledger

- `paid_amount` is synchronized from the sum of payment and reversal entries.
- Partial payments remain supported.
- Replaying an idempotency key returns the existing payment effect.
- Payments are never deleted.
- Cancellation and expense corrections create linked reversals.
- Cash reversals create the opposite movement in the currently open session.

### Expenses

- Creating an expense creates a payment ledger entry.
- A cash expense requires an open cash session and records an outbound movement.
- Updating an expense reverses its previous payment before recording the
  replacement.
- Deleting an expense reverses its payment entries; payment history remains.

### Credit

- Customer open credit is calculated from active invoices and payment ledger
  entries.
- The cached `clients.credit_balance` is synchronized through one service.
- Supplier open balances are calculated from payable purchases and their
  payment ledger entries.
- A credit reconciliation endpoint reports stored/calculated mismatches.

### Cash closing

Closing records:

- expected balance;
- counted/actual balance;
- difference;
- mandatory reason when difference is non-zero;
- closer;
- approver and approval timestamp when the absolute difference exceeds the
  configured threshold;
- optimistic document version.

A closed session rejects new adjustments.

### Permissions

Action-level cash permissions were added:

- `cash.read`
- `cash.open`
- `cash.close`
- `cash.transaction`
- `cash.adjust`
- `cash.reverse`
- `cash.approve_difference`
- `cash.payment_without_session`

Legacy `cash` permission remains a transitional grant for standard actions,
but not for reversal, large-difference approval, or payment without a session.
The complete application-wide permission migration remains Phase 8.

## API and UI

New or enhanced endpoints:

- `GET /api/cash/reconciliation`
- `GET /api/cash/credit-reconciliation`
- `POST /api/cash/open`
- `POST /api/cash/{session_id}/close`
- `POST /api/cash/{session_id}/transaction`
- `POST /api/cash/transactions/{transaction_id}/reverse`
- `GET /api/payments`

The cash page now:

- displays cash and credit reconciliation;
- explains that cash payments are blocked without an open session;
- sends idempotency and version headers;
- requests a reason for a closing difference;
- displays payment references and reversals;
- exposes cash-transaction reversal only to authorized users.

Payment methods are canonicalized as:

- `cash`
- `card`
- `bank`
- `cheque`
- `credit`

The UI renders localized labels while the API stores stable codes.

## Acceptance results

- Two concurrent opening requests: one succeeds, one receives `409`, one open
  database row remains.
- Cash sale payment without a session: rejected.
- Cash expense without a session: rejected.
- Cash sale payment with a session: payment and matching inbound transaction
  created atomically.
- Cash expense with a session: payment and matching outbound transaction
  created atomically.
- Partial payment: document remains partially paid and customer credit is
  recalculated.
- Final payment: document becomes paid and customer credit becomes zero.
- Payment cancellation: one payment reversal and one cash reversal only.
- Expense update/delete: prior payments are reversed; payment rows remain.
- Large closing difference without approval permission: rejected.
- Non-zero closing difference without reason: rejected.
- Closed session adjustment: rejected.
- Read-only cash role cannot open a session.
- Exceptional cash settlement permission is enforced.
- Cash reconciliation detects no mismatch on healthy data.
- Credit reconciliation detects no mismatch on healthy data.

## Verification report

Story:

`UI payment/expense/cash action → API route → payment ledger → optional cash
transaction → document/customer balance sync → reconciliation/response UI`

| Boundary | Status | Evidence |
| --- | --- | --- |
| UI renders/builds | Pass | Vite production build completed |
| UI to API contract | Pass | canonical modes, idempotency, If-Match, reconciliation routes |
| API validation | Pass | missing cash session, permission, reason, and stale close guards tested |
| API to database | Pass | linked payment/cash rows and unique indexes tested |
| Database to response | Pass | live authenticated endpoints returned HTTP 200 |
| Response to UI | Pass | cash page consumes current session and both reconciliations |

Live results:

- Frontend HTTP `200` on port `5173`.
- API HTTP `200` on port `8000`.
- Cash reconciliation: healthy.
- Credit reconciliation: healthy.
- Open sessions: `1`.
- Current expected cash balance: `500.00 MAD`.
- Current cash difference: `0.00 MAD`.
- Customer credit mismatches: `0`.
- Orphan cash payments: `0`.
- Ledger/document mismatches: `0`.
- SQLite integrity: `ok`.
- Foreign-key violations: `0`.

Automated verification:

- Full backend suite: `60` tests passed.
- Phase 7 tests: `8` tests passed.
- Python compile check: passed.
- Frontend production build: passed.
- Migration upgrade/downgrade on realistic data copy: passed.

The full-story verification discipline resulted in testing the complete
mutation chain, including the UI request contract, route validation, ledger
write, cash write, balance synchronization, reconciliation, and returned
response.

## Files materially changed

- `backend/models/cash.py`
- `backend/models/payment.py`
- `backend/api/payments.py`
- `backend/api/routes/cash.py`
- `backend/api/routes/payments.py`
- `backend/api/routes/sales.py`
- `backend/api/routes/purchases.py`
- `backend/api/routes/clients.py`
- `backend/api/routes/suppliers.py`
- `backend/api/routes/expenses.py`
- `backend/api/schemas.py`
- `backend/services/cash.py`
- `backend/services/credit.py`
- `backend/core/database.py`
- `backend/main.py`
- `backend/migrations/phase7_cash_payments_credit.py`
- `backend/tests/test_cash_payments_credit_phase7.py`
- `backend/tests/test_document_workflow_phase3.py`
- `frontend/src/lib/api.js`
- `frontend/src/pages/CashPage.jsx`
- `frontend/src/pages/CashPage.css`
- `frontend/src/pages/POSPage.jsx`
- `frontend/src/pages/SalesPage.jsx`
- `frontend/src/pages/PurchasesPage.jsx`
- `frontend/src/pages/ClientsPage.jsx`
- `frontend/src/pages/SuppliersPage.jsx`
- `frontend/src/pages/ExpensesPage.jsx`
- `frontend/src/pages/UsersPage.jsx`

## Remaining constraints

- Large-difference approval currently allows the authorized closer to be the
  approver. A strict two-person approval workflow would require a separate
  approval state and is recorded for a future workflow phase.
- Historical payment methods remain `legacy` intentionally; assigning them to
  Cash/Card/Bank without evidence would falsify accounting history.
- Application-wide fine-grained permissions are intentionally deferred to
  Phase 8.

## Before/after assessment

- Cash integrity: `4/10 → 9/10`
- Payment traceability: `2/10 → 9/10`
- Credit consistency: `4/10 → 9/10`
- Concurrency/idempotency: `5/10 → 9/10`
- UX visibility: `5/10 → 8.5/10`

## Rollback

Schema rollback:

```powershell
backend\venv\Scripts\python.exe backend\migrations\phase7_cash_payments_credit.py down --db backend\proerp.db
```

The migration rollback restores pre-phase customer balances and removes only
the generated historical ledger rows. If real Phase 7 payments have been
recorded, restoring the pre-phase backup is safer:

`backend/backups/proerp-backup-20260716-153818.zip`
