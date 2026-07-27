"""Phase 4: rebuild SQLite financial columns as NUMERIC without changing values."""
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "proerp.db"


UP_TABLES = {
    "products": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY, code VARCHAR(50) UNIQUE, name VARCHAR(200) NOT NULL,
        category_id INTEGER, supplier_id INTEGER, description TEXT,
        purchase_price NUMERIC(18,4), sale_price NUMERIC(18,4), stock_quantity NUMERIC(18,4), min_stock NUMERIC(18,4),
        barcode VARCHAR(100), image_path VARCHAR(300), unit VARCHAR(20), tax_rate NUMERIC(7,4),
        tva_enabled INTEGER, product_type VARCHAR(20), is_active INTEGER, created_at DATETIME, updated_at DATETIME,
        FOREIGN KEY(category_id) REFERENCES categories(id), FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
    )""",
    "clients": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY, code VARCHAR(50) UNIQUE, name VARCHAR(200) NOT NULL,
        phone VARCHAR(50), email VARCHAR(200), address TEXT, city VARCHAR(100), tax_id VARCHAR(100), ice VARCHAR(100),
        payment_terms INTEGER, credit_limit NUMERIC(18,2), credit_balance NUMERIC(18,2), notes TEXT,
        is_active BOOLEAN, created_at DATETIME
    )""",
    "sales": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY, number VARCHAR(50) UNIQUE, doc_type VARCHAR(20), status VARCHAR(20),
        client_id INTEGER, date_time DATETIME, due_date DATETIME, notes TEXT,
        discount NUMERIC(7,4), discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
        subtotal NUMERIC(18,2), tax_amount NUMERIC(18,2), total_amount NUMERIC(18,2), paid_amount NUMERIC(18,2),
        payment_mode VARCHAR(30), created_by INTEGER, created_at DATETIME, parent_id INTEGER, updated_at DATETIME,
        version INTEGER NOT NULL DEFAULT 1, currency_code VARCHAR(3) NOT NULL DEFAULT 'MAD',
        price_tax_mode VARCHAR(10) NOT NULL DEFAULT 'exclusive', rounding_scope VARCHAR(10) NOT NULL DEFAULT 'line',
        tax_breakdown_json TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY(client_id) REFERENCES clients(id), FOREIGN KEY(created_by) REFERENCES users(id),
        FOREIGN KEY(parent_id) REFERENCES {table}(id)
    )""",
    "sale_items": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY, sale_id INTEGER, product_id INTEGER, description TEXT,
        quantity NUMERIC(18,4), unit_price NUMERIC(18,4), purchase_price NUMERIC(18,4),
        discount NUMERIC(7,4), tax_rate NUMERIC(7,4), discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
        line_total NUMERIC(18,2), tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
        total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
        FOREIGN KEY(sale_id) REFERENCES sales(id), FOREIGN KEY(product_id) REFERENCES products(id)
    )""",
    "purchases": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY, number VARCHAR(50) UNIQUE, doc_type VARCHAR(20), status VARCHAR(20),
        supplier_id INTEGER, date_time DATETIME, expected_date DATETIME, notes TEXT,
        discount NUMERIC(7,4) NOT NULL DEFAULT 0, discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
        subtotal NUMERIC(18,2), tax_amount NUMERIC(18,2),
        total_amount NUMERIC(18,2), paid_amount NUMERIC(18,2), is_paid INTEGER, created_by INTEGER,
        created_at DATETIME, version INTEGER NOT NULL DEFAULT 1, currency_code VARCHAR(3) NOT NULL DEFAULT 'MAD',
        price_tax_mode VARCHAR(10) NOT NULL DEFAULT 'exclusive', rounding_scope VARCHAR(10) NOT NULL DEFAULT 'line',
        tax_breakdown_json TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY(supplier_id) REFERENCES suppliers(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )""",
    "purchase_items": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY, purchase_id INTEGER, product_id INTEGER, description TEXT,
        quantity NUMERIC(18,4), unit_price NUMERIC(18,4), discount NUMERIC(7,4) NOT NULL DEFAULT 0,
        tax_rate NUMERIC(7,4),
        discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0, line_total NUMERIC(18,2),
        tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0, total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
        received_quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
        FOREIGN KEY(purchase_id) REFERENCES purchases(id), FOREIGN KEY(product_id) REFERENCES products(id)
    )""",
    "payments": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, document_type VARCHAR(30) NOT NULL, document_id INTEGER NOT NULL,
        amount NUMERIC(18,2), payment_mode VARCHAR(50), reference VARCHAR(120), notes TEXT, created_at DATETIME,
        created_by INTEGER, kind VARCHAR(20) NOT NULL DEFAULT 'payment', reverses_payment_id INTEGER,
        idempotency_key VARCHAR(128) DEFAULT '', FOREIGN KEY(created_by) REFERENCES users(id),
        FOREIGN KEY(reverses_payment_id) REFERENCES {table}(id)
    )""",
    "expenses": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY, date DATETIME NOT NULL, category VARCHAR(100), description VARCHAR(255) NOT NULL,
        amount NUMERIC(18,2) NOT NULL, payment_method VARCHAR(50), reference VARCHAR(100), notes TEXT,
        user_id INTEGER, created_at DATETIME, FOREIGN KEY(user_id) REFERENCES users(id)
    )""",
    "cash_sessions": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY, opened_by INTEGER, opened_at DATETIME, closed_at DATETIME,
        opening_balance NUMERIC(18,2), closing_balance NUMERIC(18,2), expected_balance NUMERIC(18,2),
        difference NUMERIC(18,2), status VARCHAR(20), notes TEXT, FOREIGN KEY(opened_by) REFERENCES users(id)
    )""",
    "cash_transactions": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY, session_id INTEGER, direction VARCHAR(10), amount NUMERIC(18,2),
        source VARCHAR(30), reference VARCHAR(100), description TEXT, created_at DATETIME, created_by INTEGER,
        FOREIGN KEY(session_id) REFERENCES cash_sessions(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )""",
    "stock_movements": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY, product_id INTEGER, movement_type VARCHAR(20), quantity NUMERIC(18,4),
        before_qty NUMERIC(18,4), after_qty NUMERIC(18,4), unit_cost NUMERIC(18,4), reference VARCHAR(100),
        notes TEXT, created_at DATETIME, created_by INTEGER,
        FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )""",
}

DOWN_TABLES = {
    "products": UP_TABLES["products"].replace("NUMERIC(18,4)", "FLOAT").replace("NUMERIC(7,4)", "FLOAT"),
    "clients": UP_TABLES["clients"].replace("NUMERIC(18,2)", "FLOAT"),
    "payments": UP_TABLES["payments"].replace("NUMERIC(18,2)", "FLOAT"),
    "expenses": UP_TABLES["expenses"].replace("NUMERIC(18,2)", "FLOAT"),
    "cash_sessions": UP_TABLES["cash_sessions"].replace("NUMERIC(18,2)", "FLOAT"),
    "cash_transactions": UP_TABLES["cash_transactions"].replace("NUMERIC(18,2)", "FLOAT"),
    "stock_movements": UP_TABLES["stock_movements"].replace("NUMERIC(18,4)", "FLOAT"),
    "sales": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY, number VARCHAR(50) UNIQUE, doc_type VARCHAR(20), status VARCHAR(20),
        client_id INTEGER, date_time DATETIME, due_date DATETIME, notes TEXT, discount FLOAT, subtotal FLOAT,
        tax_amount FLOAT, total_amount FLOAT, paid_amount FLOAT, payment_mode VARCHAR(30), created_by INTEGER,
        created_at DATETIME, parent_id INTEGER, updated_at DATETIME, version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY(client_id) REFERENCES clients(id), FOREIGN KEY(created_by) REFERENCES users(id),
        FOREIGN KEY(parent_id) REFERENCES {table}(id)
    )""",
    "sale_items": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY, sale_id INTEGER, product_id INTEGER, description TEXT, quantity FLOAT,
        unit_price FLOAT, purchase_price FLOAT, discount FLOAT, tax_rate FLOAT, line_total FLOAT,
        FOREIGN KEY(sale_id) REFERENCES sales(id), FOREIGN KEY(product_id) REFERENCES products(id)
    )""",
    "purchases": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY, number VARCHAR(50) UNIQUE, doc_type VARCHAR(20), status VARCHAR(20),
        supplier_id INTEGER, date_time DATETIME, expected_date DATETIME, notes TEXT, subtotal FLOAT,
        tax_amount FLOAT, total_amount FLOAT, paid_amount FLOAT, is_paid INTEGER, created_by INTEGER,
        created_at DATETIME, version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY(supplier_id) REFERENCES suppliers(id), FOREIGN KEY(created_by) REFERENCES users(id)
    )""",
    "purchase_items": """CREATE TABLE {table} (
        id INTEGER NOT NULL PRIMARY KEY, purchase_id INTEGER, product_id INTEGER, description TEXT, quantity FLOAT,
        unit_price FLOAT, tax_rate FLOAT, line_total FLOAT, received_quantity FLOAT NOT NULL DEFAULT 0,
        FOREIGN KEY(purchase_id) REFERENCES purchases(id), FOREIGN KEY(product_id) REFERENCES products(id)
    )""",
}

UP_COLUMNS = {
    "products": "id,code,name,category_id,supplier_id,description,purchase_price,sale_price,stock_quantity,min_stock,barcode,image_path,unit,tax_rate,tva_enabled,product_type,is_active,created_at,updated_at",
    "clients": "id,code,name,phone,email,address,city,tax_id,ice,payment_terms,credit_limit,credit_balance,notes,is_active,created_at",
    "sales": "id,number,doc_type,status,client_id,date_time,due_date,notes,discount,discount_amount,subtotal,tax_amount,total_amount,paid_amount,payment_mode,created_by,created_at,parent_id,updated_at,version,currency_code,price_tax_mode,rounding_scope,tax_breakdown_json",
    "sale_items": "id,sale_id,product_id,description,quantity,unit_price,purchase_price,discount,tax_rate,discount_amount,line_total,tax_amount,total_amount",
    "purchases": "id,number,doc_type,status,supplier_id,date_time,expected_date,notes,discount,discount_amount,subtotal,tax_amount,total_amount,paid_amount,is_paid,created_by,created_at,version,currency_code,price_tax_mode,rounding_scope,tax_breakdown_json",
    "purchase_items": "id,purchase_id,product_id,description,quantity,unit_price,discount,tax_rate,discount_amount,line_total,tax_amount,total_amount,received_quantity",
    "payments": "id,document_type,document_id,amount,payment_mode,reference,notes,created_at,created_by,kind,reverses_payment_id,idempotency_key",
    "expenses": "id,date,category,description,amount,payment_method,reference,notes,user_id,created_at",
    "cash_sessions": "id,opened_by,opened_at,closed_at,opening_balance,closing_balance,expected_balance,difference,status,notes",
    "cash_transactions": "id,session_id,direction,amount,source,reference,description,created_at,created_by",
    "stock_movements": "id,product_id,movement_type,quantity,before_qty,after_qty,unit_cost,reference,notes,created_at,created_by",
}

UP_SELECT = {
    "products": "id,code,name,category_id,supplier_id,description,CAST(purchase_price AS NUMERIC),CAST(sale_price AS NUMERIC),CAST(stock_quantity AS NUMERIC),CAST(min_stock AS NUMERIC),barcode,image_path,unit,CAST(tax_rate AS NUMERIC),tva_enabled,product_type,is_active,created_at,updated_at",
    "clients": "id,code,name,phone,email,address,city,tax_id,ice,payment_terms,CAST(credit_limit AS NUMERIC),CAST(credit_balance AS NUMERIC),notes,is_active,created_at",
    "sales": "id,number,doc_type,status,client_id,date_time,due_date,notes,CAST(discount AS NUMERIC),0,CAST(subtotal AS NUMERIC),CAST(tax_amount AS NUMERIC),CAST(total_amount AS NUMERIC),CAST(paid_amount AS NUMERIC),payment_mode,created_by,created_at,parent_id,updated_at,version,'MAD','exclusive','line','[]'",
    "sale_items": "id,sale_id,product_id,description,CAST(quantity AS NUMERIC),CAST(unit_price AS NUMERIC),CAST(purchase_price AS NUMERIC),CAST(discount AS NUMERIC),CAST(tax_rate AS NUMERIC),0,CAST(line_total AS NUMERIC),0,CAST(line_total AS NUMERIC)",
    "purchases": "id,number,doc_type,status,supplier_id,date_time,expected_date,notes,0,0,CAST(subtotal AS NUMERIC),CAST(tax_amount AS NUMERIC),CAST(total_amount AS NUMERIC),CAST(paid_amount AS NUMERIC),is_paid,created_by,created_at,version,'MAD','exclusive','line','[]'",
    "purchase_items": "id,purchase_id,product_id,description,CAST(quantity AS NUMERIC),CAST(unit_price AS NUMERIC),0,CAST(tax_rate AS NUMERIC),0,CAST(line_total AS NUMERIC),0,CAST(line_total AS NUMERIC),CAST(received_quantity AS NUMERIC)",
    "payments": "id,document_type,document_id,CAST(amount AS NUMERIC),payment_mode,reference,notes,created_at,created_by,kind,reverses_payment_id,idempotency_key",
    "expenses": "id,date,category,description,CAST(amount AS NUMERIC),payment_method,reference,notes,user_id,created_at",
    "cash_sessions": "id,opened_by,opened_at,closed_at,CAST(opening_balance AS NUMERIC),CAST(closing_balance AS NUMERIC),CAST(expected_balance AS NUMERIC),CAST(difference AS NUMERIC),status,notes",
    "cash_transactions": "id,session_id,direction,CAST(amount AS NUMERIC),source,reference,description,created_at,created_by",
    "stock_movements": "id,product_id,movement_type,CAST(quantity AS NUMERIC),CAST(before_qty AS NUMERIC),CAST(after_qty AS NUMERIC),CAST(unit_cost AS NUMERIC),reference,notes,created_at,created_by",
}

DOWN_COLUMNS = {
    **{key: value for key, value in UP_COLUMNS.items() if key not in {"sales", "sale_items", "purchases", "purchase_items"}},
    "sales": "id,number,doc_type,status,client_id,date_time,due_date,notes,discount,subtotal,tax_amount,total_amount,paid_amount,payment_mode,created_by,created_at,parent_id,updated_at,version",
    "sale_items": "id,sale_id,product_id,description,quantity,unit_price,purchase_price,discount,tax_rate,line_total",
    "purchases": "id,number,doc_type,status,supplier_id,date_time,expected_date,notes,subtotal,tax_amount,total_amount,paid_amount,is_paid,created_by,created_at,version",
    "purchase_items": "id,purchase_id,product_id,description,quantity,unit_price,tax_rate,line_total,received_quantity",
}

INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_prod_code ON products(code)", "CREATE INDEX IF NOT EXISTS ix_prod_name ON products(name)",
    "CREATE INDEX IF NOT EXISTS ix_prod_active ON products(is_active)", "CREATE INDEX IF NOT EXISTS ix_products_code ON products(code)",
    "CREATE INDEX IF NOT EXISTS ix_products_name ON products(name)", "CREATE INDEX IF NOT EXISTS ix_sale_datetime ON sales(date_time)",
    "CREATE INDEX IF NOT EXISTS ix_sale_client ON sales(client_id)", "CREATE INDEX IF NOT EXISTS ix_sale_doctype ON sales(doc_type)",
    "CREATE INDEX IF NOT EXISTS ix_sale_status ON sales(status)", "CREATE INDEX IF NOT EXISTS ix_sales_date ON sales(date_time)",
    "CREATE INDEX IF NOT EXISTS ix_sales_client ON sales(client_id)", "CREATE INDEX IF NOT EXISTS ix_sale_items_prod ON sale_items(product_id)",
    "CREATE INDEX IF NOT EXISTS ix_purchase_datetime ON purchases(date_time)", "CREATE INDEX IF NOT EXISTS ix_purchase_supplier ON purchases(supplier_id)",
    "CREATE INDEX IF NOT EXISTS ix_purchases_date ON purchases(date_time)", "CREATE INDEX IF NOT EXISTS ix_payments_doc ON payments(document_type,document_id)",
    "CREATE INDEX IF NOT EXISTS ix_payments_created ON payments(created_at)", "CREATE INDEX IF NOT EXISTS ix_payment_reversal ON payments(reverses_payment_id)",
    "CREATE INDEX IF NOT EXISTS ix_stock_product ON stock_movements(product_id)",
]


def _rebuild(connection: sqlite3.Connection, table: str, ddl: str, target_columns: str, select_columns: str) -> None:
    temporary = f"__phase4_{table}_new"
    connection.execute(f"DROP TABLE IF EXISTS {temporary}")
    connection.execute(ddl.format(table=temporary))
    connection.execute(f"INSERT INTO {temporary} ({target_columns}) SELECT {select_columns} FROM {table}")
    connection.execute(f"DROP TABLE {table}")
    connection.execute(f"ALTER TABLE {temporary} RENAME TO {table}")


def _run(db_path: Path, upgrade: bool) -> None:
    connection = sqlite3.connect(db_path, timeout=60)
    try:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute("BEGIN IMMEDIATE")
        definitions = UP_TABLES if upgrade else DOWN_TABLES
        columns = UP_COLUMNS if upgrade else DOWN_COLUMNS
        for table in UP_TABLES:
            select_columns = UP_SELECT[table] if upgrade else columns[table]
            _rebuild(connection, table, definitions[table], columns[table], select_columns)
        for statement in INDEXES:
            connection.execute(statement)
        foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_errors:
            raise RuntimeError(f"Foreign key errors after phase4 migration: {foreign_key_errors[:5]}")
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite integrity check failed")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.close()


def upgrade(db_path: Path = DB_PATH) -> None:
    _run(db_path, True)


def downgrade(db_path: Path = DB_PATH) -> None:
    _run(db_path, False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("direction", choices=("up", "down"), nargs="?", default="up")
    parser.add_argument("--db", type=Path, default=DB_PATH)
    args = parser.parse_args()
    (upgrade if args.direction == "up" else downgrade)(args.db)
    print(f"phase4 {args.direction}: ok")
