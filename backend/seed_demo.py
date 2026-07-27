"""
seed_demo.py — Populate ProERP with realistic Moroccan demo data.
Run: python3 seed_demo.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime, timedelta
import random
from core.database import SessionLocal, init_db
from models import *
from decimal import Decimal
from services.money import calculate_document, quantize_money, serialize_tax_breakdown
from services.document_numbers import (
    commit_number_allocation,
    reserve_document_number,
    void_reserved_allocation,
)

random.seed(42)

def run():
    init_db()
    db = SessionLocal()
    active_allocation = None

    try:
        # ── Categories ────────────────────────────────────────────────────────
        cat_names = ["Informatique", "Bureautique", "Réseau & Télécom", "Consommables", "Mobilier", "Logiciels"]
        categories = {}
        for name in cat_names:
            if not db.query(Category).filter(Category.name == name).first():
                c = Category(name=name, description=f"Catégorie {name}")
                db.add(c)
                db.flush()
                categories[name] = c
            else:
                categories[name] = db.query(Category).filter(Category.name == name).first()
        db.commit()
        print(f"✅ {len(cat_names)} catégories")

        # ── Suppliers ─────────────────────────────────────────────────────────
        supplier_data = [
            ("Tech Maroc Distribution", "Ahmed Benali",    "0522-334455", "Casablanca"),
            ("Global IT Solutions",     "Sara El Fassi",   "0537-112233", "Rabat"),
            ("Bureau Plus SARL",        "Karim Tahiri",    "0539-445566", "Fès"),
            ("Net & Connect",           "Nadia Benjelloun","0528-778899", "Marrakech"),
        ]
        suppliers = []
        for i, (company, contact, phone, city) in enumerate(supplier_data, 1):
            if not db.query(Supplier).filter(Supplier.company_name == company).first():
                s = Supplier(code=f"FRN{str(i).zfill(4)}", company_name=company,
                             contact_person=contact, phone=phone, city=city, is_active=True)
                db.add(s)
                db.flush()
                suppliers.append(s)
            else:
                suppliers.append(db.query(Supplier).filter(Supplier.company_name == company).first())
        db.commit()
        print(f"✅ {len(suppliers)} fournisseurs")

        # ── Products ──────────────────────────────────────────────────────────
        products_data = [
            ("Laptop Dell Latitude 5540", "Informatique",   4800, 6500,  8, 2,  "pcs", 20),
            ("Laptop HP ProBook 450",     "Informatique",   5200, 7200, 10, 2,  "pcs", 20),
            ("Écran LCD 24\" Samsung",    "Informatique",   1200, 1650, 15, 3,  "pcs", 20),
            ("Clavier Logitech MK270",    "Bureautique",     180,  280, 25, 5,  "pcs", 20),
            ("Souris Logitech M171",      "Bureautique",     120,  180, 30, 5,  "pcs", 20),
            ("Switch 24 ports TP-Link",   "Réseau & Télécom",950, 1350, 5,  2,  "pcs", 20),
            ("Câble RJ45 Cat6 (boîte 50m)","Réseau & Télécom",80,  140, 40, 10, "boîte",20),
            ("Cartouche HP 650 Noire",    "Consommables",    95,  155, 60, 15, "pcs", 20),
            ("Rame papier A4 80g",        "Consommables",    35,   55, 100, 20, "boîte",20),
            ("Chaise de bureau ergonomique","Mobilier",      680,  980, 6,  2,  "pcs", 20),
            ("Bureau 140x70 cm",          "Mobilier",       1200, 1800, 4,  1,  "pcs", 20),
            ("Licence Office 365 (1an)",  "Logiciels",      850, 1200, 0,  0,  "licence",20),
            ("Antivirus Kaspersky 1an",   "Logiciels",      180,  290, 0,  0,  "licence",20),
            ("Imprimante Laser HP M404",  "Bureautique",    1800, 2450, 7,  2,  "pcs", 20),
            ("Disque dur externe 1TB",    "Informatique",    350,  520, 20, 5,  "pcs", 20),
        ]
        products = []
        for i, (name, cat, pp, sp, qty, minq, unit, tva) in enumerate(products_data, 1):
            if not db.query(Product).filter(Product.name == name).first():
                ptype = "service" if cat == "Logiciels" else "product"
                p = Product(
                    code=f"PRD{str(i).zfill(5)}", name=name,
                    category_id=categories[cat].id,
                    supplier_id=random.choice(suppliers).id,
                    purchase_price=pp, sale_price=sp,
                    stock_quantity=qty, min_stock=minq,
                    unit=unit, tax_rate=tva,
                    product_type=ptype, is_active=1,
                )
                db.add(p)
                db.flush()
                products.append(p)
            else:
                products.append(db.query(Product).filter(Product.name == name).first())
        db.commit()
        print(f"✅ {len(products)} produits")

        # ── Clients ───────────────────────────────────────────────────────────
        clients_data = [
            ("Groupe OCP SA",            "0522-778800", "Casablanca", "Industriel"),
            ("Maroc Telecom",            "0537-445566", "Rabat",      "Telecom"),
            ("BMCE Bank",                "0522-998877", "Casablanca", "Banque"),
            ("Pharmacie Centrale",       "0522-112244", "Casablanca", "Santé"),
            ("École Supérieure Tech",    "0537-334411", "Rabat",      "Éducation"),
            ("Cabinet Expertise Comptable","0522-556677","Casablanca","Services"),
            ("Hôtel Sofitel Casablanca", "0522-998800", "Casablanca", "Hôtellerie"),
            ("Clinique Al Amal",         "0522-334466", "Casablanca", "Santé"),
        ]
        clients = []
        for i, (name, phone, city, sector) in enumerate(clients_data, 1):
            if not db.query(Client).filter(Client.name == name).first():
                c = Client(code=f"CLI{str(i).zfill(4)}", name=name, phone=phone,
                           city=city, payment_terms=30, is_active=True)
                db.add(c)
                db.flush()
                clients.append(c)
            else:
                clients.append(db.query(Client).filter(Client.name == name).first())
        db.commit()
        print(f"✅ {len(clients)} clients")

        # ── Sales (last 60 days) ──────────────────────────────────────────────
        payment_modes = ["Espèce", "Virement", "Chèque", "Carte"]
        sale_count = 0
        for days_ago in range(60, 0, -1):
            # 1-4 sales per day
            num_sales = random.randint(0, 3)
            for _ in range(num_sales):
                client = random.choice(clients)
                n_items = random.randint(1, 4)
                sale_date = datetime.now() - timedelta(days=days_ago, hours=random.randint(8,18))
                mode = random.choice(payment_modes)

                items_data = []
                for _ in range(n_items):
                    prod = random.choice([p for p in products if p.product_type == "product"])
                    qty = random.randint(1, 5)
                    items_data.append({
                        "product_id": prod.id, "description": prod.name,
                        "quantity": qty, "unit_price": prod.sale_price,
                        "purchase_price": prod.purchase_price,
                        "discount": random.choice([0, 0, 0, 5, 10]),
                        "tax_rate": prod.tax_rate,
                    })

                calculation = calculate_document(items_data)
                total = calculation["total_amount"]
                paid = total if random.random() > 0.25 else quantize_money(total * random.choice([Decimal("0"), Decimal("0.5")]))

                active_allocation = reserve_document_number(
                    db, "sale", "invoice", document_date=sale_date, created_by=1,
                )
                number = active_allocation.document_number

                sale = Sale(
                    number=number, doc_type="invoice", status="confirmed",
                    client_id=client.id, date_time=sale_date,
                    payment_mode=mode, paid_amount=paid,
                    subtotal=calculation["subtotal"], tax_amount=calculation["tax_amount"],
                    total_amount=total, discount=0, discount_amount=calculation["discount_amount"], created_by=1,
                    currency_code=calculation["currency_code"], price_tax_mode=calculation["price_tax_mode"],
                    rounding_scope=calculation["rounding_scope"], tax_breakdown_json=serialize_tax_breakdown(calculation["tax_breakdown"]),
                )
                if paid >= total:
                    sale.status = "paid"
                db.add(sale)
                db.flush()

                for line_index, item in enumerate(calculation["items"], start=1):
                    sale_item = SaleItem(sale_id=sale.id, **item)
                    db.add(sale_item)
                    db.flush()
                    # update stock
                    p = db.query(Product).filter(Product.id == item["product_id"]).first()
                    if p:
                        before = p.stock_quantity
                        p.stock_quantity = max(0, p.stock_quantity - item["quantity"])
                        db.add(StockMovement(
                            product_id=p.id, movement_type="out",
                            quantity=item["quantity"], before_qty=before,
                            after_qty=p.stock_quantity, unit_cost=item["purchase_price"],
                            reference=number, created_by=1,
                            warehouse_code="MAIN", source_type="sale",
                            source_id=sale.id, source_line_id=sale_item.id,
                            operation_key=f"seed:sale:{sale.id}:line:{line_index}",
                            kind="movement",
                        ))

                sale_count += 1
                commit_number_allocation(db, active_allocation.allocation_id, sale.id)
                db.commit()
                active_allocation = None
        print(f"✅ {sale_count} factures créées (60 jours)")

        # ── Expenses ──────────────────────────────────────────────────────────
        expense_data = [
            ("Loyer", "Loyer local commercial - mois courant", 8500),
            ("Salaires", "Salaires équipe commerciale", 25000),
            ("Salaires", "Salaires équipe technique", 18000),
            ("Énergie (eau/élec)", "Facture électricité", 1200),
            ("Communication", "Abonnement Internet Maroc Telecom", 600),
            ("Transport", "Carburant véhicules société", 2400),
            ("Fournitures", "Fournitures bureau", 850),
            ("Marketing", "Campagne publicité Facebook", 3000),
            ("Maintenance", "Maintenance climatisation", 1500),
            ("Taxes & Impôts", "TVA mensuelle", 4200),
        ]
        for i, (cat, desc, amount) in enumerate(expense_data):
            date_offset = timedelta(days=random.randint(0, 29))
            db.add(Expense(
                date=datetime.now() - date_offset,
                category=cat, description=desc, amount=amount,
                payment_method="Virement", user_id=1,
            ))
        db.commit()
        print(f"✅ {len(expense_data)} dépenses")

        # ── Purchases ─────────────────────────────────────────────────────────
        for i, supplier in enumerate(suppliers[:3]):
            n_items = random.randint(2, 4)
            purchase_date = datetime.now() - timedelta(days=random.randint(5, 20))
            active_allocation = reserve_document_number(
                db, "purchase", "order", document_date=purchase_date, created_by=1,
            )
            number = active_allocation.document_number
            p = Purchase(
                number=number, doc_type="order", status="received",
                supplier_id=supplier.id, date_time=purchase_date,
                created_by=1,
            )
            db.add(p)
            db.flush()
            items_data = []
            for line_index in range(1, n_items + 1):
                prod = random.choice(products[:10])
                qty = random.randint(5, 20)
                items_data.append({
                    "product_id": prod.id,
                    "description": prod.name, "quantity": qty,
                    "unit_price": prod.purchase_price, "discount": 0, "tax_rate": 20,
                })
                # Add stock
                before = prod.stock_quantity
                prod.stock_quantity += qty
                db.add(StockMovement(
                    product_id=prod.id, movement_type="in", quantity=qty,
                    before_qty=before, after_qty=prod.stock_quantity,
                    unit_cost=prod.purchase_price, reference=number, created_by=1,
                    warehouse_code="MAIN", source_type="purchase",
                    source_id=p.id,
                    operation_key=f"seed:purchase:{p.id}:line:{line_index}",
                    kind="movement",
                ))
            calculation = calculate_document(items_data)
            p.discount = 0
            p.discount_amount = calculation["discount_amount"]
            p.subtotal = calculation["subtotal"]
            p.tax_amount = calculation["tax_amount"]
            p.total_amount = calculation["total_amount"]
            p.paid_amount = calculation["total_amount"]
            p.currency_code = calculation["currency_code"]
            p.price_tax_mode = calculation["price_tax_mode"]
            p.rounding_scope = calculation["rounding_scope"]
            p.tax_breakdown_json = serialize_tax_breakdown(calculation["tax_breakdown"])
            for item in calculation["items"]:
                db.add(PurchaseItem(
                    purchase_id=p.id, product_id=item.get("product_id"), description=item.get("description", ""),
                    quantity=item["quantity"], unit_price=item["unit_price"], discount=item["discount"],
                    tax_rate=item["tax_rate"], discount_amount=item["discount_amount"], line_total=item["line_total"],
                    tax_amount=item["tax_amount"], total_amount=item["total_amount"], received_quantity=item["quantity"],
                ))
            commit_number_allocation(db, active_allocation.allocation_id, p.id)
            db.commit()
            active_allocation = None
        print(f"✅ 3 commandes fournisseurs")

        print("\n✅ Demo data seeded successfully!")
        print("   Demo administrator created; use the configured local credentials")

    except Exception as e:
        db.rollback()
        if active_allocation is not None:
            void_reserved_allocation(db, active_allocation.allocation_id, f"seed_failed_{type(e).__name__}")
        print(f"❌ Error: {e}")
        import traceback; traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    run()
