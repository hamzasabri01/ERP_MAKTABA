# Phase 5 — Document numbering and concurrency

Date: 2026-07-16  
Status: **Accepted**

## Outcome

`COUNT + 1` was removed from sales, quote conversion, purchases, and demo seeding. Document numbers are now allocated by a persistent transactional sequence and are never reused after allocation.

The live database was migrated and backfilled without changing any historical sale, purchase, or line-item row.

## Baseline evidence

- `sales.py` counted rows per sale type and returned `count + 1`.
- `purchases.py` counted all purchases and returned `count + 1`.
- Sixteen concurrent reads of the old generator all returned `FAC-2026-00211`.
- Existing data before migration:
  - sales: 211;
  - purchases: 7;
  - duplicate numbers: 0;
  - invoice sequence: `FAC-2026-00001..00210`;
  - delivery sequence: `BL-2026-00001`;
  - purchase sequence: `BC-2026-00001..00007`.
- `sales.number` and `purchases.number` already had unique constraints, but those constraints only converted the race into failed requests.

## New data model

### `document_sequences`

One row per:

- `company_key`;
- domain: `sale` or `purchase`;
- document type;
- fiscal year.

It stores `last_value` and the next value to allocate. The scope has a database unique constraint.

### `document_number_allocations`

Every allocated number is permanent and records:

- sequence and company scope;
- document domain/type/year;
- prefix and serial;
- final document number;
- status: `reserved`, `committed`, or `void`;
- reason;
- document ID and user when available;
- allocation, commit, and void timestamps.

Unique constraints protect the scoped serial and final number. Draft deletion changes the allocation to `void` with reason `draft_deleted`; it never decrements the sequence.

## Allocation transaction

SQLite allocation uses a short `BEGIN IMMEDIATE` transaction:

1. Lock the sequence write scope.
2. Read or initialize the sequence.
3. Increment `last_value/next_value`.
4. Insert the permanent `reserved` allocation.
5. Commit the allocation transaction.
6. Create the document in its normal transaction.
7. Mark the allocation `committed` with the document ID.

If document persistence fails, the document transaction is rolled back and the allocation becomes `void`. Lock/busy errors use five bounded retries with a small increasing delay.

This intentionally allows legal gaps and records their reason instead of reusing numbers.

## Prefix and scope behavior

- Current prefixes: `FAC`, `DEV`, `BL`, `AV`, `BC`, `BR`.
- Prefixes are validated as 1–12 uppercase letters, digits, or underscores.
- Changing a prefix affects only new documents.
- Prefix changes do not reset the sequence for the same company/type/year.
- Historical numbers are never rewritten.
- The current application uses company key `default`.
- Non-default company scopes include the company key in the formatted number, preserving global uniqueness in the current single-company document tables.
- Backdated documents use the year of `date_time`, not the server clock year.

## Migration

Migration: `backend/migrations/phase5_document_sequences.py`

The migration:

- creates both tables and indexes;
- parses all existing sale and purchase numbers;
- creates sequences using the maximum serial across old prefixes;
- backfills every historical document as a `committed` allocation;
- leaves all existing document values unchanged;
- supports downgrade by dropping only the Phase 5 tables.

Production backfill:

| Scope | Last | Next |
|---|---:|---:|
| purchase/order/2026 | 7 | 8 |
| sale/delivery/2026 | 1 | 2 |
| sale/invoice/2026 | 210 | 211 |

Initial backfill created 3 sequences and 218 committed allocations.

## Live acceptance flow

Authenticated API verification performed:

1. Created `FAC-2026-00211`.
2. Deleted the Draft; allocation became `void / draft_deleted`.
3. Created `FAC-2026-00212`; the deleted number was not reused.
4. Deleted the second Draft; its allocation became `void`.
5. Created `BC-2026-00008`.
6. Deleted the Draft; its allocation became `void`.

The temporary documents were removed. The three intentionally consumed test numbers remain as documented gaps.

Current next values:

- invoice: `FAC-2026-00213`;
- purchase order: `BC-2026-00009`.

## Tests and verification

- Python compile: passed.
- Backend suite: **45/45 passed**.
- Phase 5 migration round trip: passed.
- Service concurrency: 40 concurrent document transactions, 40 unique numbers, serials 1–40.
- Route concurrency: 20 concurrent `create_sale` calls, 20 unique response numbers, serials 1–20.
- Independent sequences tested by year, type, and company scope.
- Prefix change continuation tested.
- Failed reservation and deleted Draft non-reuse tested.
- Frontend production build: passed; 2467 modules transformed.
- Live API:
  - settings: HTTP 200;
  - sales list: HTTP 200;
  - purchases list: HTTP 200;
  - dashboard KPIs: HTTP 200;
  - API docs: HTTP 200;
  - frontend: HTTP 200.
- Audit chain after live mutations: `ok=true`, checked 82, broken 0, legacy 0.
- Database: `integrity_check=ok`, foreign-key errors 0.

Historical comparison against the pre-Phase-5 backup:

| Table | Rows | Result |
|---|---:|---|
| sales | 211 | exact |
| sale_items | 537 | exact |
| purchases | 7 | exact |
| purchase_items | 20 | exact |

## Backups

Before migration:

- `backend/backups/proerp-backup-20260716-142952.zip`
- Size: 148823 bytes
- SHA-256: `59690C48D998814BE6C6076A1787C55F343257AB6E9F685FC79B7CF54720EA55`
- Integrity: `ok`; foreign-key errors: 0.

After migration and live verification:

- `backend/backups/proerp-backup-20260716-144519.zip`
- Size: 161601 bytes
- SHA-256: `CB6BB9C5BB96899426285A071DC1A7CA01D74057127CA540D8520ACFBBCE5816`
- Counts: 211 sales, 7 purchases, 3 sequences, 221 allocations, 82 audit rows.
- Allocation statuses: 218 committed, 3 void, 0 reserved.
- Integrity: `ok`; foreign-key errors: 0.

## Files changed

- `backend/models/document_sequence.py`
- `backend/services/document_numbers.py`
- `backend/migrations/phase5_document_sequences.py`
- `backend/api/routes/sales.py`
- `backend/api/routes/purchases.py`
- `backend/api/schemas.py`
- `backend/models/__init__.py`
- `backend/core/database.py`
- `backend/company_settings.json`
- `backend/seed_demo.py`
- `backend/tests/test_document_sequences_phase5.py`
- `frontend/src/pages/SettingsPage.jsx`

## UI/UX

Settings now expose credit-note and purchase-receipt prefixes and explain that changing a prefix does not rewrite old numbers or reset annual counters. No new hooks, fetch waterfall, or derived state were introduced.

## Additional safety correction

The configured SQLite URL was relative to the current shell directory. `core/database.py` now anchors `sqlite:///./...` to the backend directory, preventing scripts launched from the repository root from opening an unintended empty database.

## Remaining limitations and backlog

- PostgreSQL allocation is deliberately rejected until its row-lock implementation is added and tested during the scalability phase.
- The application is currently single-company; the sequence model supports company scopes, but document ownership by company awaits a future multi-company schema.
- A dedicated admin screen for browsing sequence gaps can be added during UX/reporting work. The data and reasons are already persisted.
- Existing `datetime.utcnow()` deprecation warnings are unchanged and belong to the timezone modernization backlog.

## Evaluation

| Area | Before | After |
|---|---:|---:|
| Concurrency safety | 2/10 | 10/10 |
| Number non-reuse | 1/10 | 10/10 |
| Prefix continuity | 4/10 | 10/10 |
| Historical preservation | 8/10 | 10/10 |
| Gap auditability | 0/10 | 9/10 |
| Migration/rollback evidence | 5/10 | 10/10 |

## Rollback

Database-only downgrade:

```powershell
backend\venv\Scripts\python.exe backend\migrations\phase5_document_sequences.py down
```

This removes only the Phase 5 sequence/allocation tables and does not change historical documents.

For a complete rollback, stop the API, restore `proerp-backup-20260716-142952.zip`, and deploy the pre-Phase-5 application code together. Do not run the new application code after dropping the sequence tables, because startup can recreate empty tables without the historical legal allocation trail.

## Runtime state

- Frontend: `http://127.0.0.1:5173`
- Backend: `http://127.0.0.1:8000`
- API docs: `http://127.0.0.1:8000/docs`
- Both services are listening and returned HTTP 200.
