from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.database import Base
from models import *  # noqa: F401,F403 - registers every mapped relationship
from models.payment import Payment
from models.product import Product
from models.purchase import Purchase, PurchaseItem
from models.sales import Sale, SaleItem
from models.stock import StockMovement
from services.document_workflow import (
    PURCHASE_TRANSITIONS,
    SALE_TRANSITIONS,
    assert_transition,
)
from api.routes import clients, purchases, sales, suppliers
from api.schemas import PaymentIn, PurchaseReceiveIn, PurchaseReceiptLineIn, SaleCreate


class WorkflowMatrixTests(unittest.TestCase):
    def test_every_sale_transition_is_explicitly_allowed_or_rejected(self):
        for current, allowed in SALE_TRANSITIONS.items():
            for target in SALE_TRANSITIONS:
                if target in allowed:
                    assert_transition("sale", current, target)
                else:
                    with self.assertRaises(HTTPException):
                        assert_transition("sale", current, target)

    def test_every_purchase_transition_is_explicitly_allowed_or_rejected(self):
        for current, allowed in PURCHASE_TRANSITIONS.items():
            for target in PURCHASE_TRANSITIONS:
                if target in allowed:
                    assert_transition("purchase", current, target)
                else:
                    with self.assertRaises(HTTPException):
                        assert_transition("purchase", current, target)


class FinancialDocumentIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        path = Path(self.temp.name) / "workflow.db"
        self.engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, autoflush=True)()
        self.user = SimpleNamespace(id=1, username="tester", full_name="Test User")
        self.product = Product(code="P1", name="Produit", product_type="product", stock_quantity=100, purchase_price=10, sale_price=20)
        self.db.add(self.product)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def _sale(self, number: str, total: float = 100) -> Sale:
        sale = Sale(number=number, doc_type="invoice", status="draft", total_amount=total, paid_amount=0, version=1, created_by=self.user.id)
        self.db.add(sale)
        self.db.flush()
        self.db.add(SaleItem(sale_id=sale.id, product_id=self.product.id, quantity=2, unit_price=50, purchase_price=10, line_total=100))
        self.db.commit()
        return sale

    def _purchase(self, number: str, quantity: float = 10, total: float = 100) -> Purchase:
        purchase = Purchase(number=number, doc_type="order", status="draft", total_amount=total, paid_amount=0, version=1, created_by=self.user.id)
        self.db.add(purchase)
        self.db.flush()
        self.db.add(PurchaseItem(purchase_id=purchase.id, product_id=self.product.id, quantity=quantity, received_quantity=0, unit_price=10, line_total=total))
        self.db.commit()
        return purchase

    def _expect_http(self, status: int, callback):
        with self.assertRaises(HTTPException) as caught:
            callback()
        self.assertEqual(status, caught.exception.status_code)
        self.db.rollback()

    def test_sale_payment_guards_idempotency_locking_and_final_document_protection(self):
        sale = self._sale("S-1")
        initial_stock = self.product.stock_quantity
        confirmed = sales.confirm_sale(sale.id, "sale-confirm", "1", self.db, self.user)
        self.assertEqual("confirmed", confirmed.status)
        self.assertEqual(2, confirmed.version)
        self.assertEqual(initial_stock - 2, self.db.get(Product, self.product.id).stock_quantity)

        replay = sales.confirm_sale(sale.id, "sale-confirm", "1", self.db, self.user)
        self.assertEqual(2, replay.version)
        self.assertEqual(initial_stock - 2, self.db.get(Product, self.product.id).stock_quantity)
        self.assertEqual(1, self.db.query(StockMovement).filter(StockMovement.reference == "S-1").count())

        partial = sales.record_payment(sale.id, PaymentIn(amount="30", payment_mode="Carte"), "sale-pay-1", "2", self.db, self.user)
        self.assertEqual("partially_paid", partial.status)
        self.assertEqual(30, partial.paid_amount)
        self.assertEqual(1, self.db.query(Payment).filter(Payment.document_id == sale.id, Payment.kind == "payment").count())
        replay = sales.record_payment(sale.id, PaymentIn(amount="30", payment_mode="Carte"), "sale-pay-1", "2", self.db, self.user)
        self.assertEqual(30, replay.paid_amount)
        self.assertEqual(1, self.db.query(Payment).filter(Payment.document_id == sale.id, Payment.kind == "payment").count())

        self._expect_http(400, lambda: sales.record_payment(sale.id, PaymentIn(amount="71", payment_mode="Carte"), "sale-overpay", "3", self.db, self.user))
        self._expect_http(400, lambda: sales.record_payment(sale.id, PaymentIn(amount="0", payment_mode="Carte"), "sale-zero", "3", self.db, self.user))
        self._expect_http(409, lambda: sales.record_payment(sale.id, PaymentIn(amount="10", payment_mode="Carte"), "sale-stale", "2", self.db, self.user))

        second_partial = sales.record_payment(sale.id, PaymentIn(amount="20", payment_mode="Carte"), "sale-pay-2", "3", self.db, self.user)
        self.assertEqual("partially_paid", second_partial.status)
        paid = sales.record_payment(sale.id, PaymentIn(amount="50", payment_mode="Carte"), "sale-pay-3", "4", self.db, self.user)
        self.assertEqual("paid", paid.status)
        self._expect_http(409, lambda: sales.record_payment(sale.id, PaymentIn(amount="1", payment_mode="Carte"), "sale-after-paid", "5", self.db, self.user))
        self._expect_http(409, lambda: sales.cancel_sale(sale.id, "sale-cancel-paid", "5", self.db, self.user))
        self._expect_http(409, lambda: sales.delete_sale(sale.id, "5", self.db, self.user))
        self._expect_http(400, lambda: sales.update_sale(sale.id, SaleCreate(items=[]), "5", self.db, self.user))

    def test_zero_total_document_cannot_be_confirmed(self):
        sale = Sale(
            number="S-ZERO", doc_type="invoice", status="draft",
            total_amount=0, paid_amount=0, version=1, created_by=self.user.id,
        )
        self.db.add(sale)
        self.db.flush()
        self.db.add(SaleItem(
            sale_id=sale.id, product_id=self.product.id, quantity=1,
            unit_price=0, line_total=0, total_amount=0,
        ))
        self.db.commit()

        self._expect_http(
            400,
            lambda: sales.confirm_sale(sale.id, "confirm-zero", "1", self.db, self.user),
        )
        self.assertEqual("draft", self.db.get(Sale, sale.id).status)
        self.assertEqual(100, self.db.get(Product, self.product.id).stock_quantity)

    def test_sale_cancellation_reverses_stock_and_detailed_payment_once(self):
        sale = self._sale("S-2")
        start = self.db.get(Product, self.product.id).stock_quantity
        sales.confirm_sale(sale.id, "confirm-s2", "1", self.db, self.user)
        sales.record_payment(sale.id, PaymentIn(amount="25", payment_mode="Carte"), "pay-s2", "2", self.db, self.user)
        cancelled = sales.cancel_sale(sale.id, "cancel-s2", "3", self.db, self.user)
        self.assertEqual("cancelled", cancelled.status)
        self.assertEqual(0, cancelled.paid_amount)
        self.assertEqual(start, self.db.get(Product, self.product.id).stock_quantity)
        self.assertEqual(1, self.db.query(Payment).filter(Payment.document_id == sale.id, Payment.kind == "reversal").count())
        sales.cancel_sale(sale.id, "cancel-s2", "3", self.db, self.user)
        self.assertEqual(1, self.db.query(Payment).filter(Payment.document_id == sale.id, Payment.kind == "reversal").count())
        self._expect_http(409, lambda: sales.record_payment(sale.id, PaymentIn(amount="1", payment_mode="Carte"), "pay-cancelled", "4", self.db, self.user))
        self._expect_http(409, lambda: sales.delete_sale(sale.id, "4", self.db, self.user))

    def test_quote_conversion_is_single_and_replay_returns_existing_invoice(self):
        quote = Sale(
            number="DEV-1", doc_type="quote", status="confirmed", total_amount=40,
            paid_amount=0, version=1, created_by=self.user.id,
        )
        self.db.add(quote)
        self.db.flush()
        self.db.add(SaleItem(
            sale_id=quote.id, product_id=self.product.id, description=self.product.name,
            quantity=2, unit_price=20, catalog_unit_price=20, purchase_price=10,
            line_total=40, total_amount=40,
        ))
        self.db.commit()

        allocation = SimpleNamespace(document_number="FAC-1", allocation_id=1)
        with patch.object(sales, "reserve_document_number", return_value=allocation), \
             patch.object(sales, "commit_number_allocation"), \
             patch.object(sales, "void_reserved_allocation"):
            first = sales.convert_quote_to_invoice(
                quote.id, "convert-dev-1", "1", self.db, self.user,
            )
            replay = sales.convert_quote_to_invoice(
                quote.id, "convert-dev-1-retry", "1", self.db, self.user,
            )

        self.assertEqual(first.id, replay.id)
        self.assertEqual(1, self.db.query(Sale).filter(
            Sale.parent_id == quote.id,
            Sale.doc_type == "invoice",
        ).count())

    def test_purchase_full_state_machine_partial_receipt_and_payment_guards(self):
        purchase = self._purchase("P-1")
        item = self.db.query(PurchaseItem).filter(PurchaseItem.purchase_id == purchase.id).one()
        start = self.db.get(Product, self.product.id).stock_quantity
        self._expect_http(409, lambda: purchases.receive_purchase(purchase.id, None, "receive-draft", "1", self.db, self.user))
        self._expect_http(409, lambda: purchases.pay_purchase(purchase.id, PaymentIn(amount="10"), "pay-draft", "1", self.db, self.user))

        confirmed = purchases.confirm_purchase(purchase.id, "confirm-p1", "1", self.db, self.user)
        self.assertEqual("confirmed", confirmed.status)
        purchases.confirm_purchase(purchase.id, "confirm-p1", "1", self.db, self.user)
        partial_body = PurchaseReceiveIn(items=[PurchaseReceiptLineIn(item_id=item.id, quantity=4)])
        partial = purchases.receive_purchase(purchase.id, partial_body, "receive-p1-1", "2", self.db, self.user)
        self.assertEqual("partially_received", partial.status)
        self.assertEqual(start + 4, self.db.get(Product, self.product.id).stock_quantity)
        purchases.receive_purchase(purchase.id, partial_body, "receive-p1-1", "2", self.db, self.user)
        self.assertEqual(start + 4, self.db.get(Product, self.product.id).stock_quantity)
        self._expect_http(409, lambda: purchases.pay_purchase(purchase.id, PaymentIn(amount="10"), "pay-partial-receipt", "3", self.db, self.user))

        received = purchases.receive_purchase(purchase.id, PurchaseReceiveIn(items=[PurchaseReceiptLineIn(item_id=item.id, quantity=6)]), "receive-p1-2", "3", self.db, self.user)
        self.assertEqual("received", received.status)
        self.assertEqual(start + 10, self.db.get(Product, self.product.id).stock_quantity)
        first_payment = purchases.pay_purchase(purchase.id, PaymentIn(amount="20", payment_mode="card"), "pay-p1-1", "4", self.db, self.user)
        self.assertEqual("partially_paid", first_payment.status)
        second_payment = purchases.pay_purchase(purchase.id, PaymentIn(amount="30", payment_mode="card"), "pay-p1-2", "5", self.db, self.user)
        self.assertEqual("partially_paid", second_payment.status)
        self._expect_http(400, lambda: purchases.pay_purchase(purchase.id, PaymentIn(amount="51", payment_mode="card"), "pay-p1-over", "6", self.db, self.user))
        paid = purchases.pay_purchase(purchase.id, PaymentIn(amount="50", payment_mode="card"), "pay-p1-3", "6", self.db, self.user)
        self.assertEqual("paid", paid.status)
        self._expect_http(409, lambda: purchases.cancel_purchase(purchase.id, "cancel-paid-p1", "7", self.db, self.user))
        self._expect_http(409, lambda: purchases.delete_purchase(purchase.id, "7", self.db, self.user))

    def test_purchase_cancel_allowed_only_from_draft_or_confirmed_and_draft_delete(self):
        draft = self._purchase("P-2")
        cancelled = purchases.cancel_purchase(draft.id, "cancel-draft", "1", self.db, self.user)
        self.assertEqual("cancelled", cancelled.status)
        purchases.cancel_purchase(draft.id, "cancel-draft", "1", self.db, self.user)
        self._expect_http(409, lambda: purchases.delete_purchase(draft.id, "2", self.db, self.user))

        confirmed = self._purchase("P-3")
        purchases.confirm_purchase(confirmed.id, "confirm-p3", "1", self.db, self.user)
        cancelled = purchases.cancel_purchase(confirmed.id, "cancel-p3", "2", self.db, self.user)
        self.assertEqual("cancelled", cancelled.status)

        deletable = self._purchase("P-4")
        self.assertEqual({"ok": True}, purchases.delete_purchase(deletable.id, "1", self.db, self.user))
        self.assertIsNone(self.db.get(Purchase, deletable.id))

    def test_aggregate_client_and_supplier_payments_are_bounded_and_idempotent(self):
        client = Client(code="C-1", name="Client Test", is_active=True)
        supplier = Supplier(code="F-1", company_name="Fournisseur Test", is_active=True)
        self.db.add_all([client, supplier])
        self.db.flush()
        sale = Sale(number="S-AGG", doc_type="invoice", status="confirmed", client_id=client.id, total_amount=100, paid_amount=0, version=1)
        purchase = Purchase(number="P-AGG", doc_type="order", status="received", supplier_id=supplier.id, total_amount=80, paid_amount=0, version=1)
        self.db.add_all([sale, purchase])
        self.db.commit()

        client_credit = clients.record_client_credit_payment(client.id, PaymentIn(amount="40", payment_mode="Carte"), "client-agg-pay", self.db, self.user)
        self.assertEqual(60, client_credit.total_due)
        self.assertEqual("partially_paid", self.db.get(Sale, sale.id).status)
        replay = clients.record_client_credit_payment(client.id, PaymentIn(amount="40", payment_mode="Carte"), "client-agg-pay", self.db, self.user)
        self.assertEqual(60, replay.total_due)
        self.assertEqual(1, self.db.query(Payment).filter(Payment.document_type == "sale", Payment.document_id == sale.id).count())
        self._expect_http(400, lambda: clients.record_client_credit_payment(client.id, PaymentIn(amount="61", payment_mode="Carte"), "client-overpay", self.db, self.user))

        supplier_credit = suppliers.record_supplier_payment(supplier.id, PaymentIn(amount="30", payment_mode="Virement"), "supplier-agg-pay", self.db, self.user)
        self.assertEqual(50, supplier_credit.total_due)
        self.assertEqual("partially_paid", self.db.get(Purchase, purchase.id).status)
        replay = suppliers.record_supplier_payment(supplier.id, PaymentIn(amount="30", payment_mode="Virement"), "supplier-agg-pay", self.db, self.user)
        self.assertEqual(50, replay.total_due)
        self.assertEqual(1, self.db.query(Payment).filter(Payment.document_type == "purchase", Payment.document_id == purchase.id).count())
        self._expect_http(400, lambda: suppliers.record_supplier_payment(supplier.id, PaymentIn(amount="51", payment_mode="Virement"), "supplier-overpay", self.db, self.user))


if __name__ == "__main__":
    unittest.main()
