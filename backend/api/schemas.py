"""api/schemas.py — Pydantic v2 request/response schemas."""
from __future__ import annotations
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from typing import Annotated, Optional, List
from datetime import datetime
from decimal import Decimal
import re


MoneyInput = Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=2, allow_inf_nan=False)]
PositiveMoneyInput = Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=2, allow_inf_nan=False)]
PriceInput = Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=4, allow_inf_nan=False)]
QuantityInput = Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=4, allow_inf_nan=False)]
NonNegativeQuantityInput = Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=4, allow_inf_nan=False)]
PercentageInput = Annotated[Decimal, Field(ge=0, le=100, max_digits=7, decimal_places=4, allow_inf_nan=False)]


# ── Auth ──────────────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    password: str


class FirebaseLoginRequest(BaseModel):
    id_token: str


class MfaVerifyRequest(BaseModel):
    mfa_token: str
    code: str


class MfaEnableRequest(BaseModel):
    code: str


class MfaSetupRequest(BaseModel):
    password: str


class MfaDisableRequest(BaseModel):
    password: str
    code: str = ""


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"
    csrf_token: str = ""


class LoginResponse(BaseModel):
    access_token: str = ""
    token_type: str = "bearer"
    user: Optional["UserOut"] = None
    mfa_required: bool = False
    mfa_token: str = ""
    csrf_token: str = ""


class MfaSetupResponse(BaseModel):
    secret: str
    otpauth_uri: str


class MfaEnableResponse(BaseModel):
    user: "UserOut"
    recovery_codes: List[str]
    access_token: str
    csrf_token: str = ""


class MfaRecoveryCodesResponse(BaseModel):
    recovery_codes: List[str]


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


class AuthActionResponse(BaseModel):
    ok: bool = True
    message: str = ""


# ── User ──────────────────────────────────────────────────────────────────────
class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    email: str
    role_id: Optional[int] = None
    role_name: Optional[str] = None
    role_description: str = ""
    permissions: List[str] = []
    is_active: bool
    mfa_enabled: bool = False
    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    username: str
    password: str
    full_name: str = ""
    email: str = ""
    role_id: Optional[int] = None
    is_active: bool = True


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role_id: Optional[int] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None


class RoleOut(BaseModel):
    id: int
    name: str
    description: str = ""
    permissions: List[str] = []
    user_count: int = 0
    model_config = {"from_attributes": True}


class RoleCreate(BaseModel):
    name: str
    description: str = ""
    permissions: List[str] = []

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Nom du role obligatoire")
        return value

    @field_validator("permissions")
    @classmethod
    def normalize_permissions(cls, value: List[str]) -> List[str]:
        seen = set()
        cleaned = []
        for item in value or []:
            permission = str(item).strip()
            if permission and permission not in seen:
                seen.add(permission)
                cleaned.append(permission)
        return cleaned


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permissions: Optional[List[str]] = None

    @field_validator("name")
    @classmethod
    def validate_optional_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Nom du role obligatoire")
        return value

    @field_validator("permissions")
    @classmethod
    def normalize_optional_permissions(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return value
        return RoleCreate.normalize_permissions(value)


# ── Client ────────────────────────────────────────────────────────────────────
class ClientCreate(BaseModel):
    name: str
    phone: str = ""
    email: str = ""
    address: str = ""
    city: str = ""
    tax_id: str = ""
    ice: str = ""
    payment_terms: int = 30
    credit_limit: MoneyInput = Decimal("0")
    notes: str = ""
    is_active: bool = True


class ClientUpdate(ClientCreate):
    name: Optional[str] = None


class ClientOut(BaseModel):
    id: int
    code: Optional[str] = ""
    name: str
    phone: str = ""
    email: str = ""
    address: str = ""
    city: str = ""
    tax_id: str = ""
    ice: str = ""
    payment_terms: int = 30
    credit_limit: float = 0.0
    credit_balance: float = 0.0
    notes: str = ""
    is_active: bool = True
    total_sales: float = 0.0
    credit_available: float = 0.0
    credit_usage_pct: float = 0.0
    overdue_amount: float = 0.0
    open_invoices_count: int = 0
    model_config = {"from_attributes": True}


class ClientCreditInvoiceOut(BaseModel):
    id: int
    number: str = ""
    date_time: Optional[datetime] = None
    due_date: Optional[datetime] = None
    total_amount: float = 0.0
    paid_amount: float = 0.0
    balance_due: float = 0.0
    overdue_days: int = 0
    status: str = ""


class ClientCreditSummaryOut(BaseModel):
    client: ClientOut
    invoices: List[ClientCreditInvoiceOut] = []
    total_due: float = 0.0
    overdue_amount: float = 0.0
    next_due_date: Optional[datetime] = None
    credit_available: float = 0.0
    credit_usage_pct: float = 0.0


# ── Category ──────────────────────────────────────────────────────────────────
class CategoryCreate(BaseModel):
    name: str
    description: str = ""


class CategoryOut(BaseModel):
    id: int
    name: str
    description: str = ""
    model_config = {"from_attributes": True}


# ── Supplier ──────────────────────────────────────────────────────────────────
class SupplierCreate(BaseModel):
    company_name: str
    contact_person: str = ""
    phone: str = ""
    email: str = ""
    address: str = ""
    city: str = ""
    tax_id: str = ""
    ice: str = ""
    notes: str = ""
    is_active: bool = True


class SupplierUpdate(SupplierCreate):
    company_name: Optional[str] = None


class SupplierOut(BaseModel):
    id: int
    code: Optional[str] = ""
    company_name: str
    contact_person: str = ""
    phone: str = ""
    email: str = ""
    address: str = ""
    city: str = ""
    tax_id: str = ""
    notes: str = ""
    is_active: bool = True
    total_purchases: float = 0.0
    credit_balance: float = 0.0
    open_purchases_count: int = 0
    model_config = {"from_attributes": True}


class SupplierCreditPurchaseOut(BaseModel):
    id: int
    number: str = ""
    date_time: Optional[datetime] = None
    total_amount: float = 0.0
    paid_amount: float = 0.0
    balance_due: float = 0.0
    status: str = ""
    payment_status: str = ""


class SupplierCreditSummaryOut(BaseModel):
    supplier: SupplierOut
    purchases: List[SupplierCreditPurchaseOut] = []
    total_due: float = 0.0
    total_purchases: float = 0.0


# ── Product ───────────────────────────────────────────────────────────────────
class ProductCreate(BaseModel):
    name: str
    code: str = ""
    category_id: Optional[int] = None
    supplier_id: Optional[int] = None
    description: str = ""
    purchase_price: PriceInput = Decimal("0")
    sale_price: PriceInput = Decimal("0")
    stock_quantity: NonNegativeQuantityInput = Decimal("0")
    min_stock: NonNegativeQuantityInput = Decimal("5")
    barcode: str = ""
    unit: str = "pcs"
    purchase_unit: str = "pcs"
    purchase_to_base_factor: QuantityInput = Decimal("1")
    allow_fractional_sale: bool = False
    sale_unit: str = ""
    sale_to_base_factor: QuantityInput = Decimal("1")
    sale_unit_price: PriceInput = Decimal("0")
    tax_rate: PercentageInput = Decimal("20")
    tva_enabled: int = 1
    product_type: str = "product"
    pricing_mode: str = "fixed"
    is_active: int = 1

    @field_validator("name")
    @classmethod
    def validate_product_name(cls, value):
        if value is None:
            return value
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("Le nom du produit est obligatoire")
        if len(normalized) > 200:
            raise ValueError("Le nom du produit ne peut pas dépasser 200 caractères")
        return normalized

    @field_validator("barcode")
    @classmethod
    def validate_product_barcode(cls, value: str) -> str:
        normalized = re.sub(r"\s+", "", str(value or ""))
        if len(normalized) > 100:
            raise ValueError("Le code EAN ne peut pas dépasser 100 caractères")
        if any(ord(char) < 32 or ord(char) == 127 for char in normalized):
            raise ValueError("Le code EAN contient des caractères invalides")
        return normalized

    @field_validator("unit", "purchase_unit")
    @classmethod
    def validate_product_unit(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("L'unité est obligatoire")
        if len(normalized) > 20:
            raise ValueError("L'unité ne peut pas dépasser 20 caractères")
        return normalized

    @field_validator("sale_unit")
    @classmethod
    def validate_optional_sale_unit(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if len(normalized) > 20:
            raise ValueError("L'unité de vente secondaire ne peut pas dépasser 20 caractères")
        return normalized

    @field_validator("purchase_to_base_factor", "sale_to_base_factor")
    @classmethod
    def validate_purchase_unit_content(cls, value: Decimal) -> Decimal:
        if value != value.to_integral_value():
            raise ValueError("Le contenu de l'unité d'achat doit être un nombre entier")
        return value

    @field_validator("stock_quantity", "min_stock")
    @classmethod
    def validate_product_stock_integer(cls, value: Decimal) -> Decimal:
        if value != value.to_integral_value():
            raise ValueError("Les quantités de stock doivent être des nombres entiers")
        return value

    @field_validator("category_id", "supplier_id")
    @classmethod
    def validate_optional_identifier(cls, value):
        if value is not None and value <= 0:
            raise ValueError("Identifiant de référence invalide")
        return value

    @field_validator("tva_enabled", "is_active")
    @classmethod
    def validate_product_flag(cls, value: int) -> int:
        if value not in {0, 1}:
            raise ValueError("La valeur doit être 0 ou 1")
        return value

    @field_validator("product_type")
    @classmethod
    def validate_product_type(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"product", "service", "bundle"}:
            raise ValueError("Type de produit invalide")
        return normalized

    @field_validator("pricing_mode")
    @classmethod
    def validate_pricing_mode(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"fixed", "editable", "manual"}:
            raise ValueError("Mode de tarification invalide")
        return normalized

    @model_validator(mode="after")
    def validate_secondary_sale_unit(self):
        if self.product_type != "product" or not self.sale_unit:
            self.sale_unit = ""
            self.sale_to_base_factor = Decimal("1")
            self.sale_unit_price = Decimal("0")
            return self
        if self.sale_unit == self.unit:
            raise ValueError("L'unité secondaire doit être différente de l'unité de base")
        if self.sale_to_base_factor <= 1:
            raise ValueError("L'unité secondaire doit contenir plus d'une unité de base")
        if self.sale_to_base_factor != self.sale_to_base_factor.to_integral_value():
            raise ValueError("Le contenu de l'unité secondaire doit être un nombre entier")
        if self.sale_unit_price <= 0:
            raise ValueError("Le prix de l'unité secondaire doit être strictement positif")
        return self


class ProductUpdate(ProductCreate):
    name: Optional[str] = None


class ProductBulkArchive(BaseModel):
    product_ids: List[int] = Field(min_length=1, max_length=1000)


class ProductOut(BaseModel):
    id: int
    code: Optional[str] = ""
    name: str
    category_id: Optional[int] = None
    category_name: Optional[str] = ""
    supplier_id: Optional[int] = None
    supplier_name: Optional[str] = ""
    description: str = ""
    purchase_price: float = 0.0
    sale_price: float = 0.0
    stock_quantity: float = 0.0
    min_stock: float = 5.0
    barcode: str = ""
    unit: str = "pcs"
    purchase_unit: str = "pcs"
    purchase_to_base_factor: float = 1.0
    allow_fractional_sale: bool = False
    sale_unit: str = ""
    sale_to_base_factor: float = 1.0
    sale_unit_price: float = 0.0
    tax_rate: float = 20.0
    tva_enabled: int = 1
    product_type: str = "product"
    pricing_mode: str = "fixed"
    is_active: int = 1
    image_path: Optional[str] = None
    updated_at: Optional[datetime] = None
    margin_pct: float = 0.0
    stock_value: float = 0.0
    is_low_stock: bool = False
    model_config = {"from_attributes": True}


# ── Sale ──────────────────────────────────────────────────────────────────────
class SaleItemIn(BaseModel):
    product_id: Optional[int] = None
    description: str = ""
    quantity: QuantityInput = Decimal("1")
    unit_price: PriceInput = Decimal("0")
    purchase_price: PriceInput = Decimal("0")
    discount: PercentageInput = Decimal("0")
    tax_rate: PercentageInput = Decimal("20")
    price_override_reason: str = ""
    sale_unit: str = ""


class SaleItemOut(BaseModel):
    id: int
    product_id: Optional[int] = None
    product_name: str = ""
    description: str = ""
    quantity: float
    unit_price: float
    catalog_unit_price: float = 0.0
    price_overridden: bool = False
    price_override_reason: str = ""
    purchase_price: float = 0.0
    discount: float
    discount_amount: float = 0.0
    tax_rate: float
    tax_amount: float = 0.0
    total_amount: float = 0.0
    line_total: float
    sale_unit: str = ""
    conversion_factor: float = 1.0
    base_quantity: float = 0.0
    model_config = {"from_attributes": True}


class TaxBreakdownOut(BaseModel):
    rate: float
    taxable_amount: float
    tax_amount: float
    total_amount: float


class DocumentPreviewLineOut(BaseModel):
    index: int
    quantity: float
    unit_price: float
    discount: float
    discount_amount: float
    tax_rate: float
    line_total: float
    tax_amount: float
    total_amount: float


class DocumentPreviewOut(BaseModel):
    discount_amount: float
    subtotal: float
    tax_amount: float
    total_amount: float
    currency_code: str
    price_tax_mode: str
    rounding_scope: str
    tax_breakdown: List[TaxBreakdownOut] = []
    items: List[DocumentPreviewLineOut] = []


class SaleCreate(BaseModel):
    doc_type: str = "invoice"
    client_id: Optional[int] = None
    date_time: Optional[datetime] = None
    due_date: Optional[datetime] = None
    notes: str = ""
    discount: PercentageInput = Decimal("0")
    payment_mode: str = "Espèce"
    paid_amount: MoneyInput = Decimal("0")
    advance_amount: MoneyInput = Decimal("0")
    items: List[SaleItemIn] = []

    @field_validator("doc_type")
    @classmethod
    def validate_sale_document_type(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"invoice", "quote", "delivery", "credit_note"}:
            raise ValueError("Type de document de vente invalide")
        return normalized


class SaleReturnItemIn(BaseModel):
    sale_item_id: int
    quantity: QuantityInput
    condition: str = "resalable"
    restock: bool = True

    @field_validator("condition")
    @classmethod
    def validate_condition(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"resalable", "damaged"}:
            raise ValueError("État du produit retourné invalide")
        return normalized


class SaleReturnIn(BaseModel):
    items: List[SaleReturnItemIn]
    reason: str
    resolution: str = "refund"
    exchange_items: List[SaleItemIn] = Field(default_factory=list)

    @field_validator("reason")
    @classmethod
    def validate_return_reason(cls, value: str) -> str:
        clean = str(value or "").strip()
        if len(clean) < 3:
            raise ValueError("Le motif du retour est obligatoire")
        return clean[:500]

    @field_validator("resolution")
    @classmethod
    def validate_resolution(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"refund", "credit", "exchange"}:
            raise ValueError("Mode de résolution invalide")
        return normalized


class SaleOut(BaseModel):
    id: int
    number: str = ""
    doc_type: str
    status: str
    client_id: Optional[int] = None
    parent_id: Optional[int] = None
    client_name: str = ""
    client_phone: str = ""
    date_time: Optional[datetime] = None
    due_date: Optional[datetime] = None
    notes: str = ""
    discount: float = 0.0
    discount_amount: float = 0.0
    subtotal: float = 0.0
    tax_amount: float = 0.0
    total_amount: float = 0.0
    advance_amount: float = 0.0
    paid_amount: float = 0.0
    balance_due: float = 0.0
    payment_mode: str = ""
    created_by: Optional[int] = None
    created_by_name: str = ""
    updated_at: Optional[datetime] = None
    version: int = 1
    currency_code: str = "MAD"
    price_tax_mode: str = "exclusive"
    rounding_scope: str = "line"
    tax_breakdown: List["TaxBreakdownOut"] = []
    items: List[SaleItemOut] = []
    return_credit_amount: float = 0.0
    exchange_total: float = 0.0
    price_difference: float = 0.0
    exchange_invoice_id: Optional[int] = None
    exchange_invoice_number: str = ""
    model_config = {"from_attributes": True}


class PaymentIn(BaseModel):
    amount: MoneyInput
    payment_mode: str = "cash"
    allow_without_cash_session: bool = False

    @field_validator("payment_mode")
    @classmethod
    def validate_payment_mode(cls, value: str) -> str:
        aliases = {
            "cash": "cash", "espece": "cash", "espèce": "cash", "caisse": "cash",
            "card": "card", "carte": "card",
            "bank": "bank", "virement": "bank", "banque": "bank",
            "cheque": "cheque", "chèque": "cheque",
            "credit": "credit", "crédit": "credit",
        }
        normalized = aliases.get(str(value or "").strip().lower())
        if not normalized:
            raise ValueError("Mode de paiement invalide")
        return normalized


# ── Purchase ──────────────────────────────────────────────────────────────────
class PurchaseItemIn(BaseModel):
    product_id: Optional[int] = None
    description: str = ""
    quantity: QuantityInput = Decimal("1")
    unit_price: PriceInput = Decimal("0")
    discount: PercentageInput = Decimal("0")
    tax_rate: PercentageInput = Decimal("20")
    purchase_unit: str = ""
    conversion_factor: Optional[QuantityInput] = None


class PurchaseItemOut(BaseModel):
    id: int
    product_id: Optional[int] = None
    product_name: str = ""
    description: str = ""
    quantity: float
    purchase_unit: str = ""
    conversion_factor: float = 1.0
    base_quantity: float = 0.0
    unit_price: float
    discount: float = 0.0
    discount_amount: float = 0.0
    tax_rate: float
    tax_amount: float = 0.0
    total_amount: float = 0.0
    line_total: float
    received_quantity: float = 0.0
    received_base_quantity: float = 0.0
    remaining_quantity: float = 0.0
    model_config = {"from_attributes": True}


class PurchaseCreate(BaseModel):
    doc_type: str = "order"
    supplier_id: Optional[int] = None
    date_time: Optional[datetime] = None
    expected_date: Optional[datetime] = None
    notes: str = ""
    discount: PercentageInput = Decimal("0")
    items: List[PurchaseItemIn] = []

    @field_validator("doc_type")
    @classmethod
    def validate_purchase_document_type(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"order", "receipt"}:
            raise ValueError("Type de document d'achat invalide")
        return normalized


class PurchaseOut(BaseModel):
    id: int
    number: str = ""
    doc_type: str
    status: str
    supplier_id: Optional[int] = None
    supplier_name: str = ""
    date_time: Optional[datetime] = None
    expected_date: Optional[datetime] = None
    notes: str = ""
    discount: float = 0.0
    discount_amount: float = 0.0
    subtotal: float = 0.0
    tax_amount: float = 0.0
    total_amount: float = 0.0
    paid_amount: float = 0.0
    payment_status: str = "unpaid"
    created_by: Optional[int] = None
    created_by_name: str = ""
    version: int = 1
    currency_code: str = "MAD"
    price_tax_mode: str = "exclusive"
    rounding_scope: str = "line"
    tax_breakdown: List["TaxBreakdownOut"] = []
    items: List[PurchaseItemOut] = []
    model_config = {"from_attributes": True}


class PurchaseReceiptLineIn(BaseModel):
    item_id: int
    quantity: QuantityInput


class PurchaseReceiveIn(BaseModel):
    items: List[PurchaseReceiptLineIn] = []


class BundleComponentIn(BaseModel):
    product_id: int
    quantity: QuantityInput


class BundleComponentsUpdate(BaseModel):
    components: List[BundleComponentIn]


class BundleComponentOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    unit: str
    quantity: float


# ── Expense ───────────────────────────────────────────────────────────────────
class ExpenseCreate(BaseModel):
    date: Optional[datetime] = None
    category: str = "Autre"
    description: str
    amount: PositiveMoneyInput
    payment_method: str = "Espèce"
    reference: str = ""
    notes: str = ""


class ExpenseOut(BaseModel):
    id: int
    date: Optional[datetime] = None
    category: str = ""
    description: str
    amount: float
    payment_method: str = ""
    reference: str = ""
    notes: str = ""
    model_config = {"from_attributes": True}


# ── Stock ─────────────────────────────────────────────────────────────────────
class StockAdjustIn(BaseModel):
    product_id: int
    quantity: NonNegativeQuantityInput
    movement_type: str = "adjustment"
    notes: str = ""
    unit_cost: PriceInput = Decimal("0")
    reference: str = ""

    @field_validator("movement_type")
    @classmethod
    def validate_stock_movement_type(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"in", "out", "adjustment", "inventory"}:
            raise ValueError("Type de mouvement stock invalide")
        return normalized


class StockMovementOut(BaseModel):
    id: int
    product_id: Optional[int] = None
    product_name: str = ""
    movement_type: str
    quantity: float
    before_qty: float
    after_qty: float
    unit_cost: float = 0.0
    reference: str = ""
    notes: str = ""
    warehouse_code: str = "MAIN"
    source_type: str = ""
    source_id: Optional[int] = None
    source_line_id: Optional[int] = None
    operation_key: str = ""
    kind: str = "movement"
    reverses_movement_id: Optional[int] = None
    created_by: Optional[int] = None
    created_by_name: str = ""
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class StockSummaryOut(BaseModel):
    products_count: int = 0
    stock_value: float = 0.0
    low_stock_count: int = 0
    out_of_stock_count: int = 0
    movements_today: int = 0
    last_movement_at: Optional[datetime] = None
    runtime_at: datetime


class InventorySessionCreate(BaseModel):
    product_ids: List[int] = Field(default_factory=list)
    notes: str = ""
    warehouse_code: str = "MAIN"


class InventoryCountItemIn(BaseModel):
    product_id: int
    quantity: NonNegativeQuantityInput


class InventoryCountIn(BaseModel):
    items: List[InventoryCountItemIn]


class InventoryCountLineOut(BaseModel):
    id: int
    product_id: int
    product_code: str = ""
    product_name: str = ""
    unit: str = ""
    expected_qty: float
    counted_qty: Optional[float] = None
    difference: Optional[float] = None
    movement_id: Optional[int] = None


class InventorySessionOut(BaseModel):
    id: int
    reference: str
    status: str
    warehouse_code: str = "MAIN"
    notes: str = ""
    version: int = 1
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None
    counted_at: Optional[datetime] = None
    validated_at: Optional[datetime] = None
    lines: List[InventoryCountLineOut] = Field(default_factory=list)


class StockReconciliationItemOut(BaseModel):
    product_id: int
    code: str = ""
    name: str = ""
    reason: str
    current_qty: float
    expected_qty: float
    difference: float
    continuity_errors: int = 0


class StockReconciliationOut(BaseModel):
    ok: bool
    checked_products: int
    movement_count: int
    mismatch_count: int
    continuity_error_count: int
    source_gap_count: int
    warehouse_code: str = "MAIN"
    items: List[StockReconciliationItemOut] = Field(default_factory=list)
    checked_at: datetime


# ── Cash ──────────────────────────────────────────────────────────────────────
class CashSessionOpen(BaseModel):
    opening_balance: MoneyInput = Decimal("0")
    notes: str = ""


class CashSessionClose(BaseModel):
    closing_balance: MoneyInput
    notes: str = ""
    difference_reason: str = ""


class CashTransactionIn(BaseModel):
    direction: str = "in"
    amount: PositiveMoneyInput
    description: str = ""
    source: str = "manual"
    reference: str = ""

    @field_validator("direction")
    @classmethod
    def validate_cash_direction(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"in", "out"}:
            raise ValueError("Direction de caisse invalide")
        return normalized


class CashTransactionReverseIn(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def validate_cash_reversal_reason(cls, value: str) -> str:
        clean = str(value or "").strip()
        if len(clean) < 3:
            raise ValueError("Motif d'annulation obligatoire")
        return clean


class CashTransactionOut(BaseModel):
    id: int
    session_id: int
    direction: str
    amount: float
    source: str = ""
    reference: str = ""
    description: str = ""
    created_at: Optional[datetime] = None
    created_by: Optional[int] = None
    payment_id: Optional[int] = None
    payment_reference: str = ""
    kind: str = "movement"
    reverses_transaction_id: Optional[int] = None


class CashSessionOut(BaseModel):
    id: int
    opened_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    opening_balance: float
    closing_balance: Optional[float] = None
    expected_balance: Optional[float] = None
    difference: Optional[float] = None
    status: str
    notes: str = ""
    version: int = 1
    opened_by: Optional[int] = None
    closed_by: Optional[int] = None
    difference_reason: str = ""
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None
    total_in: float = 0.0
    total_out: float = 0.0
    model_config = {"from_attributes": True}


class CashReconciliationItemOut(BaseModel):
    entity_type: str
    entity_id: int
    reason: str
    expected_amount: float = 0.0
    actual_amount: float = 0.0
    difference: float = 0.0


class CashReconciliationOut(BaseModel):
    ok: bool
    session_id: Optional[int] = None
    open_session_count: int = 0
    payment_count: int = 0
    transaction_count: int = 0
    expected_balance: float = 0.0
    recorded_balance: float = 0.0
    difference: float = 0.0
    orphan_cash_payment_count: int = 0
    orphan_payment_transaction_count: int = 0
    items: List[CashReconciliationItemOut] = Field(default_factory=list)
    checked_at: datetime


class CreditReconciliationItemOut(BaseModel):
    party_type: str
    party_id: int
    name: str = ""
    stored_balance: float = 0.0
    calculated_balance: float = 0.0
    difference: float = 0.0


class CreditReconciliationOut(BaseModel):
    ok: bool
    client_count: int = 0
    supplier_count: int = 0
    mismatch_count: int = 0
    items: List[CreditReconciliationItemOut] = Field(default_factory=list)
    checked_at: datetime


# ── Settings ──────────────────────────────────────────────────────────────────
class CompanySettings(BaseModel):
    name: str = ""
    legal_name: str = ""
    store_name: str = ""
    store_type: str = ""
    address: str = "أمام حمام الشفاء و قرب إعدادية إبن خلدون"
    city: str = ""
    country: str = "Maroc"
    postal_code: str = ""
    phone: str = "0635363345 / 0630596389"
    mobile: str = ""
    email: str = "maktabatsabri@gmail.com"
    website: str = ""
    logo_url: str = ""
    brand_primary_color: str = "#0F766E"
    brand_secondary_color: str = "#F59E0B"
    brand_success_color: str = "#16A34A"
    brand_document_color: str = "#111827"
    brand_print_logo_size: int = 42
    tax_id: str = ""
    ice: str = ""
    rc: str = ""
    if_number: str = ""
    currency: str = "MAD"
    price_tax_mode: str = "exclusive"
    rounding_scope: str = "line"
    rounding_mode: str = "half_up"
    tax_rates: str = "0,7,10,14,20"
    timezone: str = "Africa/Casablanca"
    app_name: str = "Maktaba Print"
    app_language: str = "fr"
    default_route: str = "/dashboard"
    date_format: str = "DD/MM/YYYY"
    time_format: str = "24h"
    compact_tables: bool = False
    show_low_stock_alerts: bool = True
    receipt_footer: str = "Merci pour votre visite - fournitures scolaires, photocopie et impression"
    receipt_paper_width: int = 80
    receipt_copies: int = 1
    receipt_auto_print: bool = False
    receipt_show_logo: bool = True
    receipt_show_address: bool = True
    receipt_show_phone: bool = True
    receipt_show_ice: bool = True
    receipt_show_barcode: bool = True
    invoice_notes: str = "Articles scolaires, services de copie et impression."
    quote_notes: str = "Devis valable selon disponibilite des articles et services."
    sale_terms: str = "Verifier les quantites, formats d'impression et reliures avant validation."
    purchase_terms: str = "Approvisionnement librairie et consommables d'impression."
    fiscal_year_start: str = "01-01"
    user_language: str = "fr"
    user_default_page: str = "/dashboard"
    user_date_format: str = "DD/MM/YYYY"
    user_compact_mode: bool = False
    user_sidebar_default_collapsed: bool = False
    user_notifications: bool = True
    report_email_enabled: bool = False
    report_email_recipients: str = ""
    report_email_cc: str = ""
    report_email_bcc: str = ""
    report_email_reply_to: str = ""
    report_email_subject_prefix: str = "Rapport Maktaba Print"
    report_email_include_profit: bool = True
    report_email_include_sales_by_category: bool = True
    report_email_include_stock_value: bool = True
    report_email_include_cash: bool = True
    report_email_include_expenses: bool = True
    report_email_include_purchases: bool = True
    report_email_format: str = "html"
    report_schedule_frequency: str = "daily"
    report_schedule_time: str = "20:00"
    report_schedule_day_of_week: int = 1
    report_schedule_day_of_month: int = 1
    report_schedule_month: int = 1
    report_schedule_timezone: str = "Africa/Casablanca"
    report_schedule_last_sent_at: str = ""
    report_schedule_last_sent_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password_configured: bool = False
    smtp_from_email: str = ""
    smtp_from_name: str = ""
    smtp_security: str = "starttls"
    smtp_timeout_seconds: int = 30
    tva_rate: float = 20.0
    tva_enabled: bool = True
    invoice_prefix: str = "FAC"
    quote_prefix: str = "DEV"
    delivery_prefix: str = "BL"
    credit_note_prefix: str = "AV"
    po_prefix: str = "BC"
    purchase_receipt_prefix: str = "BR"
    minimum_margin: float = 20.0
    low_stock_threshold: float = 1.0
    default_min_stock: float = 5.0
    product_units: str = "pcs,kg,g,l,ml,m,m2,m3,boite,lot"
    payment_modes: str = "Espece,Carte,Virement,Cheque,Autre"
    cash_difference_approval_threshold: float = Field(default=100.0, ge=0)
    expense_categories: str = "Loyer,Salaires,Fournitures,Transport,Marketing,Maintenance,Taxes & Impots,Energie,Communication,Autre"

    @field_validator("smtp_port")
    @classmethod
    def validate_smtp_port(cls, value: int) -> int:
        if value < 1 or value > 65535:
            raise ValueError("Le port SMTP doit etre compris entre 1 et 65535")
        return value

    @field_validator("smtp_timeout_seconds")
    @classmethod
    def validate_smtp_timeout(cls, value: int) -> int:
        if value < 5 or value > 120:
            raise ValueError("Le delai SMTP doit etre compris entre 5 et 120 secondes")
        return value

    @field_validator("smtp_security")
    @classmethod
    def validate_smtp_security(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"starttls", "ssl", "none"}:
            raise ValueError("Mode de securite SMTP invalide")
        return normalized

    @field_validator("report_schedule_frequency")
    @classmethod
    def validate_report_frequency(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"daily", "weekly", "monthly", "yearly"}:
            raise ValueError("Frequence de rapport invalide")
        return normalized

    @field_validator("report_schedule_time")
    @classmethod
    def validate_report_time(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", normalized):
            raise ValueError("L'heure d'envoi doit etre au format HH:MM")
        return normalized

    @field_validator("report_schedule_day_of_week")
    @classmethod
    def validate_report_weekday(cls, value: int) -> int:
        if value < 1 or value > 7:
            raise ValueError("Le jour de semaine doit etre compris entre 1 et 7")
        return value

    @field_validator("report_schedule_day_of_month")
    @classmethod
    def validate_report_monthday(cls, value: int) -> int:
        if value < 1 or value > 31:
            raise ValueError("Le jour du mois doit etre compris entre 1 et 31")
        return value

    @field_validator("report_schedule_month")
    @classmethod
    def validate_report_month(cls, value: int) -> int:
        if value < 1 or value > 12:
            raise ValueError("Le mois doit etre compris entre 1 et 12")
        return value

    @field_validator("report_schedule_timezone")
    @classmethod
    def validate_report_timezone(cls, value: str) -> str:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
        normalized = str(value or "").strip()
        try:
            ZoneInfo(normalized)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Fuseau horaire invalide") from exc
        return normalized

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str) -> str:
        normalized = str(value or "").strip().upper()
        if len(normalized) != 3 or not normalized.isalpha():
            raise ValueError("La devise doit etre un code ISO alphabetique de 3 lettres")
        return normalized

    @field_validator("receipt_paper_width")
    @classmethod
    def validate_receipt_paper_width(cls, value: int) -> int:
        if value not in {58, 80}:
            raise ValueError("La largeur du ticket doit etre 58 ou 80 mm")
        return value

    @field_validator("receipt_copies")
    @classmethod
    def validate_receipt_copies(cls, value: int) -> int:
        if value < 1 or value > 5:
            raise ValueError("Le nombre de copies doit etre compris entre 1 et 5")
        return value

    @field_validator("price_tax_mode")
    @classmethod
    def validate_price_tax_mode(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"exclusive", "inclusive"}:
            raise ValueError("Le mode fiscal doit etre exclusive ou inclusive")
        return normalized

    @field_validator("rounding_scope")
    @classmethod
    def validate_rounding_scope(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"line", "document"}:
            raise ValueError("L'arrondi doit etre applique par ligne ou par document")
        return normalized

    @field_validator("rounding_mode")
    @classmethod
    def validate_rounding_mode(cls, value: str) -> str:
        if str(value or "").strip().lower() != "half_up":
            raise ValueError("Seul l'arrondi commercial half_up est pris en charge")
        return "half_up"

    @field_validator("tax_rates")
    @classmethod
    def validate_tax_rates(cls, value: str) -> str:
        try:
            rates = sorted({Decimal(part.strip()) for part in str(value or "").split(",") if part.strip()})
        except Exception as exc:
            raise ValueError("Liste des taux de taxe invalide") from exc
        if not rates or any(not rate.is_finite() or rate < 0 or rate > 100 for rate in rates):
            raise ValueError("Les taux de taxe doivent etre compris entre 0 et 100")
        return ",".join(format(rate.normalize(), "f") for rate in rates)

    @field_validator(
        "invoice_prefix",
        "quote_prefix",
        "delivery_prefix",
        "credit_note_prefix",
        "po_prefix",
        "purchase_receipt_prefix",
    )
    @classmethod
    def validate_document_prefix(cls, value: str) -> str:
        normalized = str(value or "").strip().upper()
        if not re.fullmatch(r"[A-Z0-9_]{1,12}", normalized):
            raise ValueError("Le prefixe doit contenir 1 a 12 lettres, chiffres ou underscores")
        return normalized


class ReportEmailRequest(BaseModel):
    period_type: str = "daily"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    recipients: str = ""
    subject: str = ""
    include_profit: bool = True
    include_sales_by_category: bool = True
    include_stock_value: bool = True
    include_cash: bool = True
    include_expenses: bool = True
    include_purchases: bool = True

    @field_validator("period_type")
    @classmethod
    def validate_period_type(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"daily", "weekly", "monthly", "yearly", "custom"}:
            raise ValueError("Periode de rapport invalide")
        return normalized

    @field_validator("subject")
    @classmethod
    def validate_subject(cls, value: str) -> str:
        normalized = " ".join(str(value or "").splitlines()).strip()
        if len(normalized) > 180:
            raise ValueError("Le sujet ne doit pas depasser 180 caracteres")
        return normalized


class ReportEmailTestRequest(BaseModel):
    recipient: str = ""


class SmtpPasswordUpdate(BaseModel):
    password: str = Field(min_length=8, max_length=256)

    @field_validator("password")
    @classmethod
    def validate_smtp_password(cls, value: str) -> str:
        normalized = "".join(str(value or "").split())
        if len(normalized) < 8:
            raise ValueError("Le mot de passe SMTP doit contenir au moins 8 caracteres")
        if "\n" in value or "\r" in value or "\x00" in value:
            raise ValueError("Mot de passe SMTP invalide")
        return normalized


class AuditLogOut(BaseModel):
    id: int
    action: str
    entity: str
    entity_id: str = ""
    summary: str = ""
    before_data: str = ""
    after_data: str = ""
    ip_address: str = ""
    user_agent: str = ""
    previous_hash: str = ""
    log_hash: str = ""
    created_by: Optional[int] = None
    created_by_name: str = ""
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}
