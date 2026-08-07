"""
core/database.py — SQLAlchemy engine, session, and base model.
"""
from __future__ import annotations
from pathlib import Path
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from typing import Generator
from core.config import BASE_DIR, env

DB_PATH = BASE_DIR / "proerp.db"


def _database_url() -> str:
    configured = env("DATABASE_URL", "")
    if configured.startswith("sqlite:///./"):
        relative_path = configured.removeprefix("sqlite:///./")
        return f"sqlite:///{(BASE_DIR / relative_path).resolve()}"
    return configured or f"sqlite:///{DB_PATH}"


DATABASE_URL = _database_url()


class Base(DeclarativeBase):
    pass


def _configure_sqlite(dbapi_connection, _record):
    c = dbapi_connection.cursor()
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    c.execute("PRAGMA cache_size=-65536")
    c.execute("PRAGMA temp_store=MEMORY")
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA mmap_size=268435456")
    c.execute("PRAGMA page_size=4096")
    c.close()


engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)
event.listen(engine, "connect", _configure_sqlite)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from models import (  # noqa: F401
        User, Role, Client, Product, ProductBundleComponent, Category, Supplier,
        Sale, SaleItem, Purchase, PurchaseItem,
        StockMovement, InventorySession, InventoryCountLine,
        Expense, CashSession, CashTransaction, AuditLog, Payment,
        AuthRateLimitAttempt,
        OperationKey,
        DocumentSequence, DocumentNumberAllocation,
        PrintJob, PrinterCounter,
        ResearchRequest, ResearchOutline, ResearchSection, ResearchSectionVersion,
        ResearchSource, ResearchAsset, ResearchOutput, ResearchStatusHistory,
        ResearchAIUsage, ResearchSetting,
    )
    Base.metadata.create_all(bind=engine)
    _migrate_schema()
    _create_indexes()
    _seed_defaults()


def _migrate_schema():
    migrations = {
        "products": [
            ("updated_at", "DATETIME"),
            ("pricing_mode", "VARCHAR(20) NOT NULL DEFAULT 'fixed'"),
            ("purchase_unit", "VARCHAR(20) NOT NULL DEFAULT 'pcs'"),
            ("purchase_to_base_factor", "NUMERIC(18,4) NOT NULL DEFAULT 1"),
            ("allow_fractional_sale", "BOOLEAN NOT NULL DEFAULT 0"),
        ],
        "roles": [("description", "VARCHAR(300)")],
        "users": [
            ("mfa_enabled", "BOOLEAN DEFAULT 0"),
            ("mfa_secret", "VARCHAR(512) DEFAULT ''"),
            ("mfa_recovery_codes", "TEXT DEFAULT ''"),
            ("session_version", "INTEGER NOT NULL DEFAULT 1"),
            ("refresh_jti_hash", "VARCHAR(64) DEFAULT ''"),
            ("password_changed_at", "DATETIME"),
        ],
        "audit_logs": [
            ("ip_address", "VARCHAR(80)"),
            ("user_agent", "VARCHAR(300)"),
            ("previous_hash", "VARCHAR(128)"),
            ("log_hash", "VARCHAR(128)"),
        ],
        "sales": [
            ("updated_at", "DATETIME"), ("version", "INTEGER NOT NULL DEFAULT 1"),
            ("discount_amount", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
            ("currency_code", "VARCHAR(3) NOT NULL DEFAULT 'MAD'"),
            ("price_tax_mode", "VARCHAR(10) NOT NULL DEFAULT 'exclusive'"),
            ("rounding_scope", "VARCHAR(10) NOT NULL DEFAULT 'line'"),
            ("tax_breakdown_json", "TEXT NOT NULL DEFAULT '[]'"),
        ],
        "sale_items": [
            ("discount_amount", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
            ("tax_amount", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
            ("total_amount", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
            ("catalog_unit_price", "NUMERIC(18,4) NOT NULL DEFAULT 0"),
            ("price_overridden", "BOOLEAN NOT NULL DEFAULT 0"),
            ("price_override_reason", "TEXT NOT NULL DEFAULT ''"),
        ],
        "purchases": [
            ("version", "INTEGER NOT NULL DEFAULT 1"),
            ("discount", "NUMERIC(7,4) NOT NULL DEFAULT 0"),
            ("discount_amount", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
            ("currency_code", "VARCHAR(3) NOT NULL DEFAULT 'MAD'"),
            ("price_tax_mode", "VARCHAR(10) NOT NULL DEFAULT 'exclusive'"),
            ("rounding_scope", "VARCHAR(10) NOT NULL DEFAULT 'line'"),
            ("tax_breakdown_json", "TEXT NOT NULL DEFAULT '[]'"),
        ],
        "purchase_items": [
            ("received_quantity", "NUMERIC(18,4) NOT NULL DEFAULT 0"),
            ("discount", "NUMERIC(7,4) NOT NULL DEFAULT 0"),
            ("discount_amount", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
            ("tax_amount", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
            ("total_amount", "NUMERIC(18,2) NOT NULL DEFAULT 0"),
            ("purchase_unit", "VARCHAR(20) NOT NULL DEFAULT ''"),
            ("conversion_factor", "NUMERIC(18,4) NOT NULL DEFAULT 1"),
            ("base_quantity", "NUMERIC(18,4) NOT NULL DEFAULT 0"),
            ("received_base_quantity", "NUMERIC(18,4) NOT NULL DEFAULT 0"),
        ],
        "payments": [
            ("kind", "VARCHAR(20) NOT NULL DEFAULT 'payment'"),
            ("reverses_payment_id", "INTEGER"),
            ("idempotency_key", "VARCHAR(128) DEFAULT ''"),
            ("payment_reference", "VARCHAR(80)"),
            ("operation_key", "VARCHAR(180)"),
            ("cash_session_id", "INTEGER"),
        ],
        "cash_sessions": [
            ("version", "INTEGER NOT NULL DEFAULT 1"),
            ("closed_by", "INTEGER"),
            ("difference_reason", "TEXT NOT NULL DEFAULT ''"),
            ("approved_by", "INTEGER"),
            ("approved_at", "DATETIME"),
        ],
        "cash_transactions": [
            ("payment_id", "INTEGER"),
            ("kind", "VARCHAR(20) NOT NULL DEFAULT 'movement'"),
            ("reverses_transaction_id", "INTEGER"),
            ("operation_key", "VARCHAR(180)"),
        ],
        "stock_movements": [
            ("warehouse_code", "VARCHAR(30) NOT NULL DEFAULT 'MAIN'"),
            ("source_type", "VARCHAR(30) NOT NULL DEFAULT 'legacy'"),
            ("source_id", "INTEGER"),
            ("source_line_id", "INTEGER"),
            ("operation_key", "VARCHAR(180)"),
            ("kind", "VARCHAR(20) NOT NULL DEFAULT 'movement'"),
            ("reverses_movement_id", "INTEGER"),
        ],
    }
    with engine.connect() as conn:
        for table, columns in migrations.items():
            try:
                existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()}
                for name, ddl_type in columns:
                    if name not in existing:
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl_type}"))
            except Exception:
                pass
        conn.commit()

    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS app_migrations "
            "(name VARCHAR(100) PRIMARY KEY, applied_at DATETIME NOT NULL)"
        ))
        pricing_backfill = conn.execute(text(
            "SELECT 1 FROM app_migrations WHERE name='service_pricing_mode_v1'"
        )).fetchone()
        if not pricing_backfill:
            # Existing services were historically sold with an editable price in POS.
            conn.execute(text(
                "UPDATE products SET pricing_mode='editable' WHERE product_type='service'"
            ))
            conn.execute(text(
                "INSERT INTO app_migrations(name,applied_at) "
                "VALUES('service_pricing_mode_v1',CURRENT_TIMESTAMP)"
            ))
        units_backfill = conn.execute(text(
            "SELECT 1 FROM app_migrations WHERE name='product_units_v1'"
        )).fetchone()
        if not units_backfill:
            conn.execute(text(
                "UPDATE products SET purchase_unit=coalesce(nullif(purchase_unit,''),unit,'pcs'), "
                "purchase_to_base_factor=coalesce(nullif(purchase_to_base_factor,0),1)"
            ))
            conn.execute(text(
                "UPDATE purchase_items SET "
                "conversion_factor=coalesce(nullif(conversion_factor,0),1), "
                "base_quantity=quantity*coalesce(nullif(conversion_factor,0),1), "
                "received_base_quantity=received_quantity*coalesce(nullif(conversion_factor,0),1)"
            ))
            conn.execute(text(
                "INSERT INTO app_migrations(name,applied_at) VALUES('product_units_v1',CURRENT_TIMESTAMP)"
            ))
        for role_name in ("admin", "manager", "cashier"):
            row = conn.execute(
                text("SELECT id,permissions FROM roles WHERE name=:name"),
                {"name": role_name},
            ).fetchone()
            if not row:
                continue
            permissions = {p.strip() for p in (row[1] or "").split(",") if p.strip()}
            if "all" not in permissions:
                permissions.add("sales.service_price_edit")
                conn.execute(
                    text("UPDATE roles SET permissions=:permissions WHERE id=:id"),
                    {"permissions": ",".join(sorted(permissions)), "id": row[0]},
                )


def _create_indexes():
    indexes = [
        "CREATE INDEX IF NOT EXISTS ix_products_code    ON products(code)",
        "CREATE INDEX IF NOT EXISTS ix_products_name    ON products(name)",
        "CREATE INDEX IF NOT EXISTS ix_sales_date       ON sales(date_time)",
        "CREATE INDEX IF NOT EXISTS ix_sales_client     ON sales(client_id)",
        "CREATE INDEX IF NOT EXISTS ix_sale_items_prod  ON sale_items(product_id)",
        "CREATE INDEX IF NOT EXISTS ix_purchases_date   ON purchases(date_time)",
        "CREATE INDEX IF NOT EXISTS ix_stock_product    ON stock_movements(product_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movement_operation ON stock_movements(operation_key)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movement_reversal ON stock_movements(reverses_movement_id)",
        "CREATE INDEX IF NOT EXISTS ix_stock_source ON stock_movements(source_type, source_id)",
        "CREATE INDEX IF NOT EXISTS ix_stock_warehouse ON stock_movements(warehouse_code)",
        "CREATE INDEX IF NOT EXISTS ix_bundle_component_product ON product_bundle_components(component_product_id)",
        "CREATE INDEX IF NOT EXISTS ix_audit_created    ON audit_logs(created_at)",
        "CREATE INDEX IF NOT EXISTS ix_audit_entity     ON audit_logs(entity, entity_id)",
        "CREATE INDEX IF NOT EXISTS ix_audit_user       ON audit_logs(created_by)",
        "CREATE INDEX IF NOT EXISTS ix_audit_action     ON audit_logs(action)",
        "CREATE INDEX IF NOT EXISTS ix_audit_hash       ON audit_logs(log_hash)",
        "CREATE INDEX IF NOT EXISTS ix_payments_doc     ON payments(document_type, document_id)",
        "CREATE INDEX IF NOT EXISTS ix_payments_created ON payments(created_at)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_reference ON payments(payment_reference)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_operation ON payments(operation_key)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_reversal ON payments(reverses_payment_id)",
        "CREATE INDEX IF NOT EXISTS ix_payment_cash_session ON payments(cash_session_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_single_open ON cash_sessions(status) WHERE status='open'",
        "CREATE INDEX IF NOT EXISTS ix_cash_session_status ON cash_sessions(status)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_transaction_operation ON cash_transactions(operation_key)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_transaction_reversal ON cash_transactions(reverses_transaction_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_transaction_payment ON cash_transactions(payment_id)",
        "CREATE INDEX IF NOT EXISTS ix_cash_transaction_session ON cash_transactions(session_id)",
    ]
    with engine.connect() as conn:
        for idx in indexes:
            try:
                conn.execute(text(idx))
            except Exception:
                pass
        conn.commit()


def _seed_defaults():
    """Create default admin user and roles if DB is empty."""
    from models.user import User, Role
    from core.security import hash_password, validate_password_strength
    from core.config import env
    db = SessionLocal()
    try:
        if db.query(Role).count() == 0:
            roles = [
                Role(name="admin",      description="Acces complet a tous les modules", permissions="all"),
                Role(name="manager",    description="Supervision des operations commerciales et rapports", permissions="dashboard,sales,sales.service_price_edit,purchases,reports,clients,products,suppliers,cash,cash.read,cash.open,cash.close,cash.transaction,cash.adjust"),
                Role(name="cashier",    description="Vente, POS, caisse et consultation clients/produits", permissions="dashboard,pos,sales,sales.service_price_edit,clients,products,cash,cash.read,cash.open,cash.close,cash.transaction,cash.adjust"),
                Role(name="warehouse",  description="Gestion catalogue, stock et achats", permissions="dashboard,products,stock,purchases,suppliers"),
            ]
            db.add_all(roles)
            db.flush()

        if db.query(User).count() == 0:
            initial_password = env("INITIAL_ADMIN_PASSWORD", "")
            if not initial_password:
                raise RuntimeError("INITIAL_ADMIN_PASSWORD is required for the first administrator")
            validate_password_strength(initial_password, "admin")
            admin_role = db.query(Role).filter(Role.name == "admin").first()
            admin = User(
                username="admin",
                password_hash=hash_password(initial_password),
                full_name="Administrator",
                email="admin@proerp.local",
                role_id=admin_role.id if admin_role else None,
                is_active=True,
            )
            db.add(admin)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
