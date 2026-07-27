# ProERP Web — Phase 0 Safe Baseline

Date: 2026-07-15  
Scope: inventory, evidence gathering, build/compile checks, read-only API smoke tests, data consistency checks, and verified backup creation.  
Implementation changes: none. No business logic, schema, credentials, users, MFA settings, or application source files were changed.

## 1. System story

The user authenticates in the React/Vite frontend, the frontend calls FastAPI endpoints, FastAPI validates the JWT and module permission, SQLAlchemy reads or updates the SQLite ERP database, and the response is rendered by React.

```text
Browser / React
  -> Axios /api
    -> FastAPI router
      -> JWT + module permission
        -> SQLAlchemy
          -> SQLite WAL database
        <- API response
      <- React loading/error/data state
```

## 2. Inventory

### Frontend

- React 18.3.1 and React DOM 18.3.1.
- Vite 5.4.21.
- React Router, Axios, Recharts, date-fns, lodash, lucide-react, and react-hot-toast.
- 25 JSX files, 5 JavaScript files, and 16 CSS files under `frontend/src`.
- 15 application routes including login and 14 protected ERP pages.
- Production build output: 50 files, approximately 1.09 MB uncompressed on disk.

### Backend

- FastAPI 0.115.0.
- SQLAlchemy 2.0.36.
- Uvicorn 0.30.6.
- Pydantic 2.9.2.
- JWT, bcrypt, multipart upload, and cryptography dependencies.
- 41 project Python files excluding the virtual environment.
- OpenAPI exposes 76 paths and 102 HTTP operations.
- Module-level permissions are applied in `backend/main.py` for dashboard, clients, products, suppliers, sales, purchases, expenses, stock, reports, users, settings, cash, backups, audit, security center, and system health.
- Notifications, global search, and payment history require an authenticated user inside their route handler but do not have a separate module permission at router registration.

### Deployment and runtime

- Local frontend is running on port 5173.
- Local backend is running on port 8000.
- README and Docker documentation use port 8015, while `start.ps1` uses 8000.
- Docker Compose defines `backend` and `nginx` services.
- Windows and Linux setup/start scripts are present.
- Runtime environment files are present. Only environment variable names were inventoried; values are intentionally excluded from this report.

### Git state

- `.git` exists as a read-only reparse-point directory, but it has no `HEAD` and `git status` reports that the workspace is not a Git repository.
- There is therefore no reliable Git diff, history, or source rollback baseline at Phase 0.

## 3. Database baseline

Database: `backend/proerp.db`  
Primary file size: 303,104 bytes  
WAL size during inspection: 3,065,312 bytes  
SHM size: 32,768 bytes  
Journal mode: WAL  
Integrity check: `ok`

The raw inspection connection reported `PRAGMA foreign_keys=0`; application-managed SQLAlchemy connections explicitly enable foreign keys in `backend/core/database.py`. `PRAGMA foreign_key_check` reported zero current violations.

### Tables and row counts

| Table | Rows |
| --- | ---: |
| audit_logs | 69 |
| cash_sessions | 2 |
| cash_transactions | 2 |
| categories | 7 |
| clients | 8 |
| expenses | 20 |
| payments | 0 |
| products | 16 |
| purchase_items | 20 |
| purchases | 7 |
| roles | 4 |
| sale_items | 535 |
| sales | 210 |
| stock_movements | 543 |
| suppliers | 4 |
| users | 5 |

### Current consistency checks

- Foreign-key violations: 0.
- Duplicate sale numbers: 0.
- Duplicate purchase numbers: 0.
- Negative stock rows: 0.
- Sales paid above total: 0.
- Purchases paid above total: 0.
- Negative sale/purchase totals: 0.
- Orphan sale items: 0.
- Orphan purchase items: 0.
- Open cash sessions: 1.
- Sale statuses: 170 paid, 40 confirmed.
- Purchase statuses: 7 received.
- Sales with a positive `paid_amount`: 185.
- Payment ledger rows: 0. This indicates that historical paid amounts are not represented in the newer payment ledger.

## 4. Backup verification

### Existing application backup path — failed currency check

The Phase 0 test invoked the current `create_backup()` implementation. The generated ZIP passed CRC and SQLite integrity checks, but its restored data did not match the live database:

| Check | Live database | Application backup |
| --- | ---: | ---: |
| Tables | 16 | 14 |
| Sales | 210 | 201 |
| Users | 5 | 1 |

Evidence: `_copy_sqlite_database()` uses `shutil.copy2(DB_PATH, destination)` while the live database operates in WAL mode. The WAL contents were not included in the copied database file.

The test artifact `backend/backups/proerp-backup-20260715-151329.zip` must not be treated as a current baseline backup.

### Verified Phase 0 baseline backup

To satisfy Phase 0 safety without modifying application code, a one-time operational snapshot was created using the SQLite Backup API:

- File: `backend/backups/proerp-baseline-phase0-20260715-151412.zip`
- Size: 122,416 bytes.
- SHA-256: `56311c44e0ad93fe042ac433f7f53e0993744ca04d31a5e77bf87ba18627aaa4`
- ZIP CRC test: passed.
- Extracted database integrity: `ok`.
- Live/restored tables: 16 / 16.
- Live/restored sales: 210 / 210.
- Live/restored users: 5 / 5.
- Counts match: true.
- The archive also contains the current settings file and three upload members. It must be protected as sensitive because Phase 0 did not yet implement encrypted-by-default backups or secret separation.

## 5. Build, dependency, and runtime verification

### Frontend production build

- Result: passed.
- Modules transformed: 2,467.
- Build time during Phase 0: approximately 26 seconds.
- Main JavaScript chunk: 309.88 kB, 102.56 kB gzip.
- AreaChart chunk: 385.73 kB, 106.33 kB gzip.
- Settings page chunk: 53.01 kB, 14.73 kB gzip.

### Backend compile and dependencies

- Python `compileall`: passed.
- `pip check`: passed with no broken requirements.
- `npm ls --depth=0`: passed.
- `npm audit`: not completed because the local network certificate chain is self-signed. The vulnerability status remains unknown.

### Test and quality tooling

- Project-owned automated test files: none.
- ESLint configuration: none.
- Prettier configuration: none.
- Pytest configuration: none.
- Ruff configuration: none.
- Vitest/Playwright configuration: none.
- CI workflow: none found.
- `docs/TESTS_VALIDATION.md` exists, but all real-result/status fields are still marked as incomplete.

### Live smoke test

Authenticated read-only checks returned HTTP 200 for:

- `/health`
- `/api/auth/me`
- `/api/dashboard/kpis`
- `/api/products`
- `/api/sales`
- `/api/purchases`
- `/api/stock/summary`
- `/api/cash/current`
- `/api/reports/overview`
- `/api/security-center/overview`
- `/api/settings`

Unauthenticated requests to settings, sales, and backups were rejected with HTTP 403.

Frontend `/` and `/login` returned HTTP 200 in approximately 9–21 ms. API read endpoints completed in approximately 10–61 ms after the initial health request.

Security headers currently observed on local HTTP:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`
- No Content-Security-Policy header was observed.
- HSTS is intentionally only emitted for HTTPS requests.

## 6. Flow verification status

| Boundary | Status | Evidence |
| --- | --- | --- |
| Frontend responds | Pass | `/` and `/login` returned 200 |
| Client/API route alignment | Pass for sampled flows | Frontend paths and OpenAPI methods align for sampled dashboard, products, sales, stock, cash, reports, settings |
| Authentication boundary | Pass for sampled reads | Authenticated requests returned 200; unauthenticated protected requests returned 403 |
| API to database | Pass for sampled reads | Response shapes were valid and DB consistency checks passed |
| Database to backup | Fail in current application implementation | Application backup restored stale/incomplete data under WAL |
| Verified safety snapshot | Pass | SQLite Backup API snapshot restored with matching counts and integrity `ok` |

## 7. Risk register

### P0 — Critical

1. **Application backups can omit committed WAL data.** Proven by live/restored count mismatch. A restore may silently lose users, sales, schema changes, or other recent records. Evidence: `backend/api/routes/backups.py:67-68`.
2. **Settings API exposes sensitive configuration fields.** The authenticated `/api/settings` response contains a sensitive password-named field, and settings updates send the complete old/new configuration to the audit log. Evidence: `backend/api/routes/settings.py:24-32`, `backend/api/schemas.py:608`.
3. **A paid sale can be deleted.** Deletion blocks only `confirmed`; a `paid` sale is not blocked even though it may have affected stock and cash. There are currently 170 paid sales. Evidence: `backend/api/routes/sales.py:434-443`.

### P1 — High

1. Purchase payments do not validate a positive amount or remaining balance; sale payments do not cap payment to the remaining balance. Evidence: `backend/api/routes/purchases.py:133-144`, `backend/api/routes/sales.py:407-429`.
2. Firebase login issues an access token without applying the local MFA-required branch. Evidence: `backend/api/routes/auth.py:177-203`.
3. Password change through profile update does not require the current password and does not invalidate older access tokens. Evidence: `backend/api/routes/auth.py:212-227`.
4. ZIP restore uses `extractall` without an explicit safe-member policy or upload size limit. Evidence: `backend/api/routes/backups.py:231,285`.
5. Financial values are represented by SQLAlchemy `Float`, creating rounding and accounting accuracy risk.
6. Sale, purchase, client, supplier, and product numbers use count-based generation and can collide under deletion/concurrency.
7. Access tokens are stored in browser localStorage, increasing impact of a successful XSS attack. Evidence: `frontend/src/lib/api.js:30`.
8. The default security key fallback exists in code; production startup does not reject it. Evidence: `backend/core/security.py:17`.
9. No automated regression, permission, financial, backup/restore, or E2E tests exist.
10. Git metadata is unusable, so source rollback and change attribution are not currently reliable.

### P2 — Medium

1. Permissions are mostly module-level instead of action-level; read/create/confirm/pay/delete share one permission.
2. The payment ledger has zero rows while 185 sales contain paid amounts, limiting traceability/reconciliation for historical data.
3. Content-Security-Policy is missing.
4. Several frontend failures are silently ignored, including settings and notification loading.
5. The i18n provider mutates rendered DOM through `MutationObserver`, which is fragile for accessibility and performance. Evidence: `frontend/src/lib/i18n.jsx:931`.
6. Most modal implementations do not consistently provide dialog semantics, focus trapping, Escape handling, and focus restoration.
7. Command-palette create links use `?new=1`, but product/sale/purchase pages do not consume that parameter. Evidence: `frontend/src/components/layout/CommandPalette.jsx:18-20`.
8. Sales edit logic reads stale form state and directly mutates an array. Evidence: `frontend/src/pages/SalesPage.jsx:107`.
9. Large components increase maintenance risk: SettingsPage 1,120 lines, SalesPage 743, ProductsPage 594, POSPage 587, Layout 571.
10. Main and chart bundles are both above 300 kB uncompressed.

### P3 — Low / hygiene

1. README/Docker use backend port 8015 while `start.ps1` uses 8000.
2. A zero-byte root-level `proerp.db` and journal coexist with the real backend database, creating operator confusion.
3. A stray `{backend` directory is present.
4. Runtime/debug logs are stored in the workspace.
5. Validation documentation is present but not populated with real results.

## 8. Expected Phase 1 files

No Phase 1 change has been applied. Based on the baseline, the security phase is expected to involve at least:

- `backend/api/routes/settings.py`
- `backend/api/schemas.py`
- `backend/api/audit.py`
- `backend/api/routes/backups.py`
- `backend/core/config.py`
- `backend/core/security.py`
- `backend/api/routes/products.py`
- `backend/main.py`
- `frontend/src/pages/SettingsPage.jsx`
- `frontend/src/pages/LoginPage.jsx`
- `frontend/src/lib/runtimeConfig.js`
- New backend security and backup tests
- Environment examples and security/backup documentation

Phase 1 must first preserve and test the current settings contract, then mask secrets, redact audit payloads, replace unsafe backup copying, enforce safe archive extraction and size limits, validate production secrets, remove production default credentials from UI, and add upload/security-header tests.

## 9. Phase 0 acceptance

| Requirement | Result |
| --- | --- |
| Frontend/backend/database inventory | Pass |
| README/env/startup inspection | Pass; environment values not reported |
| Database schema/size/count inspection | Pass |
| API route and permission inventory | Pass |
| Git state inspection | Pass; repository metadata is unusable |
| Production build | Pass |
| Python compile | Pass |
| Core endpoint smoke test | Pass |
| Tests/lint inventory | Pass; none found |
| Bundle measurement | Pass |
| Application backup verification | Fail; stale WAL snapshot detected |
| Separate verified Phase 0 backup | Pass; counts and integrity match |
| P0/P1/P2/P3 risk register | Pass |
| Expected Phase 1 file list | Pass |

Phase 0 is complete. Phase 1 has not started.

## 10. Rollback / cleanup for Phase 0

Phase 0 made no source or schema changes. It created documentation and backup artifacts and regenerated the existing frontend build output.

- Remove this report only if the baseline documentation itself must be discarded.
- Retain `proerp-baseline-phase0-20260715-151412.zip` until a newer verified backup exists.
- Do not rely on `proerp-backup-20260715-151329.zip` as a current backup; it is retained only as Phase 0 failure evidence.
- `frontend/dist` can be regenerated from current source with `npm run build`.
- No database rollback is required because all database checks were read-only and no migration ran.
