"""Exact monetary arithmetic and the single document-total policy."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Iterable

from fastapi import HTTPException

MONEY_STEP = Decimal("0.01")
PRICE_STEP = Decimal("0.0001")
QUANTITY_STEP = Decimal("0.0001")
PERCENT_STEP = Decimal("0.0001")
ZERO = Decimal("0")
HUNDRED = Decimal("100")
DEFAULT_TAX_RATES = (Decimal("0"), Decimal("7"), Decimal("10"), Decimal("14"), Decimal("20"))


def decimal_value(value: Any, field: str = "value") -> Decimal:
    try:
        result = Decimal(str(value if value is not None else 0))
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(400, f"Valeur numerique invalide: {field}")
    if not result.is_finite():
        raise HTTPException(400, f"Valeur numerique invalide: {field}")
    return result


def quantize_money(value: Any) -> Decimal:
    return decimal_value(value).quantize(MONEY_STEP, rounding=ROUND_HALF_UP)


def quantize_price(value: Any) -> Decimal:
    return decimal_value(value).quantize(PRICE_STEP, rounding=ROUND_HALF_UP)


def quantize_quantity(value: Any) -> Decimal:
    return decimal_value(value).quantize(QUANTITY_STEP, rounding=ROUND_HALF_UP)


def quantize_percent(value: Any) -> Decimal:
    return decimal_value(value).quantize(PERCENT_STEP, rounding=ROUND_HALF_UP)


def decimal_sum(values: Iterable[Any], step: Decimal = MONEY_STEP) -> Decimal:
    total = sum((decimal_value(value) for value in values), ZERO)
    return total.quantize(step, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class MoneyPolicy:
    currency_code: str = "MAD"
    price_tax_mode: str = "exclusive"
    rounding_scope: str = "line"
    allowed_tax_rates: tuple[Decimal, ...] = DEFAULT_TAX_RATES
    tax_enabled: bool = True


def _setting_enabled(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in {"0", "false", "no", "off", ""}


def policy_from_settings(settings: dict | None) -> MoneyPolicy:
    settings = settings or {}
    currency = str(settings.get("currency") or "MAD").strip().upper()
    if len(currency) != 3 or not currency.isalpha():
        raise HTTPException(500, "Code devise invalide dans les parametres")
    tax_mode = str(settings.get("price_tax_mode") or "exclusive").strip().lower()
    if tax_mode not in {"exclusive", "inclusive"}:
        raise HTTPException(500, "Mode de prix fiscal invalide dans les parametres")
    rounding_scope = str(settings.get("rounding_scope") or "line").strip().lower()
    if rounding_scope not in {"line", "document"}:
        raise HTTPException(500, "Portee d'arrondi invalide dans les parametres")
    raw_rates = settings.get("tax_rates") or "0,7,10,14,20"
    try:
        rates = tuple(sorted({quantize_percent(value.strip()) for value in str(raw_rates).split(",") if value.strip()}))
    except HTTPException:
        raise HTTPException(500, "Liste des taux de taxe invalide dans les parametres")
    if not rates or any(rate < ZERO or rate > HUNDRED for rate in rates):
        raise HTTPException(500, "Liste des taux de taxe invalide dans les parametres")
    tax_enabled = _setting_enabled(settings.get("tva_enabled"), True)
    return MoneyPolicy(currency, tax_mode, rounding_scope, rates, tax_enabled)


def _validate_line(item: dict, policy: MoneyPolicy) -> dict:
    quantity = quantize_quantity(item.get("quantity"))
    unit_price = quantize_price(item.get("unit_price"))
    purchase_price = quantize_price(item.get("purchase_price", 0))
    discount = quantize_percent(item.get("discount", 0))
    tax_rate = quantize_percent(item.get("tax_rate", 0)) if policy.tax_enabled else ZERO
    if quantity <= ZERO:
        raise HTTPException(400, "La quantite doit etre strictement positive")
    if unit_price < ZERO:
        raise HTTPException(400, "Le prix unitaire ne peut pas etre negatif")
    if purchase_price < ZERO:
        raise HTTPException(400, "Le prix d'achat ne peut pas etre negatif")
    if discount < ZERO or discount > HUNDRED:
        raise HTTPException(400, "La remise doit etre comprise entre 0 et 100")
    if tax_rate not in policy.allowed_tax_rates:
        allowed = ", ".join(format(rate, "f") for rate in policy.allowed_tax_rates)
        raise HTTPException(400, f"Taux de taxe invalide. Taux autorises: {allowed}")
    return {
        **item,
        "quantity": quantity,
        "unit_price": unit_price,
        "purchase_price": purchase_price,
        "discount": discount,
        "tax_rate": tax_rate,
    }


def _allocate(raw_values: list[Decimal], target: Decimal) -> list[Decimal]:
    """Round values to cents while preserving their exact document-level sum."""
    if not raw_values:
        return []
    rounded = [value.quantize(MONEY_STEP, rounding=ROUND_HALF_UP) for value in raw_values]
    cents = int(((target - sum(rounded, ZERO)) / MONEY_STEP).to_integral_value())
    if cents == 0:
        return rounded
    direction = 1 if cents > 0 else -1
    residues = [raw - rounded_value for raw, rounded_value in zip(raw_values, rounded)]
    order = sorted(range(len(raw_values)), key=lambda index: residues[index], reverse=direction > 0)
    for offset in range(abs(cents)):
        index = order[offset % len(order)]
        rounded[index] += MONEY_STEP * direction
    return rounded


def calculate_document(
    raw_items: list[dict],
    document_discount: Any = 0,
    policy: MoneyPolicy | None = None,
) -> dict:
    policy = policy or MoneyPolicy()
    if not raw_items:
        raise HTTPException(400, "Le document doit contenir au moins une ligne")
    global_discount = quantize_percent(document_discount)
    if global_discount < ZERO or global_discount > HUNDRED:
        raise HTTPException(400, "La remise globale doit etre comprise entre 0 et 100")

    validated = [_validate_line(dict(item), policy) for item in raw_items]
    net_raw: list[Decimal] = []
    tax_raw: list[Decimal] = []
    discount_raw: list[Decimal] = []
    for item in validated:
        base = item["quantity"] * item["unit_price"]
        factor = (HUNDRED - item["discount"]) / HUNDRED
        factor *= (HUNDRED - global_discount) / HUNDRED
        discounted = base * factor
        discount_raw.append(base - discounted)
        rate_factor = item["tax_rate"] / HUNDRED
        if policy.price_tax_mode == "inclusive":
            gross = discounted
            net = gross / (Decimal("1") + rate_factor) if rate_factor else gross
            tax = gross - net
        else:
            net = discounted
            tax = net * rate_factor
        net_raw.append(net)
        tax_raw.append(tax)

    if policy.rounding_scope == "document":
        net_target = quantize_money(sum(net_raw, ZERO))
        tax_target = quantize_money(sum(tax_raw, ZERO))
        discount_target = quantize_money(sum(discount_raw, ZERO))
        nets = _allocate(net_raw, net_target)
        taxes = _allocate(tax_raw, tax_target)
        discounts = _allocate(discount_raw, discount_target)
    else:
        nets = [quantize_money(value) for value in net_raw]
        taxes = [quantize_money(value) for value in tax_raw]
        discounts = [quantize_money(value) for value in discount_raw]
        net_target = sum(nets, ZERO)
        tax_target = sum(taxes, ZERO)
        discount_target = sum(discounts, ZERO)

    lines = []
    breakdown: dict[Decimal, dict[str, Decimal]] = {}
    for item, net, tax, discount_amount in zip(validated, nets, taxes, discounts):
        total = net + tax
        item.update({
            "discount_amount": discount_amount,
            "line_total": net,
            "tax_amount": tax,
            "total_amount": total,
        })
        lines.append(item)
        bucket = breakdown.setdefault(item["tax_rate"], {"taxable_amount": ZERO, "tax_amount": ZERO, "total_amount": ZERO})
        bucket["taxable_amount"] += net
        bucket["tax_amount"] += tax
        bucket["total_amount"] += total

    tax_breakdown = [{
        "rate": rate,
        "taxable_amount": values["taxable_amount"],
        "tax_amount": values["tax_amount"],
        "total_amount": values["total_amount"],
    } for rate, values in sorted(breakdown.items())] if policy.tax_enabled else []
    total_amount = net_target + tax_target
    return {
        "items": lines,
        "discount_amount": discount_target,
        "subtotal": net_target,
        "tax_amount": tax_target,
        "total_amount": total_amount,
        "tax_breakdown": tax_breakdown,
        "currency_code": policy.currency_code,
        "price_tax_mode": policy.price_tax_mode,
        "rounding_scope": policy.rounding_scope,
    }


def serialize_tax_breakdown(breakdown: list[dict]) -> str:
    import json

    return json.dumps([
        {key: format(value, "f") if isinstance(value, Decimal) else value for key, value in row.items()}
        for row in breakdown
    ], ensure_ascii=False, separators=(",", ":"))


def parse_tax_breakdown(value: str | None) -> list[dict]:
    import json

    try:
        rows = json.loads(value or "[]")
    except (TypeError, json.JSONDecodeError):
        return []
    return [{
        "rate": quantize_percent(row.get("rate", 0)),
        "taxable_amount": quantize_money(row.get("taxable_amount", 0)),
        "tax_amount": quantize_money(row.get("tax_amount", 0)),
        "total_amount": quantize_money(row.get("total_amount", 0)),
    } for row in rows if isinstance(row, dict)]
