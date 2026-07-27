# Phase 4 — Exact monetary arithmetic and tax policy

Date: 2026-07-15  
Status: **Accepted**

## Outcome

Phase 4 replaces runtime floating-point money calculations with `Decimal`, stores financial values in explicit SQLite `NUMERIC` columns, and makes the backend the authoritative source for sale, purchase, and POS totals.

The migration was applied to the live database without rewriting historical document totals. Every original financial field was compared against the pre-migration backup and remained identical.

## Monetary policy

- Monetary totals/payments: `NUMERIC(18,2)` and `Decimal("0.01")`.
- Prices, quantities, stock and unit costs: `NUMERIC(18,4)`.
- Discounts and tax rates: `NUMERIC(7,4)`.
- Rounding: commercial `ROUND_HALF_UP`.
- Rounding scope: configurable as `line` or `document`.
- Price tax mode: configurable as `exclusive` (HT) or `inclusive` (TTC).
- Currency: one normalized three-letter code; current value is `MAD`.
- Allowed tax rates: configurable; current value is `0,7,10,14,20`.
- Backend-calculated tax breakdown is persisted per rate for all new/updated documents.

## Backend changes

- Added one exact calculation service for validation, line allocation, document totals, tax extraction, tax breakdown, and serialization.
- Added authenticated `POST /api/sales/preview` and `POST /api/purchases/preview` endpoints.
- Sale and purchase create/update routes persist only backend-calculated totals and line amounts.
- Payment, client credit, supplier credit, cash, stock, product import, dashboard, reports, and demo seeding use the unified Decimal helpers.
- Inputs reject non-finite numbers and enforce:
  - `quantity > 0` for document/receipt lines;
  - `unit_price >= 0`, `purchase_price >= 0`;
  - discount and tax percentage in `0..100`;
  - tax rate membership in the configured allow-list;
  - payment strictly positive in business logic and not greater than the remaining balance.

## Frontend changes

- Sales, purchases, and POS request a debounced authoritative preview from the backend.
- A second preview is required immediately before save/checkout.
- POS pays the exact `total_amount` returned by the created sale; it no longer sends a locally calculated `toFixed` amount.
- Tax choices come from settings.
- Settings expose price tax mode, rounding scope, allowed tax rates, fixed `half_up` rounding, and normalized currency.
- New document details display backend tax breakdowns and document currency.

## Migration and data proof

Migration: `backend/migrations/phase4_decimal_money.py`

- Upgrade and downgrade were tested on an isolated copy before production.
- Round trip result: all original rows and values restored exactly.
- Live upgrade result: `PRAGMA integrity_check = ok`; foreign-key errors: `0`.
- Post-upgrade types sampled:
  - `sales.total_amount = NUMERIC(18,2)`;
  - `sale_items.unit_price = NUMERIC(18,4)`;
  - `sale_items.tax_rate = NUMERIC(7,4)`;
  - `purchases.discount = NUMERIC(7,4)`;
  - `products.stock_quantity = NUMERIC(18,4)`.

Production comparison against the pre-migration backup:

| Table | Rows | Original values |
|---|---:|---|
| products | 16 | exact |
| clients | 8 | exact |
| sales | 211 | exact |
| sale_items | 537 | exact |
| purchases | 7 | exact |
| purchase_items | 20 | exact |
| payments | 0 | exact |
| expenses | 20 | exact |
| cash_sessions | 2 | exact |
| cash_transactions | 2 | exact |
| stock_movements | 544 | exact |

Legacy note: 121 old sales already had line/subtotal inconsistencies from historical seed behavior. They were deliberately preserved instead of being silently recomputed. New and edited documents use the exact policy and persist their breakdown.

## Backups

Before migration:

- `backend/backups/proerp-backup-20260715-170354.zip`
- SHA-256: `3E784A2C7DADD734B8475A3FBC18C752FAC1995898D7526D60E1F532D174711B`
- Verified integrity and row counts before upgrade.

After migration:

- `backend/backups/proerp-backup-20260715-173651.zip`
- Size: `148820` bytes.
- SHA-256: `16E2DEF53E583C17CCCEB9FA3604889D95817E18C11A77A15277B7A0786183E9`
- Archive database: integrity `ok`, foreign-key errors `0`, expected counts present, `sales.total_amount = NUMERIC(18,2)`.

## Acceptance evidence

- Backend compile: passed.
- Backend tests: **37/37 passed**.
- New Phase 4 tests: **10/10 passed**, including route-level persistence.
- Frontend production build: passed; 2467 modules transformed.
- Live authenticated read-only verification:
  - dashboard KPIs: HTTP 200;
  - reports overview: HTTP 200;
  - sales and purchase lists: HTTP 200;
  - sales and purchase exact previews: HTTP 200.
- Exact regression cases:
  - `3 × 0.1` at 0% tax = `0.30` exactly;
  - inclusive `120` at 20% = net `100.00`, tax `20.00`, total `120.00`;
  - combined 10% line + 5% document discount on `2 × 19.995` = net `34.19`, tax `6.84`, total `41.03`;
  - document rounding allocates residual cents while preserving exact line/document sums.

React Doctor could not be downloaded because the local npm chain returned `SELF_SIGNED_CERT_IN_CHAIN`. The production build passed and the edited hooks were manually reviewed for cancellation cleanup, stable dependencies, and render loops. No ESLint installation exists in this repository.

## Rollback

Database-only rollback command (tested on an isolated copy):

```powershell
backend\venv\Scripts\python.exe backend\migrations\phase4_decimal_money.py down
```

For a complete rollback, stop the API, restore `proerp-backup-20260715-170354.zip`, and deploy the pre-Phase-4 application code together. Do not run the new application against the downgraded schema.

## Runtime state

- Frontend: `http://127.0.0.1:5173` — HTTP 200.
- Backend: `http://127.0.0.1:8000` — listening.
- API docs: `http://127.0.0.1:8000/docs` — HTTP 200.
- Database integrity: `ok`; foreign-key errors: `0`; audit rows unchanged at `76` during the read-only verification.
