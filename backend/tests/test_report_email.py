from unittest.mock import MagicMock, patch
from datetime import datetime

import pytest
from fastapi import HTTPException

from api.routes import reports
from api.schemas import ReportEmailRequest


def smtp_settings(**overrides):
    values = {
        "smtp_host": "smtp.example.com",
        "smtp_port": 587,
        "smtp_from_email": "reports@example.com",
        "smtp_from_name": "Library Sabri",
        "smtp_security": "starttls",
        "smtp_timeout_seconds": 10,
        "report_email_cc": "copy@example.com",
        "report_email_bcc": "hidden@example.com",
    }
    values.update(overrides)
    return values


def test_csv_emails_normalizes_deduplicates_and_accepts_semicolons():
    assert reports._csv_emails(" ONE@example.com;two@example.com,one@example.com ") == [
        "one@example.com",
        "two@example.com",
    ]


def test_csv_emails_rejects_invalid_address():
    with pytest.raises(HTTPException) as error:
        reports._csv_emails("valid@example.com,not-an-email")
    assert error.value.status_code == 422


def test_custom_period_rejects_bad_date_without_internal_error():
    with pytest.raises(HTTPException) as error:
        reports._date_range("custom", "2026-99-01", "2026-08-01")
    assert error.value.status_code == 400


def test_monthly_schedule_day_31_runs_on_last_day_of_short_month():
    now = datetime(2026, 2, 28, 20, 0)
    settings = {
        "report_email_enabled": True,
        "report_email_recipients": "owner@example.com",
        "report_schedule_frequency": "monthly",
        "report_schedule_day_of_month": 31,
        "report_schedule_time": "20:00",
    }
    assert reports._is_schedule_due(settings, now) is True


@patch("api.routes.reports.smtplib.SMTP")
def test_send_email_uses_starttls_and_all_recipients(mock_smtp):
    server = MagicMock()
    mock_smtp.return_value.__enter__.return_value = server

    reports._send_email(
        smtp_settings(),
        ["owner@example.com", "owner@example.com"],
        "Daily report",
        "<strong>Ready</strong>",
    )

    server.ehlo.assert_called()
    server.starttls.assert_called_once()
    sent = server.send_message.call_args.kwargs["to_addrs"]
    assert sent == ["owner@example.com", "copy@example.com", "hidden@example.com"]
    message = server.send_message.call_args.args[0]
    assert "hidden@example.com" not in str(message)


@patch("api.routes.reports.smtplib.SMTP")
def test_send_email_returns_clear_authentication_error(mock_smtp):
    server = MagicMock()
    mock_smtp.return_value.__enter__.return_value = server
    server.login.side_effect = reports.smtplib.SMTPAuthenticationError(535, b"denied")

    with pytest.raises(HTTPException) as error:
        reports._send_email(
            smtp_settings(smtp_username="user", smtp_password="bad"),
            ["owner@example.com"],
            "Report",
            "<p>Report</p>",
        )
    assert error.value.status_code == 502
    assert "Authentification SMTP refusee" in error.value.detail


def test_send_email_rejects_port_security_mismatch_before_connection():
    with pytest.raises(HTTPException) as error:
        reports._send_email(
            smtp_settings(smtp_security="ssl", smtp_port=587),
            ["owner@example.com"],
            "Report",
            "<p>Report</p>",
        )
    assert error.value.status_code == 400
    assert "port 587 exige STARTTLS" in error.value.detail


def test_report_html_contains_professional_sections_and_mobile_metadata():
    data = {
        "summary": {"revenue": 100, "paid": 80, "unpaid": 20, "cogs": 40, "net_profit": 45, "expenses": 15, "purchases": 25, "sale_count": 3, "purchase_count": 1, "margin_pct": 60},
        "trend": {"revenue": 12.5, "paid": 5, "net_profit": 8, "expenses": -2, "purchases": 1},
        "categories": [{"category": "Papeterie", "count": 3, "total": 100}],
        "top_items": [{"name": "Cahier", "product_type": "product", "quantity": 2.0, "revenue": 50}],
        "stock": {"total_value": 500, "products_count": 10, "low_stock_count": 2},
        "cash": {"cash_in": 80, "cash_out": 10, "net_cash": 70},
    }
    rendered = reports._render_report_html(
        {"name": "Library Sabri", "currency": "MAD", "report_schedule_timezone": "Africa/Casablanca"},
        ReportEmailRequest(),
        reports.date(2026, 8, 1),
        reports.date(2026, 8, 3),
        data,
    )
    assert 'name="viewport"' in rendered
    assert "Meilleures ventes" in rendered
    assert "Ventes par categorie" in rendered
    assert "12.5% vs periode precedente" in rendered
    assert "Cahier" in rendered


@patch("api.routes.reports.smtplib.SMTP")
def test_gmail_from_header_aligns_with_authenticated_account(mock_smtp):
    server = MagicMock()
    mock_smtp.return_value.__enter__.return_value = server
    reports._send_email(
        smtp_settings(
            smtp_host="smtp.gmail.com",
            smtp_username="sender@gmail.com",
            smtp_password="app-password",
            smtp_from_email="different@gmail.com",
        ),
        ["owner@example.com"],
        "Report",
        "<p>Report</p>",
    )
    message = server.send_message.call_args.args[0]
    assert "sender@gmail.com" in message["From"]
    assert "different@gmail.com" not in message["From"]
    assert message["Date"]
    assert message["Message-ID"].endswith("@gmail.com>")
