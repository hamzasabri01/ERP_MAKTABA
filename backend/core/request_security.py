"""Trusted client address handling shared by auth and audit logging."""
from __future__ import annotations

import ipaddress

from core.config import env_bool, env_list


def _trusted_proxy(address: str, configured: list[str]) -> bool:
    try:
        candidate = ipaddress.ip_address(address)
    except ValueError:
        return False
    for value in configured:
        try:
            if "/" in value and candidate in ipaddress.ip_network(value, strict=False):
                return True
            if candidate == ipaddress.ip_address(value):
                return True
        except ValueError:
            continue
    return False


def client_ip(request) -> str:
    direct_ip = request.client.host if request and request.client else "unknown"
    trusted_proxies = env_list("TRUSTED_PROXY_IPS", ["127.0.0.1", "::1"])
    if env_bool("TRUST_PROXY_HEADERS", False) and _trusted_proxy(direct_ip, trusted_proxies):
        forwarded = request.headers.get("x-forwarded-for", "")
        candidate = forwarded.split(",", 1)[0].strip()
        if candidate:
            return candidate[:80]
    return str(direct_ip)[:80]
