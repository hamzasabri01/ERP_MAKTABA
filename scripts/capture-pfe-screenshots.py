from __future__ import annotations

import asyncio
import base64
import json
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

import websockets


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "screenshots"
BASE_URL = "http://127.0.0.1:8015"
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


PAGES = [
    ("01-login", f"{BASE_URL}/erp/login", False, 1366, 768),
    ("02-dashboard", f"{BASE_URL}/erp/dashboard", True, 1366, 768),
    ("03-security-center", f"{BASE_URL}/erp/security", True, 1366, 768),
    ("04-backup-chiffre", f"{BASE_URL}/erp/settings?tab=backup", True, 1366, 768),
    ("05-reports", f"{BASE_URL}/erp/reports", True, 1366, 768),
    ("06-users-roles", f"{BASE_URL}/erp/users", True, 1366, 768),
    ("07-security-mobile", f"{BASE_URL}/erp/security", True, 390, 844),
]


def request_json(url: str, method: str = "GET", data: dict | None = None, headers: dict | None = None) -> dict:
    payload = None if data is None else json.dumps(data).encode("utf-8")
    req_headers = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=payload, headers=req_headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_chrome(port: int) -> str:
    last_error = None
    for _ in range(80):
        try:
            return request_json(f"http://127.0.0.1:{port}/json/version")["webSocketDebuggerUrl"]
        except Exception as exc:
            last_error = exc
            time.sleep(0.15)
    raise RuntimeError(f"Chrome DevTools not ready: {last_error}")


class Cdp:
    def __init__(self, ws):
        self.ws = ws
        self.next_id = 0

    async def call(self, method: str, params: dict | None = None):
        self.next_id += 1
        message_id = self.next_id
        await self.ws.send(json.dumps({"id": message_id, "method": method, "params": params or {}}))
        while True:
            raw = json.loads(await self.ws.recv())
            if raw.get("id") == message_id:
                if "error" in raw:
                    raise RuntimeError(raw["error"])
                return raw.get("result", {})

    async def wait_event(self, name: str, timeout: float = 8.0):
        end = time.time() + timeout
        while time.time() < end:
            try:
                raw = await asyncio.wait_for(self.ws.recv(), timeout=max(0.1, end - time.time()))
            except asyncio.TimeoutError:
                return None
            event = json.loads(raw)
            if event.get("method") == name:
                return event
        return None


async def capture_page(browser: Cdp, page: tuple[str, str, bool, int, int], token: str, user: dict):
    name, url, auth_required, width, height = page
    target = await browser.call("Target.createTarget", {"url": f"{BASE_URL}/erp/login"})
    target_id = target["targetId"]

    targets = request_json("http://127.0.0.1:9222/json/list")
    page_ws = next(item["webSocketDebuggerUrl"] for item in targets if item.get("id") == target_id)
    async with websockets.connect(page_ws, max_size=8 * 1024 * 1024) as page_socket:
        page_cdp = Cdp(page_socket)
        await page_cdp.call("Page.enable")
        await page_cdp.call("Runtime.enable")
        await page_cdp.call("Emulation.setDeviceMetricsOverride", {
            "width": width,
            "height": height,
            "deviceScaleFactor": 1,
            "mobile": width < 600,
        })
        if auth_required:
            expression = (
                f"localStorage.setItem('token', {json.dumps(token)});"
                f"localStorage.setItem('user', {json.dumps(json.dumps(user))});"
            )
            await page_cdp.call("Runtime.evaluate", {"expression": expression})
        await page_cdp.call("Page.navigate", {"url": url})
        await page_cdp.wait_event("Page.loadEventFired", timeout=10)
        await asyncio.sleep(2.2)
        screenshot = await page_cdp.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
        (OUT_DIR / f"{name}.png").write_bytes(base64.b64decode(screenshot["data"]))
    await browser.call("Target.closeTarget", {"targetId": target_id})


async def main():
    if not CHROME.exists():
        raise RuntimeError(f"Chrome not found at {CHROME}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    token_response = request_json(
        f"{BASE_URL}/api/auth/login",
        method="POST",
        data={"username": "admin", "password": "admin123"},
    )
    token = token_response["access_token"]
    user = token_response["user"]

    profile = tempfile.mkdtemp(prefix="proerp-pfe-chrome-")
    proc = subprocess.Popen([
        str(CHROME),
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--remote-debugging-port=9222",
        f"--user-data-dir={profile}",
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        browser_ws = wait_for_chrome(9222)
        async with websockets.connect(browser_ws, max_size=8 * 1024 * 1024) as browser_socket:
            browser = Cdp(browser_socket)
            for page in PAGES:
                await capture_page(browser, page, token, user)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    print(f"Screenshots saved to {OUT_DIR}")


if __name__ == "__main__":
    asyncio.run(main())
