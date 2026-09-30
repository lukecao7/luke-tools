#!/usr/bin/env python3

from __future__ import annotations

import html
import json
import re
import ssl
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import URLError
from urllib.parse import quote, unquote, urljoin, urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
BASE_URL = "https://buffett-letters-eir.pages.dev/"
BASE_NETLOC = urlsplit(BASE_URL).netloc
MAX_WORKERS = 12

SEED_PATHS = {
    "index.html",
    "changelog.html",
    "style.css",
    "nav.js",
    "search.js",
    "search-index.json",
    "qrcode.jpg",
}

LINK_RE = re.compile(r"""(?:href|src)=["']([^"']+)["']""", re.IGNORECASE)
ANALYTICS_RE = re.compile(
    r"<!-- Cloudflare Pages Analytics -->.*?<!-- Cloudflare Pages Analytics -->",
    re.DOTALL,
)
BACKLINKS_RE = re.compile(r"\s*<section class=\"backlinks\">.*?</section>", re.DOTALL)
ARTICLE_RE = re.compile(r"<article class=\"article\">(.*?)</article>", re.DOTALL)
STORY_SECTION_RE = re.compile(
    r"<h2>投资故事</h2>.*?(?=<h2>巴菲特评价精选</h2>)",
    re.DOTALL,
)
COMPANY_STORY_DIR = ROOT / "data" / "overlays" / "companies"


class ArticleTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._line_break_tags = {"p", "h1", "h2", "h3", "li", "blockquote", "tr", "table"}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._line_break_tags:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def text(self) -> str:
        raw = html.unescape("".join(self.parts))
        lines = [re.sub(r"\s+", " ", line).strip() for line in raw.splitlines()]
        return "\n".join(line for line in lines if line)


def quoted_url(path: str) -> str:
    if not path:
        return BASE_URL
    return urljoin(BASE_URL, quote(path, safe="/:@?&=#%+-._~"))


def local_path_from_url(url: str) -> str | None:
    parsed = urlsplit(url)
    if parsed.netloc and parsed.netloc != BASE_NETLOC:
        return None
    path = unquote(parsed.path.lstrip("/"))
    if not path:
        return "index.html"
    if path.endswith("/"):
        return path + "index.html"
    return path


def fetch(path: str) -> tuple[str, bytes, str]:
    request = Request(
        quoted_url(path),
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
    )
    try:
        with urlopen(request) as response:
            content_type = response.headers.get_content_type()
            return path, response.read(), content_type
    except URLError as exc:
        reason = getattr(exc, "reason", None)
        if not isinstance(reason, ssl.SSLCertVerificationError):
            raise
        insecure_context = ssl._create_unverified_context()
        with urlopen(request, context=insecure_context) as response:
            content_type = response.headers.get_content_type()
            return path, response.read(), content_type


def rewrite_html(text: str) -> str:
    text = ANALYTICS_RE.sub("", text)
    text = text.replace(BASE_URL, "/")
    text = BACKLINKS_RE.sub("", text)
    return text


def save_file(path: str, payload: bytes, content_type: str) -> set[str]:
    relative_path = path or "index.html"
    out_path = DIST / relative_path
    out_path.parent.mkdir(parents=True, exist_ok=True)

    discovered: set[str] = set()
    is_html = content_type == "text/html" or relative_path.endswith(".html")
    if is_html:
        text = rewrite_html(payload.decode("utf-8"))
        out_path.write_text(text, encoding="utf-8")
        for raw in LINK_RE.findall(text):
            if raw.startswith(("#", "mailto:", "javascript:", "data:")):
                continue
            joined = urljoin(quoted_url(relative_path), raw)
            local_path = local_path_from_url(joined)
            if local_path:
                discovered.add(local_path)
        return discovered

    out_path.write_bytes(payload)
    return discovered


def load_search_index() -> list[dict]:
    _, payload, _ = fetch("search-index.json")
    return json.loads(payload.decode("utf-8"))


def company_story_overrides() -> dict[str, Path]:
    overrides: dict[str, Path] = {}
    if not COMPANY_STORY_DIR.exists():
        return overrides

    for fragment_path in sorted(COMPANY_STORY_DIR.glob("*-story.html")):
        company_name = fragment_path.name[: -len("-story.html")]
        overrides[f"companies/{company_name}.html"] = fragment_path
    return overrides


def apply_company_story_overrides(overrides: dict[str, Path]) -> None:
    for relative_path, fragment_path in overrides.items():
        page_path = DIST / relative_path
        if not page_path.exists():
            continue
        html_text = page_path.read_text(encoding="utf-8")
        fragment = fragment_path.read_text(encoding="utf-8").strip() + "\n"
        updated = STORY_SECTION_RE.sub(fragment, html_text, count=1)
        if updated != html_text:
            page_path.write_text(updated, encoding="utf-8")


def article_text_from_html(html_text: str) -> str:
    match = ARTICLE_RE.search(html_text)
    article_html = match.group(1) if match else html_text
    extractor = ArticleTextExtractor()
    extractor.feed(article_html)
    return extractor.text()


def update_search_index_from_overrides(overrides: dict[str, Path]) -> None:
    search_index_path = DIST / "search-index.json"
    if not search_index_path.exists():
        return

    search_index = json.loads(search_index_path.read_text(encoding="utf-8"))
    by_path = {item.get("p"): item for item in search_index}

    for relative_path in overrides:
        page_path = DIST / relative_path
        item = by_path.get(relative_path)
        if not item or not page_path.exists():
            continue
        item["b"] = article_text_from_html(page_path.read_text(encoding="utf-8"))

    search_index_path.write_text(
        json.dumps(search_index, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def mirror_paths(paths: set[str]) -> set[str]:
    discovered: set[str] = set()
    ordered = sorted(paths)
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(fetch, path): path for path in ordered}
        for future in as_completed(futures):
            path, payload, content_type = future.result()
            discovered.update(save_file(path, payload, content_type))
    return discovered


def main() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True, exist_ok=True)

    search_index = load_search_index()
    all_paths = set(SEED_PATHS)
    all_paths.update(item["p"].lstrip("/") for item in search_index if item.get("p"))

    pending = set(all_paths)
    downloaded: set[str] = set()

    while pending:
        newly_seen = mirror_paths(pending)
        downloaded.update(pending)
        pending = {path for path in newly_seen if path not in downloaded}

    overrides = company_story_overrides()
    apply_company_story_overrides(overrides)
    update_search_index_from_overrides(overrides)

    print(
        f"Mirrored reference site into {DIST} "
        f"({len(downloaded)} files from {len(search_index)} indexed pages)"
    )


if __name__ == "__main__":
    main()
