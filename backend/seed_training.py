"""Add a repeatable stationery-shop training dataset to the Runtime database."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from decimal import Decimal

sys.path.insert(0, os.path.dirname(__file__))

from core.database import SessionLocal, init_db
from models import (
    CashSession, CashTransaction, Category, Client, Expense, InventoryCountLine,
    InventorySession, Payment, Product, ProductBundleComponent, Purchase,
    PurchaseItem, Sale, SaleItem, StockMovement, Supplier, User,
)
from services.money import MoneyPolicy, calculate_document, serialize_tax_breakdown

D = Decimal
MARKER = "TRAINING-DATA-V1"
POLICY = MoneyPolicy(tax_enabled=False)


def add_calculation(document, calculation):
    document.discount_amount = calculation["discount_amount"]
    document.subtotal = calculation["subtotal"]
    document.tax_amount = calculation["tax_amount"]
    document.total_amount = calculation["total_amount"]
    document.currency_code = calculation["currency_code"]
    document.price_tax_mode = calculation["price_tax_mode"]
    document.rounding_scope = calculation["rounding_scope"]
    document.tax_breakdown_json = serialize_tax_breakdown(calculation["tax_breakdown"])


def run():
    init_db()
    db = SessionLocal()
    try:
        if db.query(Sale).filter(Sale.notes == MARKER).first():
            print("Training data already installed; nothing was duplicated.")
            return

        admin = db.query(User).order_by(User.id).first()
        if not admin:
            raise RuntimeError("Create an administrator before loading training data.")
        now = datetime.now().replace(second=0, microsecond=0)

        categories = {}
        for name, description in [
            ("Écriture", "Stylos, crayons, marqueurs et correction"),
            ("Papeterie", "Cahiers, papier et blocs"),
            ("Classement", "Chemises, classeurs et rangement"),
            ("Arts scolaires", "Coloriage, dessin et activités"),
            ("Services boutique", "Photocopie, impression et numérisation"),
            ("Packs scolaires", "Packs composés de plusieurs articles"),
        ]:
            row = db.query(Category).filter(Category.name == name).first()
            if not row:
                row = Category(name=name, description=description)
                db.add(row)
                db.flush()
            categories[name] = row

        suppliers = {}
        for code, company, contact, phone, city in [
            ("TRAIN-F001", "Atlas Papeterie Distribution", "Youssef Amrani", "0522001100", "Casablanca"),
            ("TRAIN-F002", "Maroc Fournitures Scolaires", "Salma Idrissi", "0537002200", "Rabat"),
            ("TRAIN-F003", "Couleurs & Création", "Omar Alaoui", "0535003300", "Fès"),
        ]:
            row = db.query(Supplier).filter(Supplier.code == code).first()
            if not row:
                row = Supplier(code=code, company_name=company, contact_person=contact, phone=phone,
                               city=city, notes=MARKER, is_active=True)
                db.add(row)
                db.flush()
            suppliers[code] = row

        clients = {}
        for code, name, phone, city, terms, limit in [
            ("TRAIN-C001", "Client comptoir TEST", "0600000001", "Casablanca", 0, 0),
            ("TRAIN-C002", "École Al Amal TEST", "0600000002", "Casablanca", 30, 5000),
            ("TRAIN-C003", "Association Parents TEST", "0600000003", "Mohammedia", 15, 2500),
            ("TRAIN-C004", "Bureau Horizon TEST", "0600000004", "Rabat", 30, 4000),
            ("TRAIN-C005", "Mme Sara - Parent TEST", "0600000005", "Casablanca", 0, 500),
        ]:
            row = db.query(Client).filter(Client.code == code).first()
            if not row:
                row = Client(code=code, name=name, phone=phone, city=city, payment_terms=terms,
                             credit_limit=D(limit), notes=MARKER, is_active=True)
                db.add(row)
                db.flush()
            clients[code] = row

        product_rows = [
            # code, name, category, supplier, buy, sell, unit, purchase unit, factor, min, opening stock
            ("TRAIN-P001", "Stylo bille bleu", "Écriture", "TRAIN-F001", 1.20, 2.50, "pcs", "boîte", 50, 30, 0),
            ("TRAIN-P002", "Stylo bille rouge", "Écriture", "TRAIN-F001", 1.20, 2.50, "pcs", "boîte", 50, 15, 0),
            ("TRAIN-P003", "Crayon HB", "Écriture", "TRAIN-F001", 1.00, 2.00, "pcs", "boîte", 12, 20, 0),
            ("TRAIN-P004", "Gomme blanche", "Écriture", "TRAIN-F001", 1.50, 3.00, "pcs", "boîte", 20, 10, 0),
            ("TRAIN-P005", "Taille-crayon", "Écriture", "TRAIN-F001", 2.00, 4.00, "pcs", "boîte", 24, 10, 0),
            ("TRAIN-P006", "Cahier 96 pages", "Papeterie", "TRAIN-F002", 4.80, 8.00, "pcs", "paquet", 10, 20, 0),
            ("TRAIN-P007", "Cahier 192 pages", "Papeterie", "TRAIN-F002", 8.50, 14.00, "pcs", "paquet", 5, 10, 0),
            ("TRAIN-P008", "Rame papier A4 80g", "Papeterie", "TRAIN-F002", 42.00, 55.00, "rame", "carton", 5, 8, 0),
            ("TRAIN-P009", "Feuille Bristol couleur", "Papeterie", "TRAIN-F002", 1.00, 2.00, "pcs", "paquet", 25, 20, 0),
            ("TRAIN-P010", "Classeur A4 grand format", "Classement", "TRAIN-F002", 18.00, 28.00, "pcs", "carton", 12, 5, 0),
            ("TRAIN-P011", "Chemise à rabats", "Classement", "TRAIN-F002", 3.50, 6.00, "pcs", "paquet", 10, 10, 0),
            ("TRAIN-P012", "Boîte 12 crayons de couleur", "Arts scolaires", "TRAIN-F003", 14.00, 22.00, "boîte", "carton", 12, 6, 0),
            ("TRAIN-P013", "Peinture gouache 6 couleurs", "Arts scolaires", "TRAIN-F003", 18.00, 30.00, "boîte", "carton", 6, 4, 0),
            ("TRAIN-P014", "Colle en bâton", "Arts scolaires", "TRAIN-F003", 4.00, 7.00, "pcs", "boîte", 24, 10, 0),
            ("TRAIN-P015", "Règle 30 cm", "Arts scolaires", "TRAIN-F003", 2.50, 5.00, "pcs", "paquet", 20, 10, 0),
        ]
        products = {}
        for index, row in enumerate(product_rows, 1):
            code, name, cat, supplier, buy, sell, unit, purchase_unit, factor, minimum, stock = row
            product = db.query(Product).filter(Product.code == code).first()
            if not product:
                product = Product(
                    code=code, barcode=f"611000100{index:03d}", name=name,
                    category_id=categories[cat].id, supplier_id=suppliers[supplier].id,
                    description=MARKER, purchase_price=D(str(buy)), sale_price=D(str(sell)),
                    stock_quantity=D(stock), min_stock=D(minimum), unit=unit,
                    purchase_unit=purchase_unit, purchase_to_base_factor=D(factor),
                    tax_rate=D(20), tva_enabled=0, product_type="product",
                    pricing_mode="fixed", is_active=1,
                )
                db.add(product)
                db.flush()
            products[code] = product

        for code, name in [
            ("TRAIN-S001", "Photocopie noir & blanc"),
            ("TRAIN-S002", "Photocopie couleur"),
            ("TRAIN-S003", "Impression noir & blanc"),
            ("TRAIN-S004", "Impression couleur"),
            ("TRAIN-S005", "Numérisation de document"),
        ]:
            product = db.query(Product).filter(Product.code == code).first()
            if not product:
                product = Product(
                    code=code, name=name, category_id=categories["Services boutique"].id,
                    description=f"{MARKER} - Prix saisi au moment de la vente",
                    purchase_price=0, sale_price=0, stock_quantity=0, min_stock=0,
                    unit="pcs", purchase_unit="pcs", purchase_to_base_factor=1,
                    tax_rate=0, tva_enabled=0, product_type="service",
                    pricing_mode="manual", is_active=1,
                )
                db.add(product)
                db.flush()
            products[code] = product

        pack = db.query(Product).filter(Product.code == "TRAIN-B001").first()
        if not pack:
            pack = Product(
                code="TRAIN-B001", name="Pack scolaire primaire TEST",
                category_id=categories["Packs scolaires"].id, description=MARKER,
                purchase_price=D("30.00"), sale_price=D("49.00"), stock_quantity=0,
                min_stock=0, unit="pack", purchase_unit="pack", purchase_to_base_factor=1,
                tax_rate=0, tva_enabled=0, product_type="bundle", pricing_mode="fixed", is_active=1,
            )
            db.add(pack)
            db.flush()
            for component_code, qty in [
                ("TRAIN-P001", 2), ("TRAIN-P002", 1), ("TRAIN-P003", 2),
                ("TRAIN-P004", 1), ("TRAIN-P005", 1), ("TRAIN-P006", 2),
                ("TRAIN-P011", 1), ("TRAIN-P015", 1),
            ]:
                db.add(ProductBundleComponent(
                    bundle_product_id=pack.id,
                    component_product_id=products[component_code].id,
                    quantity=D(qty),
                ))
        products["TRAIN-B001"] = pack

        # Received purchases exercise box/packet-to-piece conversion and build stock.
        purchase_specs = [
            ("TRAIN-ACH-001", "TRAIN-F001", 25, [("TRAIN-P001", 4), ("TRAIN-P002", 2), ("TRAIN-P003", 5), ("TRAIN-P004", 3), ("TRAIN-P005", 2)]),
            ("TRAIN-ACH-002", "TRAIN-F002", 16, [("TRAIN-P006", 10), ("TRAIN-P007", 8), ("TRAIN-P008", 6), ("TRAIN-P010", 3), ("TRAIN-P011", 6)]),
            ("TRAIN-ACH-003", "TRAIN-F003", 9, [("TRAIN-P012", 3), ("TRAIN-P013", 4), ("TRAIN-P014", 3), ("TRAIN-P015", 5)]),
        ]
        for number, supplier_code, days_ago, lines in purchase_specs:
            raw = []
            for code, purchase_qty in lines:
                product = products[code]
                raw.append(dict(product_id=product.id, description=product.name, quantity=D(purchase_qty),
                                unit_price=product.purchase_price * product.purchase_to_base_factor,
                                purchase_price=product.purchase_price, discount=0, tax_rate=0))
            calc = calculate_document(raw, policy=POLICY)
            purchase = Purchase(number=number, doc_type="receipt", status="paid",
                                supplier_id=suppliers[supplier_code].id, date_time=now - timedelta(days=days_ago),
                                notes=MARKER, created_by=admin.id, paid_amount=calc["total_amount"], is_paid=1)
            add_calculation(purchase, calc)
            db.add(purchase)
            db.flush()
            for line_no, (source, result) in enumerate(zip(lines, calc["items"]), 1):
                code, purchase_qty = source
                product = products[code]
                factor = D(product.purchase_to_base_factor)
                base_qty = D(purchase_qty) * factor
                item = PurchaseItem(
                    purchase_id=purchase.id, product_id=product.id, description=product.name,
                    quantity=D(purchase_qty), purchase_unit=product.purchase_unit,
                    conversion_factor=factor, base_quantity=base_qty, unit_price=result["unit_price"],
                    discount=0, tax_rate=0, discount_amount=result["discount_amount"],
                    line_total=result["line_total"], tax_amount=0, total_amount=result["total_amount"],
                    received_quantity=D(purchase_qty), received_base_quantity=base_qty,
                )
                db.add(item)
                db.flush()
                before = D(product.stock_quantity or 0)
                product.stock_quantity = before + base_qty
                db.add(StockMovement(
                    product_id=product.id, movement_type="in", quantity=base_qty,
                    before_qty=before, after_qty=product.stock_quantity, unit_cost=product.purchase_price,
                    reference=number, notes=MARKER, source_type="purchase", source_id=purchase.id,
                    source_line_id=item.id, operation_key=f"{MARKER}:purchase:{number}:{line_no}",
                    created_by=admin.id,
                ))

        # A validated inventory session with a small correction.
        session = InventorySession(
            reference="TRAIN-INV-001", status="validated", notes=MARKER,
            idempotency_key=f"{MARKER}:inventory", created_by=admin.id, counted_by=admin.id,
            counted_at=now - timedelta(days=7), validated_by=admin.id, validated_at=now - timedelta(days=7),
        )
        db.add(session)
        db.flush()
        counted_product = products["TRAIN-P009"]
        expected = D(counted_product.stock_quantity or 0)
        counted = expected + D(25)
        movement = StockMovement(
            product_id=counted_product.id, movement_type="inventory", quantity=D(25),
            before_qty=expected, after_qty=counted, unit_cost=counted_product.purchase_price,
            reference=session.reference, notes=MARKER, source_type="inventory", source_id=session.id,
            operation_key=f"{MARKER}:inventory:1", created_by=admin.id,
        )
        db.add(movement)
        db.flush()
        counted_product.stock_quantity = counted
        db.add(InventoryCountLine(
            session_id=session.id, product_id=counted_product.id, expected_qty=expected,
            counted_qty=counted, difference=D(25), movement_id=movement.id,
            counted_by=admin.id, counted_at=session.counted_at,
        ))

        cash_session = db.query(CashSession).filter(CashSession.status == "open").first()
        if not cash_session:
            cash_session = CashSession(opened_by=admin.id, opened_at=now - timedelta(days=6),
                                       opening_balance=D("300"), status="open", notes=MARKER)
            db.add(cash_session)
            db.flush()

        sale_specs = [
            ("TRAIN-VTE-001", 6, "TRAIN-C001", "cash", [("TRAIN-P001", 3, None), ("TRAIN-P006", 2, None)]),
            ("TRAIN-VTE-002", 5, "TRAIN-C002", "bank", [("TRAIN-P008", 3, None), ("TRAIN-P010", 4, None)]),
            ("TRAIN-VTE-003", 4, "TRAIN-C005", "cash", [("TRAIN-B001", 2, None)]),
            ("TRAIN-VTE-004", 3, "TRAIN-C001", "cash", [("TRAIN-S001", 18, 0.50), ("TRAIN-S002", 3, 2.00)]),
            ("TRAIN-VTE-005", 2, "TRAIN-C004", "card", [("TRAIN-P007", 5, None), ("TRAIN-P012", 2, None), ("TRAIN-S003", 20, 0.75)]),
            ("TRAIN-VTE-006", 1, "TRAIN-C003", "cash", [("TRAIN-P011", 8, None), ("TRAIN-P014", 6, None)]),
            ("TRAIN-VTE-007", 0, "TRAIN-C001", "cash", [("TRAIN-S004", 5, 3.50), ("TRAIN-S005", 2, 5.00)]),
        ]
        for number, days_ago, client_code, mode, lines in sale_specs:
            raw = []
            for code, qty, manual_price in lines:
                product = products[code]
                price = D(str(manual_price)) if manual_price is not None else D(product.sale_price)
                raw.append(dict(product_id=product.id, description=product.name, quantity=D(qty),
                                unit_price=price, catalog_unit_price=D(product.sale_price or 0),
                                price_overridden=manual_price is not None,
                                price_override_reason="Prix service défini pour le client" if manual_price is not None else "",
                                purchase_price=D(product.purchase_price or 0), discount=0, tax_rate=0))
            calc = calculate_document(raw, policy=POLICY)
            sale = Sale(
                number=number, doc_type="invoice", status="paid", client_id=clients[client_code].id,
                date_time=now - timedelta(days=days_ago), notes=MARKER, payment_mode=mode,
                paid_amount=calc["total_amount"], created_by=admin.id,
            )
            add_calculation(sale, calc)
            db.add(sale)
            db.flush()
            for line_no, (source, result) in enumerate(zip(lines, calc["items"]), 1):
                code, qty, manual_price = source
                product = products[code]
                item = SaleItem(sale_id=sale.id, **result)
                db.add(item)
                db.flush()
                stock_lines = [(product, D(qty))]
                if product.product_type == "service":
                    stock_lines = []
                elif product.product_type == "bundle":
                    stock_lines = [(component.component, D(qty) * D(component.quantity))
                                   for component in product.bundle_components]
                for part, stock_qty in stock_lines:
                    before = D(part.stock_quantity or 0)
                    part.stock_quantity = before - stock_qty
                    db.add(StockMovement(
                        product_id=part.id, movement_type="out", quantity=stock_qty,
                        before_qty=before, after_qty=part.stock_quantity, unit_cost=part.purchase_price,
                        reference=number, notes=MARKER, source_type="sale", source_id=sale.id,
                        source_line_id=item.id, operation_key=f"{MARKER}:sale:{number}:{line_no}:{part.id}",
                        created_by=admin.id,
                    ))
            payment = Payment(
                document_type="sale", document_id=sale.id, amount=calc["total_amount"],
                payment_mode=mode, reference=number, notes=MARKER, created_by=admin.id,
                idempotency_key=f"{MARKER}:payment:{number}",
                payment_reference=f"PAY-{number}", operation_key=f"{MARKER}:payment:{number}",
                cash_session_id=cash_session.id if mode == "cash" else None,
            )
            db.add(payment)
            db.flush()
            if mode == "cash":
                db.add(CashTransaction(
                    session_id=cash_session.id, direction="in", amount=calc["total_amount"],
                    source="sale_payment", reference=number, description=MARKER,
                    created_by=admin.id, payment_id=payment.id,
                    operation_key=f"{MARKER}:cash:{number}",
                ))

        # Documents useful for workflow training: one quote and one unpaid invoice.
        for number, doc_type, status, client_code, days_ago, code, qty in [
            ("TRAIN-DEV-001", "quote", "draft", "TRAIN-C002", 0, "TRAIN-B001", 15),
            ("TRAIN-IMP-001", "invoice", "confirmed", "TRAIN-C004", 1, "TRAIN-P008", 10),
        ]:
            product = products[code]
            calc = calculate_document([dict(product_id=product.id, description=product.name, quantity=D(qty),
                                                unit_price=product.sale_price, purchase_price=product.purchase_price,
                                                discount=0, tax_rate=0)], policy=POLICY)
            sale = Sale(number=number, doc_type=doc_type, status=status, client_id=clients[client_code].id,
                        date_time=now - timedelta(days=days_ago), due_date=now + timedelta(days=30),
                        notes=MARKER, payment_mode="bank", paid_amount=0, created_by=admin.id)
            add_calculation(sale, calc)
            db.add(sale)
            db.flush()
            db.add(SaleItem(sale_id=sale.id, **calc["items"][0]))

        for index, (category, description, amount, days_ago, mode) in enumerate([
            ("Loyer", "Loyer mensuel boutique TEST", 2800, 20, "Virement"),
            ("Énergie (eau/élec)", "Électricité boutique TEST", 420, 12, "Virement"),
            ("Fournitures", "Sacs et emballages TEST", 180, 8, "Espèce"),
            ("Maintenance", "Entretien Konica Minolta C424 TEST", 650, 5, "Espèce"),
            ("Communication", "Internet et téléphone TEST", 299, 3, "Carte"),
        ], 1):
            db.add(Expense(
                date=now - timedelta(days=days_ago), category=category, description=description,
                amount=D(amount), payment_method=mode, reference=f"TRAIN-DEP-{index:03d}",
                notes=MARKER, user_id=admin.id,
            ))

        db.commit()
        print("Training dataset installed successfully.")
        print("Added: 6 categories, 3 suppliers, 5 clients, 15 products, 5 services, 1 bundle,")
        print("3 purchases, 1 inventory, 7 paid sales, 1 quote, 1 unpaid invoice, 5 expenses.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run()
