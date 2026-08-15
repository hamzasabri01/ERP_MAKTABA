"""Accurate local weather for Berrechid, proxied and cached server-side."""
from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException

from core.security import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

TIMEZONE = ZoneInfo("Africa/Casablanca")
LATITUDE = 33.26553
LONGITUDE = -7.58754
CACHE_FILE = Path(__file__).resolve().parents[2] / ".runtime" / "weather_cache.json"
CACHE_TTL = timedelta(minutes=12)


def _read_cache(*, allow_stale: bool = False) -> dict | None:
    try:
        payload = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        fetched = datetime.fromisoformat(payload["fetched_at"])
        if allow_stale or datetime.now(TIMEZONE) - fetched < CACHE_TTL:
            return payload
    except (OSError, ValueError, TypeError, KeyError):
        pass
    return None


def _write_cache(payload: dict) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = CACHE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(CACHE_FILE)


def _fetch_weather() -> dict:
    query = urllib.parse.urlencode({
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "timezone": "Africa/Casablanca",
        "forecast_days": 7,
        "current": ",".join((
            "temperature_2m", "apparent_temperature", "relative_humidity_2m",
            "precipitation", "weather_code", "cloud_cover", "wind_speed_10m",
            "wind_direction_10m", "wind_gusts_10m", "is_day",
        )),
        "hourly": ",".join((
            "temperature_2m", "apparent_temperature", "precipitation_probability",
            "weather_code", "wind_speed_10m", "relative_humidity_2m",
        )),
        "daily": ",".join((
            "weather_code", "temperature_2m_max", "temperature_2m_min",
            "precipitation_probability_max", "sunrise", "sunset", "uv_index_max",
        )),
    })
    request = urllib.request.Request(
        f"https://api.open-meteo.com/v1/forecast?{query}",
        headers={"User-Agent": "Library-Sabri/1.0"},
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        source = json.loads(response.read().decode("utf-8"))

    current = source.get("current") or {}
    hourly = source.get("hourly") or {}
    daily = source.get("daily") or {}
    if current.get("temperature_2m") is None or not hourly.get("time"):
        raise ValueError("weather provider returned an incomplete response")

    current_time = datetime.fromisoformat(current["time"])
    upcoming = []
    for index, stamp in enumerate(hourly["time"]):
        moment = datetime.fromisoformat(stamp)
        if moment >= current_time.replace(minute=0, second=0, microsecond=0):
            upcoming.append({
                "time": stamp,
                "temperature": hourly["temperature_2m"][index],
                "apparent_temperature": hourly["apparent_temperature"][index],
                "precipitation_probability": hourly["precipitation_probability"][index],
                "weather_code": hourly["weather_code"][index],
                "wind_speed": hourly["wind_speed_10m"][index],
                "humidity": hourly["relative_humidity_2m"][index],
            })
        if len(upcoming) == 12:
            break

    days = [{
        "date": stamp,
        "weather_code": daily["weather_code"][index],
        "temperature_max": daily["temperature_2m_max"][index],
        "temperature_min": daily["temperature_2m_min"][index],
        "precipitation_probability": daily["precipitation_probability_max"][index],
        "sunrise": daily["sunrise"][index],
        "sunset": daily["sunset"][index],
        "uv_index_max": daily["uv_index_max"][index],
    } for index, stamp in enumerate(daily["time"])]

    payload = {
        "city": "Berrechid",
        "city_ar": "برشيد",
        "timezone": "Africa/Casablanca",
        "coordinates": {"latitude": LATITUDE, "longitude": LONGITUDE},
        "current": current,
        "hourly": upcoming,
        "daily": days,
        "source": "Open-Meteo",
        "fetched_at": datetime.now(TIMEZONE).isoformat(),
        "cached": False,
    }
    _write_cache(payload)
    return payload


@router.get("/berrechid")
def berrechid_weather(user=Depends(get_current_user)):
    cached = _read_cache()
    if cached:
        return {**cached, "cached": True}
    try:
        return _fetch_weather()
    except Exception as exc:
        logger.warning("Weather refresh failed: %s", exc)
        stale = _read_cache(allow_stale=True)
        if stale:
            return {**stale, "cached": True, "stale": True}
        raise HTTPException(status_code=503, detail="بيانات الطقس غير متاحة مؤقتاً") from exc
