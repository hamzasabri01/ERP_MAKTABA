# Phase 6 — Stock Integrity and Controlled Inventory

Date: 2026-07-16  
Status: Complete

## Objective

Make stock writes safe under concurrency, trace every movement to its source,
prevent duplicate effects, reverse committed movements instead of deleting
history, and introduce a controlled inventory workflow.

## Backup and migration safety

- Pre-phase backup:
  `backend/backups/proerp-backup-20260716-145126.zip`
- SHA-256:
  `BC3F59D91E93BACE48FFAAB0E2EE50A041D816A745531382D284E2FB6F16BE5D`
- The migration was tested in both directions on:
  - a minimal legacy schema;
  - a copy of the production database.
- Upgrade and downgrade preserved product, movement, sale, purchase, and audit
  row counts.
- SQLite `integrity_check` returned `ok`.
- SQLite `foreign_key_check` returned no violations.

Rollback command:

```powershell
backend\venv\Scripts\python.exe backend\migrations\phase6_stock_integrity.py down --db backend\proerp.db
```

The backup remains the preferred rollback path when application traffic has
already created Phase 6 inventory sessions or movements.

## Baseline defect reproduced

The previous implementation loaded a product balance into the ORM, calculated
the new value in application memory, and then wrote it back. Two stale sessions
could both read `100`, each approve an `80` unit sale, and leave a final balance
of `20` while recording two outbound movements.

Sale confirmation also performed a separate pre-check before the write, leaving
a race window. Cancellation recomputed a new movement from sale lines instead
of reversing the exact committed movement.

## Implemented controls

### Atomic stock mutation

- Outbound stock uses one conditional SQL update:
  update only when the current database balance is greater than or equal to the
  requested quantity.
- Inbound stock increments the database value atomically.
- Exact adjustments and inventory validation use compare-and-swap against the
  expected balance.
- Stock can never become negative in this phase.
- Services are rejected by the stock service and cannot receive movements.

### Movement traceability and idempotency

Each new movement supports:

- `warehouse_code` with current warehouse `MAIN`;
- `source_type`;
- `source_id`;
- `source_line_id`;
- unique `operation_key`;
- `kind` (`movement` or `reversal`);
- unique `reverses_movement_id`.

Historical movements were backfilled from sale and purchase references. All
544 existing movements now have an operation key and an identified source.

### Exact reversal

Sale cancellation queries the original committed stock movements and applies
the mathematical opposite of each original delta. A unique reversal link
prevents a second cancellation request from restoring stock twice.

### Purchase receipt

Partial receipt remains supported. Every receipt request and purchase line gets
its own operation key, so replaying the same request does not duplicate stock.

### Inventory workflow

Inventory is now persisted as:

1. `draft`: product balances are snapshotted;
2. `counted`: all session lines receive a physical count;
3. `validated`: differences become linked stock movements.

The session records reference, warehouse, notes, version, creator, counter,
validator, and timestamps. Validation rejects the complete operation if any
product balance changed after the snapshot.

### Reconciliation

`GET /api/stock/reconciliation` checks:

- current product balance against the latest movement balance;
- continuity between each movement's `after_qty` and the next movement's
  `before_qty`;
- missing movement history;
- movements attached to services;
- missing source classification.

The stock page now displays the reconciliation state and warehouse. The
inventory modal exposes the draft, counted, and validated states instead of
applying adjustments immediately.

## Acceptance results

- Concurrent sale confirmation for two sales of `80` against stock `100`:
  one confirmation succeeds, one receives insufficient stock, final stock is
  `20`, and only one sale movement exists.
- Two stale stock sessions cannot produce a negative balance.
- Replaying a movement operation produces one movement.
- Reversing and replaying cancellation produces one reversal and restores the
  original balance exactly.
- Service stock movement is rejected.
- Reconciliation detects direct balance corruption.
- Inventory validation rejects a stale snapshot.
- Inventory validation replay creates no additional movement.

## Verification evidence

- Backend test suite: `52` tests passed.
- Phase 6 tests: `7` tests passed.
- Frontend Vite production build: passed.
- Python compile check: passed.
- Live frontend: HTTP `200` on port `5173`.
- Live API: HTTP `200` on port `8000`.
- Live authenticated reconciliation:
  - products checked: `14`;
  - movements checked: `544`;
  - balance mismatches: `0`;
  - continuity errors: `0`;
  - source gaps: `0`;
  - negative product balances: `0`;
  - service movements: `0`;
  - duplicate operation keys: `0`;
  - result: healthy.

## Files added or materially changed

- `backend/services/stock.py`
- `backend/models/stock.py`
- `backend/migrations/phase6_stock_integrity.py`
- `backend/api/routes/stock.py`
- `backend/api/routes/sales.py`
- `backend/api/routes/purchases.py`
- `backend/api/routes/products.py`
- `backend/api/schemas.py`
- `backend/core/database.py`
- `backend/seed_demo.py`
- `backend/tests/test_stock_integrity_phase6.py`
- `frontend/src/pages/StockPage.jsx`
- `frontend/src/pages/StockPage.css`

## Deliberate scope decisions

- Negative stock is disabled entirely. A future setting must not enable it
  without a dedicated permission and audit trail.
- The schema is warehouse-ready through `warehouse_code`; multi-warehouse
  transfers and per-warehouse balances remain future work.
- Partial purchase receipt is included. Partial customer delivery is not added
  because the current sale model does not yet track delivered quantity per line;
  that requires a dedicated delivery workflow rather than weakening stock
  integrity.
