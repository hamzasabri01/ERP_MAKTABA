"""
Maktaba Print — FastAPI Backend
Migrated from PyQt6 desktop application.
"""
from __future__ import annotations
import logging
import os
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from core.database import init_db
from core.config import env_list
from core.security import build_content_security_policy, require_permission, validate_runtime_security
from api.routes import (
    auth, clients, products, categories, suppliers,
    sales, purchases, expenses, stock, reports,
    users, settings, cash, dashboard, backups, audit, notifications, search, payments, system, security_center,
    mobile_scanner, printer, research, document_scanner
)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("secureerp")


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_runtime_security()
    init_db()
    try:
        backups.create_startup_backup_if_needed()
    except Exception:
        logger.exception("Startup backup check failed")
    reports.start_report_email_scheduler()
    mobile_scanner.start_tunnel_supervisor()
    logger.info("Maktaba Print backend started")
    yield
    mobile_scanner.stop_tunnel_supervisor()


app = FastAPI(
    title="Maktaba Print API",
    version="1.0.0",
    description="Gestion commerciale pour librairie, fournitures scolaires, copie et impression",
    lifespan=lifespan,
)


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    """Always return predictable JSON while keeping technical details in server logs."""
    logger.exception(
        "Unhandled API error method=%s path=%s",
        request.method,
        request.url.path,
        exc_info=exc,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Erreur interne du serveur. Réessayez; si le problème persiste, consultez les journaux."},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=env_list("CORS_ORIGINS", [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "https://app-erp-622bc.web.app",
        "https://app-erp-622bc.firebaseapp.com",
    ]),
    allow_origin_regex=r"^https://.*\.trycloudflare\.com$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    camera_policy = "camera=(self)" if request.url.path.startswith("/mobile-scanner") else "camera=()"
    response.headers.setdefault("Permissions-Policy", f"{camera_policy}, microphone=(), geolocation=()")
    response.headers.setdefault("Content-Security-Policy", build_content_security_policy(is_https=request.url.scheme == "https"))
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("X-Permitted-Cross-Domain-Policies", "none")
    if request.url.scheme == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response

# API Routes
app.include_router(auth.router,       prefix="/api/auth",       tags=["Auth"])
app.include_router(dashboard.router,  prefix="/api/dashboard",  tags=["Dashboard"],  dependencies=[Depends(require_permission("dashboard"))])
app.include_router(clients.router,    prefix="/api/clients",    tags=["Clients"],    dependencies=[Depends(require_permission("clients"))])
app.include_router(products.router,   prefix="/api/products",   tags=["Products"],   dependencies=[Depends(require_permission("products"))])
app.include_router(categories.router, prefix="/api/categories", tags=["Categories"], dependencies=[Depends(require_permission("products"))])
app.include_router(suppliers.router,  prefix="/api/suppliers",  tags=["Suppliers"],  dependencies=[Depends(require_permission("suppliers"))])
app.include_router(sales.router,      prefix="/api/sales",      tags=["Sales"],      dependencies=[Depends(require_permission("sales"))])
app.include_router(purchases.router,  prefix="/api/purchases",  tags=["Purchases"],  dependencies=[Depends(require_permission("purchases"))])
app.include_router(expenses.router,   prefix="/api/expenses",   tags=["Expenses"],   dependencies=[Depends(require_permission("expenses"))])
app.include_router(stock.router,      prefix="/api/stock",      tags=["Stock"],      dependencies=[Depends(require_permission("stock"))])
app.include_router(reports.router,    prefix="/api/reports",    tags=["Reports"],    dependencies=[Depends(require_permission("reports"))])
app.include_router(users.router,      prefix="/api/users",      tags=["Users"],      dependencies=[Depends(require_permission("users"))])
app.include_router(settings.router,   prefix="/api/settings",   tags=["Settings"],   dependencies=[Depends(require_permission("settings"))])
app.include_router(cash.router,       prefix="/api/cash",       tags=["Cash"])
app.include_router(backups.router,    prefix="/api/backups",    tags=["Backups"],    dependencies=[Depends(require_permission("settings"))])
app.include_router(audit.router,      prefix="/api/audit",      tags=["Audit"],      dependencies=[Depends(require_permission("settings"))])
app.include_router(security_center.router, prefix="/api/security-center", tags=["Security Center"], dependencies=[Depends(require_permission("settings"))])
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notifications"])
app.include_router(search.router,        prefix="/api/search",     tags=["Search"])
app.include_router(payments.router,      prefix="/api/payments",   tags=["Payments"])
app.include_router(system.router,        prefix="/api/system",     tags=["System"], dependencies=[Depends(require_permission("settings"))])
app.include_router(mobile_scanner.router, prefix="/api/mobile-scanner", tags=["Mobile Scanner"])
app.include_router(printer.router, prefix="/api/printer", tags=["Printer"], dependencies=[Depends(require_permission("expenses"))])
app.include_router(research.router, prefix="/api/research", tags=["School Research"])
app.include_router(document_scanner.router, prefix="/api/document-scanner", tags=["Document Scanner"])

# Serve uploaded images
os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": "1.1.0",
        "capabilities": ["document_archive", "mobile_scanner", "reports"],
    }


# In a local-server deployment, the remote PC can serve the built frontend and
# the API from the same origin: http://REMOTE-IP:8015. This avoids temporary
# tunnel URLs and browser mixed-content issues on phones.
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="frontend-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str):
        if full_path.startswith(("api/", "uploads/")):
            raise HTTPException(status_code=404, detail="Not Found")

        requested_file = (FRONTEND_DIST / full_path).resolve()
        if requested_file.is_file() and FRONTEND_DIST in requested_file.parents:
            return FileResponse(requested_file)

        return FileResponse(FRONTEND_DIST / "index.html")

    @app.get("/erp", include_in_schema=False)
    @app.get("/erp/{full_path:path}", include_in_schema=False)
    def serve_erp_frontend(full_path: str = ""):
        if full_path.startswith(("api/", "uploads/")):
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(FRONTEND_DIST / "index.html")
