"""Small, dependency-free client for verified Wikimedia research material."""
from __future__ import annotations

import html
import json
import re
import ssl
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

import certifi
try:
    import truststore
except ImportError:  # pragma: no cover - setup installs it on supported systems
    truststore = None

from core.config import env_int


class ResearchWebError(RuntimeError):
    pass


@dataclass(frozen=True)
class WebPage:
    page_id: int
    title: str
    extract: str
    url: str


@dataclass(frozen=True)
class WebImage:
    title: str
    url: str
    source_url: str
    mime_type: str
    caption: str
    author: str
    license_name: str


def _plain(value: str) -> str:
    value = html.unescape(re.sub(r"<[^>]+>", " ", value or ""))
    return re.sub(r"\s+", " ", value).strip()


def _article_text(value: str) -> str:
    value = html.unescape(re.sub(r"<[^>]+>", " ", value or ""))
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in value.splitlines()]
    return "\n".join(line for line in lines if line).strip()


class WikimediaResearchClient:
    """Uses public MediaWiki APIs; results always retain their original URL."""

    def __init__(self, language: str = "fr"):
        self.language = language if language in {"ar", "fr", "en"} else "fr"
        self.api = f"https://{self.language}.wikipedia.org/w/api.php"
        self.timeout = max(3, min(env_int("RESEARCH_WEB_TIMEOUT_SECONDS", 15), 45))
        self.user_agent = "LibrarySabriResearch/1.0 (local educational assistant)"

    def _get(self, endpoint: str, params: dict) -> dict:
        url = f"{endpoint}?{urlencode({**params, 'format': 'json', 'formatversion': 2})}"
        request = Request(url, headers={"User-Agent": self.user_agent, "Accept": "application/json"})
        try:
            context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT) if truststore else ssl.create_default_context(cafile=certifi.where())
            with urlopen(request, timeout=self.timeout, context=context) as response:
                if response.status != 200:
                    raise ResearchWebError(f"HTTP {response.status}")
                return json.loads(response.read(2_500_000).decode("utf-8"))
        except Exception as exc:
            raise ResearchWebError("La recherche Wikimedia est momentanément indisponible") from exc

    def _query_in_output_language(self, query: str) -> str:
        """Resolve a title written in another language to the requested wiki.

        A customer may type an Arabic topic while asking for a French report. MediaWiki
        search does not reliably translate such queries, but inter-language links do.
        """
        has_arabic = bool(re.search(r"[\u0600-\u06ff]", query))
        source_language = "ar" if has_arabic else ("en" if self.language != "en" else self.language)
        if source_language == self.language:
            return query
        source_api = f"https://{source_language}.wikipedia.org/w/api.php"
        try:
            payload = self._get(source_api, {
                "action": "query", "titles": query, "redirects": 1,
                "prop": "langlinks", "lllang": self.language, "lllimit": 1,
            })
            for page in payload.get("query", {}).get("pages", []):
                links = page.get("langlinks") or []
                if links and links[0].get("title"):
                    return _plain(links[0]["title"])
        except ResearchWebError:
            pass
        return query

    def search_pages(self, query: str, limit: int = 5) -> list[WebPage]:
        query = self._query_in_output_language(query)
        try:
            exact = self._get(self.api, {
                "action": "query", "titles": query, "prop": "extracts|info", "explaintext": 1,
                "inprop": "url", "redirects": 1,
            })
        except ResearchWebError:
            exact = {}
        try:
            payload = self._get(self.api, {
                "action": "query", "generator": "search", "gsrsearch": query,
                "gsrnamespace": 0, "gsrlimit": max(1, min(limit, 8)),
                "prop": "extracts|info", "explaintext": 1,
                "inprop": "url", "redirects": 1,
            })
        except ResearchWebError:
            payload = {}
        if not exact and not payload:
            raise ResearchWebError("La recherche Wikimedia est momentanément indisponible")
        pages = []
        candidates = exact.get("query", {}).get("pages", []) + payload.get("query", {}).get("pages", [])
        for page in candidates:
            extract = _article_text(page.get("extract", ""))
            page_id = int(page.get("pageid", 0))
            if page.get("missing") or page_id in {item.page_id for item in pages} or len(extract) < 120:
                continue
            pages.append(WebPage(
                page_id=page_id, title=_plain(page.get("title", query)),
                extract=extract, url=page.get("fullurl") or f"https://{self.language}.wikipedia.org/wiki/{page.get('title', '').replace(' ', '_')}",
            ))
            if len(pages) >= limit:
                break
        return pages

    def page_sections(self, page_id: int) -> list[str]:
        payload = self._get(self.api, {"action": "parse", "pageid": page_id, "prop": "sections"})
        blocked = {"references", "références", "sources", "bibliographie", "notes", "voir aussi", "liens externes", "المراجع", "المصادر", "المراجع والمصادر", "انظر أيضا", "انظر أيضاً", "اقرأ أيضا", "اقرأ أيضاً", "وصلات خارجية"}
        result = []
        for section in payload.get("parse", {}).get("sections", []):
            title = _plain(section.get("line", ""))
            # Only top-level article axes belong in the research outline. Level-2
            # headings remain inside their parent section as structured subsections.
            # Mixing both levels used to duplicate content and scramble the report.
            if section.get("toclevel") != 1 or not title or title.casefold() in blocked:
                continue
            if title.casefold() not in {item.casefold() for item in result}:
                result.append(title)
        return result[:8]

    def search_images(self, query: str, limit: int = 6) -> list[WebImage]:
        payload = self._get("https://commons.wikimedia.org/w/api.php", {
            "action": "query", "generator": "search", "gsrsearch": query,
            "gsrnamespace": 6, "gsrlimit": max(1, min(limit * 2, 20)),
            "prop": "imageinfo", "iiprop": "url|mime|extmetadata", "iiurlwidth": 900,
        })
        images = []
        for page in payload.get("query", {}).get("pages", []):
            info = (page.get("imageinfo") or [{}])[0]
            mime = info.get("mime", "")
            image_url = info.get("thumburl") or info.get("url", "")
            if mime not in {"image/jpeg", "image/png", "image/webp"} or urlparse(image_url).scheme != "https":
                continue
            meta = info.get("extmetadata") or {}
            license_name = _plain((meta.get("LicenseShortName") or {}).get("value", ""))
            if not license_name:
                continue
            images.append(WebImage(
                title=_plain(page.get("title", "").removeprefix("File:")), url=image_url,
                source_url=info.get("descriptionurl", ""), mime_type=mime,
                caption=_plain((meta.get("ImageDescription") or {}).get("value", ""))[:480],
                author=_plain((meta.get("Artist") or {}).get("value", ""))[:180],
                license_name=license_name[:120],
            ))
            if len(images) >= limit:
                break
        return images

    @staticmethod
    def access_date() -> datetime:
        return datetime.now(timezone.utc).replace(tzinfo=None)
