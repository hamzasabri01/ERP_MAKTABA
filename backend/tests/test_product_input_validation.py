import unittest

from pydantic import ValidationError

from api.schemas import ProductCreate


class ProductInputValidationTests(unittest.TestCase):
    def assert_invalid(self, **changes):
        payload = {"name": "Cahier", **changes}
        with self.assertRaises(ValidationError):
            ProductCreate(**payload)

    def test_rejects_negative_numeric_values(self):
        for field in ("purchase_price", "sale_price", "stock_quantity", "min_stock"):
            with self.subTest(field=field):
                self.assert_invalid(**{field: "-0.01"})

    def test_rejects_zero_or_negative_conversion_factor(self):
        self.assert_invalid(purchase_to_base_factor=0)
        self.assert_invalid(purchase_to_base_factor=-1)
        self.assert_invalid(purchase_to_base_factor="1.5")

    def test_rejects_decimal_stock_values(self):
        self.assert_invalid(stock_quantity="0.02")
        self.assert_invalid(min_stock="1.5")

    def test_rejects_invalid_identity_and_flags(self):
        self.assert_invalid(name="   ")
        self.assert_invalid(unit="")
        self.assert_invalid(category_id=0)
        self.assert_invalid(supplier_id=-1)
        self.assert_invalid(tva_enabled=2)
        self.assert_invalid(is_active=-1)

    def test_rejects_invalid_tax_and_non_finite_numbers(self):
        self.assert_invalid(tax_rate=101)
        self.assert_invalid(sale_price="NaN")
        self.assert_invalid(stock_quantity="Infinity")

    def test_normalizes_safe_text_fields(self):
        product = ProductCreate(
            name="  Cahier 96 pages  ",
            barcode="  611 000 000 001 7 ",
            unit=" pcs ",
            purchase_unit=" boite ",
        )
        self.assertEqual(product.name, "Cahier 96 pages")
        self.assertEqual(product.barcode, "6110000000017")
        self.assertEqual(product.unit, "pcs")
        self.assertEqual(product.purchase_unit, "boite")

    def test_accepts_zero_values_where_valid(self):
        product = ProductCreate(
            name="Service libre",
            product_type="service",
            pricing_mode="manual",
            purchase_price=0,
            sale_price=0,
            stock_quantity=0,
            min_stock=0,
            tax_rate=0,
        )
        self.assertEqual(product.sale_price, 0)


if __name__ == "__main__":
    unittest.main()
