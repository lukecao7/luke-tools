#!/usr/bin/env python3

from __future__ import annotations

import json
import re
import shutil
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html import escape
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
ASSETS = ROOT / "site_assets"
DATA = ROOT / "data"
LETTER_DIR = ROOT / "output" / "letters"

NAV_ITEMS = [
    ("首页", "/index.html", "home"),
    ("公司", "/companies/index.html", "companies"),
    ("案例", "/cases/index.html", "cases"),
    ("人物", "/people/index.html", "people"),
    ("概念", "/concepts/index.html", "concepts"),
    ("信件", "/letters/index.html", "letters"),
]

CATEGORY_ORDER = [
    "核心持仓",
    "金融与银行",
    "保险体系",
    "全资业务",
    "国际组合",
    "历史案例",
    "伯克希尔体系",
]

CASE_TYPE_LABELS = {
    "wonderful-business-at-fair-price": "伟大企业合理价",
    "compounder": "长期复利",
    "full-acquisition": "全资收购",
    "panic-repricing": "恐慌定价",
    "structured-private-deal": "私募优先股",
    "mistake-and-exit": "错误与退出",
}

STATUS_LABELS = {
    "active": "进行中",
    "historical": "历史案例",
    "closed": "已结束",
}

TAG_LABELS = {
    "buy": "买入",
    "sell": "卖出",
    "hold": "持有",
    "valuation": "价值锚",
    "market-context": "市场环境",
    "quality": "商业质量",
    "thesis": "投资逻辑",
    "validation": "后续验证",
    "context": "原文上下文",
}

TAG_PRIORITY = {
    "buy": 0,
    "valuation": 1,
    "market-context": 2,
    "quality": 3,
    "thesis": 3,
    "validation": 4,
    "hold": 5,
    "sell": 6,
    "context": 7,
}

KEYWORD_RULES = [
    ("sell", ["our largest sales", "sold down", "disposed of", "eliminated", "reduced our", "trimmed"]),
    (
        "hold",
        [
            "hold",
            "holding",
            "holdings",
            "untouched",
            "maintain indefinitely",
            "patience pays",
            "did not buy or sell",
            "rip van winkle",
        ],
    ),
    (
        "buy",
        [
            "buy",
            "bought",
            "buying",
            "purchase",
            "purchased",
            "completed the purchase",
            "loaded up",
            "increased our ownership",
            "major purchases",
        ],
    ),
    (
        "valuation",
        [
            "intrinsic value",
            "market value",
            "cost",
            "earnings",
            "dividend",
            "less than five times",
            "price",
            "worth",
            "carried at",
        ],
    ),
    (
        "market-context",
        [
            "stock market",
            "market in bank stocks",
            "market for the acquisition",
            "general market decline",
            "gloom",
            "fear",
            "peak",
            "recession",
            "chaotic market",
        ],
    ),
    (
        "quality",
        [
            "competitive advantage",
            "cost advantage",
            "low-cost operator",
            "brand",
            "franchise",
            "best managers",
            "wonderful business",
            "dominance",
            "management",
        ],
    ),
    (
        "validation",
        [
            "worth more than",
            "increased",
            "grew from",
            "working out even better",
            "normal earning power",
            "increased our float",
        ],
    ),
]

SITE_METRICS: dict[str, str | int] = {}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_collection(folder: Path) -> dict[str, dict]:
    items = {}
    if not folder.exists():
        return items
    for path in sorted(folder.glob("*.json")):
        payload = load_json(path)
        items[payload["id"]] = payload
    return items


def load_letters(folder: Path) -> list[dict]:
    letters = []
    for path in sorted(folder.glob("*.json")):
        letters.append(load_json(path))
    return letters


def rel_href(page_path: Path, target: str) -> str:
    src = page_path.parent
    dst = DIST / target.lstrip("/")
    return Path(shutil.os.path.relpath(dst, src)).as_posix()


def slugify(text: str) -> str:
    slug = re.sub(r"[^\w]+", "-", text.lower(), flags=re.UNICODE).strip("-")
    return slug or "section"


def normalize_inline(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def format_money(value: float | int | None) -> str:
    if value is None:
        return "—"
    if value >= 1000:
        return f"${value:,.0f}m"
    return f"${value:,.3f}m".rstrip("0").rstrip(".")


def format_shares(value: int | float | None) -> str:
    if value is None:
        return "—"
    return f"{int(value):,}"


def year_range(company: dict) -> str:
    first = company.get("first_mention_year")
    latest = company.get("latest_mention_year")
    if first and latest:
        if first == latest:
            return str(first)
        return f"{first}-{latest}"
    return "未命中"


def case_type_label(case_type: str) -> str:
    return CASE_TYPE_LABELS.get(case_type, case_type)


def status_label(status: str) -> str:
    return STATUS_LABELS.get(status, status)


def wrap_tag(text: str, cls: str = "tag") -> str:
    return f'<span class="{cls}">{escape(text)}</span>'


def anchor_tag(label: str, href: str, cls: str = "tag") -> str:
    return f'<a class="{cls}" href="{escape(href)}">{escape(label)}</a>'


def unique_strings(items: list[str] | None) -> list[str]:
    seen = set()
    result = []
    for item in items or []:
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def alias_to_pattern(alias: str) -> str:
    escaped = re.escape(alias)
    if re.fullmatch(r"[A-Za-z0-9&.,'’/\- ]+", alias):
        return rf"(?<![A-Za-z0-9]){escaped}(?![A-Za-z0-9])"
    return escaped


def compile_alias_pattern(aliases: list[str]) -> re.Pattern[str] | None:
    cleaned = [alias for alias in aliases if alias]
    if not cleaned:
        return None
    parts = [alias_to_pattern(alias) for alias in sorted(set(cleaned), key=len, reverse=True)]
    return re.compile("|".join(parts), re.IGNORECASE)


def classify(snippet: str) -> str:
    lowered = snippet.lower()
    if "buy commodities, sell brands" in lowered:
        return "quality"
    hold_overrides = [
        "did not buy or sell",
        "not anticipate selling",
        "expect to keep permanently",
        "keep permanently",
        "would not sell",
        "maintain indefinitely",
    ]
    if any(phrase in lowered for phrase in hold_overrides):
        return "hold"
    if any(
        re.search(pattern, lowered)
        for pattern in (
            r"\bour largest sales were\b",
            r"\bwe sold\b",
            r"\bsold down\b",
            r"\bdisposed of\b",
            r"\beliminated\b",
            r"\breduced (?:our|the)\b",
            r"\btrimmed\b",
            r"\bexited\b",
        )
    ):
        return "sell"
    if any(
        re.search(pattern, lowered)
        for pattern in (
            r"\bmade major purchases\b",
            r"\bpurchased additional shares\b",
            r"\bincreased our ownership\b",
            r"\bcompleted the purchase\b",
            r"\bpurchased\b",
            r"\bbought\b",
            r"\bloaded up\b",
        )
    ):
        return "buy"
    for label, keywords in KEYWORD_RULES:
        if label in {"buy", "sell"}:
            continue
        if any(keyword in lowered for keyword in keywords):
            return label
    return "context"


def snippet_around(text: str, start: int, end: int, window: int = 180) -> str:
    left = max(0, start - window)
    right = min(len(text), end + window)
    return normalize_inline(text[left:right])


def table_like_rows(text: str, alias_pattern: re.Pattern[str]) -> list[str]:
    rows = []
    for line in text.splitlines():
        match = alias_pattern.search(line)
        if not match:
            continue
        normalized = normalize_inline(line)
        if len(normalized) > 220:
            left = max(0, match.start() - 28)
            right = min(len(normalized), match.end() + 104)
            normalized = normalize_inline(normalized[left:right]).strip(" .-")
        trimmed_match = alias_pattern.search(normalized)
        if not trimmed_match:
            continue
        before = normalized[: trimmed_match.start()]
        after = normalized[trimmed_match.end() :]
        before_numbers = re.findall(r"\d[\d,.\(\)]*", before)
        after_numbers = re.findall(r"\d[\d,.\(\)]*", after)
        lowered = normalized.lower()
        if any(
            phrase in lowered
            for phrase in (
                "before the",
                "includes ",
                "related restatement",
                "interest expense",
                "operating earnings",
                ".com",
                "calling ",
                "distribution",
                "test us",
            )
        ):
            continue
        if not ((before_numbers and len(after_numbers) >= 2) or len(after_numbers) >= 3):
            continue
        if len(normalized) > 240 and "Shares" not in normalized and "12/31/" not in normalized:
            continue
        rows.append(normalized)
    return rows


def evenly_trim(items: list, limit: int) -> list:
    if len(items) <= limit:
        return items
    if limit <= 1:
        return items[:1]
    chosen = []
    seen = set()
    for step in range(limit):
        idx = round(step * (len(items) - 1) / (limit - 1))
        if idx in seen:
            continue
        chosen.append(items[idx])
        seen.add(idx)
    return chosen[:limit]


def build_company_evidence(meta: dict, letters: list[dict]) -> dict:
    alias_pattern = compile_alias_pattern(meta.get("aliases", []))
    if not alias_pattern:
        return {
            "page_hits": 0,
            "mentions_by_year": [],
            "mention_year_count": 0,
            "first_mention_year": None,
            "latest_mention_year": None,
            "holdings_rows": [],
            "evidence_rows": [],
            "tag_counts": {},
        }

    mentions_by_year = Counter()
    evidence_rows = []
    holdings_rows: list[tuple[int, int, str]] = []
    tag_counts = Counter()

    for letter in letters:
        year = letter["year"]
        for page in letter["pages"]:
            text = page["text"]
            matches = list(alias_pattern.finditer(text))
            if not matches:
                continue

            mentions_by_year[year] += 1

            for row in table_like_rows(text, alias_pattern):
                holdings_rows.append((year, page["page"], row))

            seen_snippets = set()
            for match in matches[:4]:
                snippet = snippet_around(text, match.start(), match.end())
                if snippet in seen_snippets:
                    continue
                seen_snippets.add(snippet)
                tag = classify(snippet)
                tag_counts[tag] += 1
                evidence_rows.append(
                    {
                        "year": year,
                        "page": page["page"],
                        "tag": tag,
                        "snippet": snippet,
                    }
                )

    evidence_rows = sorted(
        {(row["year"], row["page"], row["tag"], row["snippet"]) for row in evidence_rows},
        key=lambda item: (TAG_PRIORITY.get(item[2], 99), item[0], item[1], item[3]),
    )
    evidence_records = [
        {"year": year, "page": page, "tag": tag, "snippet": snippet}
        for year, page, tag, snippet in evenly_trim(list(evidence_rows), 12)
    ]
    holdings_records = [
        {"year": year, "page": page, "row": row}
        for year, page, row in evenly_trim(sorted(set(holdings_rows)), 12)
    ]
    years = sorted(mentions_by_year)

    return {
        "page_hits": sum(mentions_by_year.values()),
        "mentions_by_year": [{"year": year, "count": mentions_by_year[year]} for year in years],
        "mention_year_count": len(years),
        "first_mention_year": years[0] if years else None,
        "latest_mention_year": years[-1] if years else None,
        "holdings_rows": holdings_records,
        "evidence_rows": evidence_records,
        "tag_counts": dict(tag_counts),
    }


def build_company_summary(base: dict, evidence: dict, override_summary: str | None) -> str:
    if override_summary:
        return override_summary

    page_hits = evidence["page_hits"]
    if not page_hits:
        return "参考索引已收录该公司，但在当前 1977-2024 股东信语料中尚未检出高置信直接提及，适合作为待补研究条目。"

    tags = [
        TAG_LABELS[key]
        for key in ("buy", "valuation", "market-context", "quality", "hold", "sell")
        if evidence["tag_counts"].get(key)
    ]
    focus = "、".join(tags[:3]) if tags else "原文提及"
    return (
        f"在当前 1977-2024 股东信语料中共检出 {page_hits} 个信号页面，"
        f"时间主要集中在 {year_range(evidence)}，更适合作为“{base['category']}”的研究入口，"
        f"下一步宜围绕 {focus} 三类问题继续深挖。"
    )


def year_range(evidence_or_company: dict) -> str:
    first = evidence_or_company.get("first_mention_year")
    latest = evidence_or_company.get("latest_mention_year")
    if first and latest:
        return str(first) if first == latest else f"{first}-{latest}"
    return "未命中"


def build_research_statuses(company: dict, cases: dict[str, dict]) -> list[dict]:
    case_records = [cases[case_id] for case_id in company.get("cases", []) if case_id in cases]
    has_entry = bool(company["tag_counts"].get("buy") or any(case.get("market_context") for case in case_records))
    has_value = bool(company["holdings_rows"] or company["tag_counts"].get("valuation") or any(case.get("valuation_checkpoints") for case in case_records))
    has_validation = bool(
        company["tag_counts"].get("validation")
        or company["tag_counts"].get("hold")
        or any(case.get("what_happened_next") for case in case_records)
        or (
            company.get("first_mention_year")
            and company.get("latest_mention_year")
            and company["latest_mention_year"] > company["first_mention_year"]
        )
    )
    has_exit = bool(
        company["tag_counts"].get("sell")
        or any(case.get("exit_logic") for case in case_records)
        or any(case.get("hold_logic") for case in case_records)
    )
    return [
        {"label": "买入环境", "done": has_entry},
        {"label": "价值锚", "done": has_value},
        {"label": "后续验证", "done": has_validation},
        {"label": "卖出/不卖逻辑", "done": has_exit},
    ]


def build_research_prompts(company: dict, cases: dict[str, dict]) -> list[str]:
    prompts = []
    case_records = [cases[case_id] for case_id in company.get("cases", []) if case_id in cases]
    exit_types = {case.get("exit_logic", {}).get("type") for case in case_records if case.get("exit_logic")}
    sell_weight = company["tag_counts"].get("sell", 0)
    hold_weight = company["tag_counts"].get("hold", 0)

    if company["cases"]:
        prompts.append("先读正式 case，再回到原文页核对叙事是否站得住。")
    elif company["holdings_rows"]:
        prompts.append("优先把持仓表行串成时间序列，确认这家公司在组合里扮演的角色。")
    elif company["page_hits"]:
        prompts.append("先确认第一次明确提及的年份，再判断它是买入、持有还是评论对象。")
    else:
        prompts.append("当前语料没有直接命中，若要深挖需要补入更早信件或并购资料。")

    if "sold" in exit_types or "structure-mistake" in exit_types or sell_weight > hold_weight:
        prompts.append("重点补足减持或卖出的触发条件，而不是只写结果。")
    elif company["tag_counts"].get("hold"):
        prompts.append("重点补足为什么长期不卖，而不是只展示涨幅。")
    else:
        prompts.append("补出价值锚和市场环境，避免把后见之明混入买点叙事。")

    if not company["cases"] and company["page_hits"]:
        prompts.append("当前页面仍偏证据底稿，后续适合抽成正式 deep dive case。")

    return prompts[:3]


def prepare_companies(
    company_catalog: dict[str, dict],
    company_overrides: dict[str, dict],
    cases: dict[str, dict],
    letters: list[dict],
) -> dict[str, dict]:
    case_map: dict[str, list[str]] = defaultdict(list)
    for case in cases.values():
        case_map[case["company_id"]].append(case["id"])

    companies = {}
    for company_id, catalog_meta in company_catalog.items():
        evidence = build_company_evidence(catalog_meta, letters)
        base = {
            "id": company_id,
            "name": catalog_meta["name"],
            "english_name": catalog_meta.get("english_name", ""),
            "ticker": catalog_meta.get("ticker", "N/A"),
            "category": catalog_meta.get("category", "未分类"),
            "aliases": catalog_meta.get("aliases", []),
            "kind": "company",
            "cases": case_map.get(company_id, []),
            "related_people": [],
            "related_concepts": [],
        }
        override = company_overrides.get(company_id, {})
        company = {**base, **override}

        combined_cases = []
        for case_id in (override.get("cases", []) or []) + case_map.get(company_id, []):
            if case_id not in combined_cases:
                combined_cases.append(case_id)
        company["cases"] = combined_cases
        company["page_hits"] = evidence["page_hits"]
        company["mentions_by_year"] = evidence["mentions_by_year"]
        company["mention_year_count"] = evidence["mention_year_count"]
        company["holdings_rows"] = evidence["holdings_rows"]
        company["evidence_rows"] = evidence["evidence_rows"]
        company["tag_counts"] = evidence["tag_counts"]
        company["first_mention_year"] = override.get("first_mention_year") or evidence["first_mention_year"]
        company["latest_mention_year"] = override.get("latest_mention_year") or evidence["latest_mention_year"]
        company["summary"] = build_company_summary(company, evidence, override.get("summary"))
        company["research_statuses"] = build_research_statuses(company, cases)
        company["research_prompts"] = build_research_prompts(company, cases)
        company["coverage_note"] = (
            "当前页面整合了 1977-2024 Berkshire 股东信自动抽取证据与已整理的正式案例。"
            if company["cases"]
            else (
                "当前页面由 1977-2024 Berkshire 股东信语料自动抽取的证据构成。"
                if company["page_hits"]
                else "该公司来自参考站 coverage baseline，但当前 1977-2024 Berkshire 股东信语料未检出高置信直接提及。"
            )
        )
        companies[company_id] = company

    for company_id, override in company_overrides.items():
        if company_id in companies:
            continue
        companies[company_id] = override

    return companies


def html_page(page_path: Path, *, title: str, description: str, active: str, body: str) -> str:
    nav_links = []
    mobile_links = []
    for label, href, key in NAV_ITEMS:
        classes = "active" if key == active else ""
        nav_links.append(
            f'<a class="sidebar-link {classes}" href="{escape(rel_href(page_path, href))}">{escape(label)}</a>'
        )
        mobile_links.append(
            f'<a class="mobile-link {classes}" href="{escape(rel_href(page_path, href))}">{escape(label)}</a>'
        )

    year = datetime.now(timezone.utc).year
    company_count = SITE_METRICS.get("company_count", "—")
    case_count = SITE_METRICS.get("case_count", "—")
    corpus_span = SITE_METRICS.get("corpus_span", "1977-2024")

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)}</title>
  <meta name="description" content="{escape(description)}">
  <link rel="stylesheet" href="{escape(rel_href(page_path, '/assets/style.css'))}">
</head>
<body>
  <div class="site-shell">
    <div class="site-layout">
      <aside class="sidebar">
        <div class="sidebar-inner">
          <a href="{escape(rel_href(page_path, '/index.html'))}" class="brand">
            <span class="brand-mark">Buffett Casebook</span>
            <span class="brand-name">巴菲特投资案例库</span>
          </a>
          <p class="sidebar-copy">Coverage 参考索引站，depth 回到 Berkshire 原文，把公司页做成真正能继续深挖的研究入口。</p>
          <nav class="sidebar-nav">
            {''.join(nav_links)}
          </nav>
          <div class="sidebar-block">
            <div class="sidebar-label">Corpus</div>
            <p>{escape(str(corpus_span))} 股东信 · {escape(str(company_count))} 家公司 · {escape(str(case_count))} 个正式案例。</p>
          </div>
          <div class="sidebar-block sidebar-block-accent">
            <div class="sidebar-label">Research Frame</div>
            <ul>
              <li>买入时公司值多少</li>
              <li>当时市场环境如何</li>
              <li>几年后如何被验证</li>
              <li>为什么卖或为什么不卖</li>
            </ul>
          </div>
          <div class="sidebar-foot">Goldman-style memo on top of Berkshire primary sources · {year}</div>
        </div>
      </aside>
      <div class="content-frame">
        <header class="mobile-bar">
          <div class="mobile-brand-wrap">
            <a href="{escape(rel_href(page_path, '/index.html'))}" class="brand">
              <span class="brand-mark">Buffett Casebook</span>
              <span class="brand-name">巴菲特投资案例库</span>
            </a>
          </div>
          <nav class="mobile-nav">
            {''.join(mobile_links)}
          </nav>
        </header>
        <main class="page">
          {body}
        </main>
        <footer class="footer">
          <div class="footer-inner">
            <div>Coverage baseline from the reference index. Depth rebuilt from Berkshire letters.</div>
            <div>Citation-first archive · 1977-2024 corpus</div>
          </div>
        </footer>
      </div>
    </div>
  </div>
</body>
</html>
"""


def hero(
    title: str,
    lede: str,
    *,
    eyebrow: str,
    pills: list[str] | None = None,
    stats: list[tuple[str, str]] | None = None,
) -> str:
    pills_html = ""
    pill_items = unique_strings(pills)
    if pill_items:
        pills_html = '<div class="pill-row">' + "".join(wrap_tag(item, "pill") for item in pill_items) + "</div>"
    stats_html = ""
    if stats:
        stats_html = '<div class="stats">' + "".join(
            f'<div class="stat"><strong>{escape(value)}</strong><span>{escape(label)}</span></div>'
            for label, value in stats
        ) + "</div>"
    return f"""
    <section class="hero">
      <div class="hero-grid">
        <div>
          <p class="eyebrow">{escape(eyebrow)}</p>
          <h1>{escape(title)}</h1>
          <p class="lede">{escape(lede)}</p>
        </div>
        <div class="hero-side">
          {pills_html}
          {stats_html}
        </div>
      </div>
    </section>
    """


def section(title: str, content: str, *, copy: str | None = None, section_id: str | None = None) -> str:
    anchor_id = section_id or slugify(title)
    copy_html = f'<p class="section-copy">{escape(copy)}</p>' if copy else ""
    return f"""
    <section class="section" id="{escape(anchor_id)}">
      <div class="section-head">
        <div>
          <h2>{escape(title)}</h2>
          {copy_html}
        </div>
      </div>
      {content}
    </section>
    """


def card(
    title: str,
    body: str,
    *,
    meta: list[str] | None = None,
    href: str | None = None,
    eyebrow: str | None = None,
) -> str:
    eyebrow_html = f'<p class="card-eyebrow">{escape(eyebrow)}</p>' if eyebrow else ""
    meta_html = ""
    if meta:
        meta_html = '<div class="card-meta">' + "".join(wrap_tag(item) for item in meta if item) + "</div>"
    link_html = f'<a class="card-link" href="{escape(href)}">查看详情</a>' if href else ""
    return f"""
    <article class="card">
      {eyebrow_html}
      <h3>{escape(title)}</h3>
      <p>{escape(body)}</p>
      {meta_html}
      {link_html}
    </article>
    """


def linked_tags(page_path: Path, items: list[str], mapping: dict[str, dict], base: str) -> str:
    tags = []
    for item_id in items:
        meta = mapping.get(item_id)
        if not meta:
            continue
        href = rel_href(page_path, f"/{base}/{item_id}/index.html")
        tags.append(anchor_tag(meta["name"], href))
    if not tags:
        return '<div class="empty-state">当前没有整理出关联条目。</div>'
    return '<div class="tag-row">' + "".join(tags) + "</div>"


def status_grid(statuses: list[dict]) -> str:
    items = []
    for item in statuses:
        cls = "signal-card done" if item["done"] else "signal-card pending"
        state = "已覆盖" if item["done"] else "待补"
        items.append(
            f'<article class="{cls}"><span>{escape(item["label"])}</span><strong>{escape(state)}</strong></article>'
        )
    return '<div class="signal-grid">' + "".join(items) + "</div>"


def prompt_list(items: list[str]) -> str:
    if not items:
        return '<div class="empty-state">当前没有额外研究提示。</div>'
    return '<div class="panel"><ul>' + "".join(f"<li>{escape(item)}</li>" for item in items) + "</ul></div>"


def mentions_strip(company: dict) -> str:
    if not company["mentions_by_year"]:
        return '<div class="empty-state">当前语料没有检出可展示的年份时间线。</div>'
    chips = []
    for item in company["mentions_by_year"]:
        chips.append(
            f'<article class="mention-chip"><span>{escape(str(item["year"]))}</span><strong>{escape(str(item["count"]))}</strong></article>'
        )
    return '<div class="mention-strip">' + "".join(chips) + "</div>"


def holdings_table(page_path: Path, rows: list[dict]) -> str:
    if not rows:
        return '<div class="empty-state">当前没有抽出高信号持仓表格行。</div>'
    body_rows = []
    for item in rows:
        pdf_href = rel_href(page_path, f"/pdfs/{item['year']}ltr.pdf")
        body_rows.append(
            "<tr>"
            f"<td>{escape(str(item['year']))}</td>"
            f"<td>{escape(str(item['page']))}</td>"
            f'<td class="mono-cell">{escape(item["row"])}</td>'
            f'<td><a class="inline-link" href="{escape(pdf_href)}#page={escape(str(item["page"]))}">打开 PDF</a></td>'
            "</tr>"
        )
    return (
        "<table><thead><tr><th>Year</th><th>Page</th><th>High-Signal Row</th><th>Source</th></tr></thead><tbody>"
        + "".join(body_rows)
        + "</tbody></table>"
    )


def evidence_list(page_path: Path, rows: list[dict]) -> str:
    if not rows:
        return '<div class="empty-state">当前没有抽出可展示的证据摘录。</div>'
    items = []
    for item in rows:
        pdf_href = rel_href(page_path, f"/pdfs/{item['year']}ltr.pdf")
        items.append(
            f"""
            <article class="evidence-row">
              <div class="evidence-meta">
                <span class="evidence-tag">{escape(TAG_LABELS.get(item["tag"], item["tag"]))}</span>
                <span class="pill">{escape(str(item["year"]))} / p.{escape(str(item["page"]))}</span>
                <a class="pill" href="{escape(pdf_href)}#page={escape(str(item["page"]))}">原文 PDF</a>
              </div>
              <p class="quote">{escape(item["snippet"])}</p>
            </article>
            """
        )
    return '<div class="evidence-list">' + "".join(items) + "</div>"


def checkpoints_table(checkpoints: list[dict]) -> str:
    if not checkpoints:
        return '<div class="empty-state">当前没有整理出明确的估值或持仓检查点。</div>'
    rows = []
    for item in checkpoints:
        rows.append(
            "<tr>"
            f"<td>{escape(str(item['year']))}</td>"
            f"<td>{escape(item['label'])}</td>"
            f"<td>{escape(format_shares(item.get('shares')))}</td>"
            f"<td>{escape(format_money(item.get('cost_usd_m')))}</td>"
            f"<td>{escape(format_money(item.get('market_value_usd_m')))}</td>"
            f"<td>{escape(format_money(item.get('dividend_usd_m')))}</td>"
            "</tr>"
        )
    return (
        "<table><thead><tr>"
        "<th>Year</th><th>Label</th><th>Shares</th><th>Cost</th><th>Market Value</th><th>Dividend</th>"
        "</tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table>"
    )


def timeline(items: list[dict], *, empty: str) -> str:
    if not items:
        return f'<div class="empty-state">{escape(empty)}</div>'
    nodes = []
    for item in items:
        nodes.append(
            f'<article class="timeline-item"><div class="timeline-label">{escape(str(item["year"]))}</div><strong>{escape(item["summary"])}</strong></article>'
        )
    return '<div class="timeline">' + "".join(nodes) + "</div>"


def note_panel(title: str, body: str, *, cls: str = "note-panel") -> str:
    return f'<div class="{cls}"><div class="note-kicker">{escape(title)}</div><p>{escape(body)}</p></div>'


def buy_window_label(case: dict) -> str:
    start = case["buy_window"]["start_year"]
    end = case["buy_window"].get("end_year", start)
    return str(start) if start == end else f"{start}-{end}"


def case_anchor(case: dict) -> str:
    return f"case-{slugify(case['id'])}"


def describe_checkpoint(item: dict) -> str:
    pieces = [str(item["year"])]
    label = item.get("label")
    if label:
        pieces.append(label)
    if item.get("shares") is not None:
        pieces.append(f"{format_shares(item['shares'])} shares")
    if item.get("cost_usd_m") is not None:
        pieces.append(f"cost {format_money(item['cost_usd_m'])}")
    if item.get("market_value_usd_m") is not None:
        pieces.append(f"value {format_money(item['market_value_usd_m'])}")
    if item.get("dividend_usd_m") is not None:
        pieces.append(f"dividend {format_money(item['dividend_usd_m'])}")
    return " · ".join(pieces)


def case_value_digest(case: dict) -> str:
    checkpoints = case.get("valuation_checkpoints", [])
    if not checkpoints:
        return "当前还没有整理出明确的成本、仓位或市值检查点。"
    if len(checkpoints) == 1:
        return describe_checkpoint(checkpoints[0])
    return f"首个锚点：{describe_checkpoint(checkpoints[0])}。最新锚点：{describe_checkpoint(checkpoints[-1])}。"


def build_case_decision_markup(case: dict) -> str:
    decision_body = (
        f'<div class="callout"><strong>{escape(case["exit_logic"]["summary"])}</strong></div>'
        if case.get("exit_logic")
        else ""
    )
    if case.get("hold_logic"):
        decision_body += "<div class='panel'><ul>" + "".join(
            f"<li>{escape(item)}</li>" for item in case["hold_logic"]
        ) + "</ul></div>"
    return decision_body or '<div class="empty-state">当前还没有补出退出或持有逻辑。</div>'


def build_case_citations_markup(page_path: Path, citations: list[dict]) -> str:
    if not citations:
        return '<div class="empty-state">当前还没有整理出可展示的 case 引文。</div>'
    evidence_rows = []
    for citation in citations:
        pdf_href = rel_href(page_path, f"/pdfs/{citation['year']}ltr.pdf")
        evidence_rows.append(
            f"""
            <article class="evidence-row">
              <div class="evidence-meta">
                <span class="evidence-tag">{escape(TAG_LABELS.get(citation["tag"], citation["tag"]))}</span>
                <span class="pill">{escape(str(citation["year"]))} / p.{escape(str(citation["page"]))}</span>
                <a class="pill" href="{escape(pdf_href)}#page={escape(str(citation["page"]))}">打开原文 PDF</a>
              </div>
              <strong>{escape(citation['claim'])}</strong>
              <p class="quote">{escape(citation.get('excerpt', ''))}</p>
            </article>
            """
        )
    return '<div class="evidence-list">' + "".join(evidence_rows) + "</div>"


def build_company_file_map(company: dict, case_records: list[dict]) -> str:
    tags = []
    if case_records:
        tags.append(anchor_tag("Company Deep Dive", "#company-deep-dive"))
        for case in case_records:
            tags.append(anchor_tag(f"{buy_window_label(case)} Case", f"#{case_anchor(case)}"))
    tags.append(anchor_tag("Research Coverage", "#research-coverage"))
    tags.append(anchor_tag("Mentions", "#mentions-through-the-letters"))
    if company.get("holdings_rows"):
        tags.append(anchor_tag("Holdings", "#holdings-snapshots"))
    tags.append(anchor_tag("Evidence", "#evidence-ledger"))
    return f"""
    <section class="section section-tight">
      <div class="case-map">
        <div class="case-map-label">Company File Map</div>
        <div class="tag-row">{"".join(tags)}</div>
      </div>
    </section>
    """


def build_company_casebook(page_path: Path, company: dict, case_records: list[dict]) -> str:
    if not case_records:
        return ""

    case_blocks = []
    for case in sorted(case_records, key=lambda item: item["buy_window"]["start_year"]):
        case_href = rel_href(page_path, f"/cases/{case['id']}/index.html")
        summary = case["summary"]
        entry_text = (
            case.get("market_context", [{}])[0].get("summary")
            if case.get("market_context")
            else summary["one_liner"]
        )
        validation_text = (
            case.get("what_happened_next", [{}])[-1].get("summary")
            if case.get("what_happened_next")
            else summary.get("current_state", "—")
        )
        decision_seed = (
            case.get("exit_logic", {}).get("summary")
            or (case.get("hold_logic") or ["当前还没有补出退出或持有逻辑。"])[0]
        )
        pills = [
            company["name"],
            case_type_label(case["case_type"]),
            status_label(case["status"]),
            f"Buy Window {buy_window_label(case)}",
        ]
        thesis_markup = prompt_list(case.get("thesis", []))
        decision_markup = build_case_decision_markup(case)
        citations_markup = build_case_citations_markup(page_path, case.get("citations", []))

        case_blocks.append(
            f"""
            <article class="casefile" id="{escape(case_anchor(case))}">
              <div class="casefile-head">
                <div class="casefile-copy">
                  <p class="eyebrow">Flagship Case</p>
                  <h3>{escape(case["title"])}</h3>
                  <p class="casefile-lede">{escape(summary["one_liner"])}</p>
                </div>
                <div class="casefile-side">
                  <div class="pill-row">{"".join(wrap_tag(item, "pill") for item in pills)}</div>
                  <a class="pill" href="{escape(case_href)}">打开完整案例页</a>
                </div>
              </div>
              <div class="memo-grid">
                {note_panel("Why Then", entry_text, cls="note-panel memo-card")}
                {note_panel("Value Anchor", case_value_digest(case), cls="note-panel memo-card")}
                {note_panel("Validation Arc", validation_text, cls="note-panel memo-card")}
                {note_panel("Decision Rule", decision_seed, cls="note-panel memo-card")}
              </div>
              <div class="subsection-grid">
                <section class="subsection">
                  <div class="subsection-head"><h4>Entry Window &amp; Market Backdrop</h4></div>
                  {timeline(case.get("market_context", []), empty="当前还没有整理出买入窗口的环境时间线。")}
                </section>
                <section class="subsection">
                  <div class="subsection-head"><h4>Value Track</h4></div>
                  {checkpoints_table(case.get("valuation_checkpoints", []))}
                </section>
                <section class="subsection">
                  <div class="subsection-head"><h4>What Happened Next</h4></div>
                  {timeline(case.get("what_happened_next", []), empty="当前还没有整理出后续验证时间线。")}
                </section>
                <section class="subsection">
                  <div class="subsection-head"><h4>Business Quality &amp; Thesis</h4></div>
                  {thesis_markup}
                </section>
                <section class="subsection">
                  <div class="subsection-head"><h4>Exit / Hold Logic</h4></div>
                  {decision_markup}
                </section>
                <section class="subsection">
                  <div class="subsection-head"><h4>Key Citations</h4></div>
                  {citations_markup}
                </section>
              </div>
            </article>
            """
        )

    return section(
        "Company Deep Dive",
        f'<div class="casefile-stack">{"".join(case_blocks)}</div>',
        copy="公司页现在直接内嵌正式 case 的核心论证：先看买点、价值锚、验证和决策，再决定是否进入完整案例页。",
        section_id="company-deep-dive",
    )


def company_index_card(company: dict) -> str:
    meta = [
        year_range(company),
        f"{company['page_hits']} signal pages" if company["page_hits"] else "0 signal pages",
        f"{len(company['cases'])} deep dive" if company["cases"] else "Index-level profile",
    ]
    ticker = company.get("ticker") or "N/A"
    eyebrow = company.get("english_name") or ticker
    return card(
        company["name"],
        company["summary"],
        meta=meta,
        href=f"{company['id']}/index.html",
        eyebrow=eyebrow,
    )


def case_index_card(case: dict, company: dict) -> str:
    window = buy_window_label(case)
    meta = [company["name"], case_type_label(case["case_type"]), status_label(case["status"])]
    return card(
        case["title"],
        case["summary"]["one_liner"],
        meta=meta,
        href=f"{case['id']}/index.html",
        eyebrow=f"Buy Window · {window}",
    )


def build_home(companies: dict, cases: dict, people: dict, concepts: dict, letters: list[str]) -> str:
    intro_markup = """
    <section class="section section-tight" id="intro">
      <div class="intro-sheet">
        <div class="note-kicker">Intro</div>
        <p class="intro-copy">这个网站先借鉴参考站的 coverage，再把重心移回到真正重要的 deep dive：买入时公司值多少、当时环境如何、几年后 thesis 如何被验证，以及为什么卖或为什么一直不卖。</p>
        <p class="intro-copy">公司页不再是薄薄一层百科，而是由原文页码、持仓表高信号行、提及时间线和正式案例共同组成的研究入口。</p>
        <div class="jump-row">
          <a class="jump-card" href="companies/index.html">
            <span class="jump-label">Company Catalog</span>
            <strong>先从公司目录进入</strong>
          </a>
          <a class="jump-card" href="cases/index.html">
            <span class="jump-label">Deep Dives</span>
            <strong>直接读正式案例</strong>
          </a>
          <a class="jump-card" href="letters/index.html">
            <span class="jump-label">Primary Sources</span>
            <strong>回到原始 PDF</strong>
          </a>
        </div>
      </div>
    </section>
    """

    return (
        hero(
            "从股东信里，重建投资决策。",
            "首页只保留最简 intro。真正的内容已经下沉到 company index、evidence pages 与 flagship cases 里。",
            eyebrow="Buffett Casebook",
            pills=["Sidebar research UI", "Citation-first", "Deep dive over trivia"],
            stats=[
                ("公司", str(len(companies))),
                ("案例", str(len(cases))),
                ("信件", str(len(letters))),
            ],
        )
        + intro_markup
    )


def build_companies_index(companies: dict, cases: dict) -> str:
    groups = defaultdict(list)
    for company in companies.values():
        groups[company.get("category", "未分类")].append(company)

    nav_tags = []
    sections = []
    for category in CATEGORY_ORDER + sorted(set(groups) - set(CATEGORY_ORDER)):
        items = groups.get(category)
        if not items:
            continue
        items = sorted(items, key=lambda item: (-len(item.get("cases", [])), -item.get("page_hits", 0), item["name"]))
        section_id = slugify(category)
        nav_tags.append(anchor_tag(f"{category} ({len(items)})", f"#{section_id}", "pill"))
        cards = "".join(company_index_card(company) for company in items)
        sections.append(
            section(
                category,
                f'<div class="cards">{cards}</div>',
                copy=f"这一组当前收录 {len(items)} 家公司，优先展示正式案例和高信号原文命中。",
                section_id=section_id,
            )
        )

    return (
        hero(
            "公司索引",
            "这次不再只列两家公司。目录层尽量靠近参考站的 coverage，但每家公司都会落到本地 PDF 证据上。",
            eyebrow="Companies",
            pills=["Coverage rebuilt", "Grouped catalog", "Evidence-backed entry pages"],
            stats=[
                ("总公司数", str(len(companies))),
                ("正式案例", str(sum(1 for company in companies.values() if company.get("cases")))),
                ("原文命中页", str(sum(company.get("page_hits", 0) for company in companies.values()))),
            ],
        )
        + section("Catalog Map", '<div class="pill-row">' + "".join(nav_tags) + "</div>")
        + "".join(sections)
    )


def build_company_page(page_path: Path, company: dict, cases: dict, people: dict, concepts: dict) -> str:
    case_records = [cases[case_id] for case_id in company.get("cases", []) if case_id in cases]

    overview_tags = [company.get("category", "未分类")]
    if company.get("english_name"):
        overview_tags.append(company["english_name"])
    if company.get("ticker") and company["ticker"] != "N/A":
        overview_tags.append(company["ticker"])

    intro = (
        '<div class="two-col">'
        + note_panel("Research Memo", company["coverage_note"])
        + note_panel("What To Do Next", " ".join(company["research_prompts"]))
        + "</div>"
    )

    body = [
        hero(
            company["name"],
            company["summary"],
            eyebrow="Company",
            pills=overview_tags,
            stats=[
                ("信号页", str(company.get("page_hits", 0))),
                ("提及区间", year_range(company)),
                ("正式案例", str(len(company.get("cases", [])))),
            ],
        ),
        intro,
        build_company_file_map(company, case_records),
    ]

    if case_records:
        body.append(build_company_casebook(page_path, company, case_records))

    body.extend([
        section("Research Coverage", status_grid(company["research_statuses"]), copy="先看这家公司目前已经覆盖到哪一层，再决定是否继续深挖。"),
        section("Mentions Through The Letters", mentions_strip(company), copy="每个数字代表该年份里命中的高信号页面数量。"),
        section("Holdings Snapshots", holdings_table(page_path, company["holdings_rows"]), copy="从表格高信号行里先看仓位、成本与后续市值的变化。"),
        section("Evidence Ledger", evidence_list(page_path, company["evidence_rows"]), copy="原文摘录不是终点，而是继续写 case 的证据底稿。"),
    ])

    body.append(section("继续深挖的切口", prompt_list(company["research_prompts"])))

    if company.get("related_people"):
        body.append(section("相关人物", linked_tags(page_path, company["related_people"], people, "people")))
    if company.get("related_concepts"):
        body.append(section("相关概念", linked_tags(page_path, company["related_concepts"], concepts, "concepts")))

    return "".join(body)


def build_cases_index(cases: dict, companies: dict) -> str:
    ordered = sorted(cases.values(), key=lambda case: case["buy_window"]["start_year"], reverse=True)
    cards = []
    for case in ordered:
        company = companies[case["company_id"]]
        cards.append(case_index_card(case, company))
    return (
        hero(
            "案例索引",
            "案例页是站点的核心资产。它们不满足于讲故事，而是尽量把 entry, value, validation, exit 四件事拆开写清楚。",
            eyebrow="Cases",
            pills=["Entry", "Value", "Validation", "Exit / Hold"],
            stats=[
                ("正式案例", str(len(cases))),
                ("仍持有", str(sum(1 for case in cases.values() if case["status"] == "active"))),
                ("历史案例", str(sum(1 for case in cases.values() if case["status"] != "active"))),
            ],
        )
        + section("全部案例", f'<div class="cards">{"".join(cards)}</div>')
    )


def build_case_page(page_path: Path, case: dict, company: dict) -> str:
    summary = case["summary"]
    buy_window = buy_window_label(case)
    kpis = [
        ("案例类型", case_type_label(case["case_type"])),
        ("状态", status_label(case["status"])),
        ("买入窗口", buy_window),
        ("总成本", format_money(summary.get("cost_basis_total_usd_m"))),
        ("当前状态", summary.get("current_state", "—")),
    ]
    kpi_html = '<div class="kpi-grid">' + "".join(
        f'<div class="kpi"><div class="kpi-label">{escape(label)}</div><div class="kpi-value">{escape(value)}</div></div>'
        for label, value in kpis
    ) + "</div>"

    thesis = "<div class='panel'><ul>" + "".join(f"<li>{escape(item)}</li>" for item in case.get("thesis", [])) + "</ul></div>"
    decision_body = build_case_decision_markup(case)

    case_map = """
    <section class="section section-tight">
      <div class="case-map">
        <div class="case-map-label">Case File Map</div>
        <div class="tag-row">
          <a class="tag" href="#memo">Investment Memo</a>
          <a class="tag" href="#entry">Entry Window</a>
          <a class="tag" href="#value">Value Track</a>
          <a class="tag" href="#next">What Happened Next</a>
          <a class="tag" href="#thesis">Thesis</a>
          <a class="tag" href="#decision">Exit / Hold</a>
          <a class="tag" href="#evidence">Evidence</a>
        </div>
      </div>
    </section>
    """

    body = [
        hero(
            case["title"],
            summary["one_liner"],
            eyebrow=f"Case · {company['name']}",
            pills=[company["name"], case_type_label(case["case_type"]), status_label(case["status"])],
            stats=[
                ("买入窗口", buy_window),
                ("总成本", format_money(summary.get("cost_basis_total_usd_m"))),
                ("当前状态", summary.get("current_state", "—")),
            ],
        ),
        case_map,
        section("Investment Memo", kpi_html, copy="先把 case 的边界钉牢，再进入背景、估值和结果。", section_id="memo"),
        section(
            "Entry Window & Market Backdrop",
            timeline(case.get("market_context", []), empty="当前还没有整理出买入窗口的环境时间线。"),
            copy="买点不等于股价最低点，关键是当时为什么值得出手。",
            section_id="entry",
        ),
        section("Value Track", checkpoints_table(case.get("valuation_checkpoints", [])), section_id="value"),
        section(
            "What Happened Next",
            timeline(case.get("what_happened_next", []), empty="当前还没有整理出后续验证时间线。"),
            copy="把验证过程拆开写，避免用最终结果倒推买入逻辑。",
            section_id="next",
        ),
        section("Business Quality & Thesis", thesis, section_id="thesis"),
        section("Exit Or Hold Logic", decision_body, section_id="decision"),
        section("Evidence Ledger", build_case_citations_markup(page_path, case.get("citations", [])), section_id="evidence"),
    ]

    if case.get("known_gaps"):
        body.append(
            section(
                "Known Gaps",
                '<div class="callout"><strong>语料边界</strong><ul>' + "".join(
                    f"<li>{escape(item)}</li>" for item in case["known_gaps"]
                ) + "</ul></div>",
            )
        )

    return "".join(body)


def build_people_index(people: dict, companies: dict) -> str:
    cards = []
    for person in sorted(people.values(), key=lambda item: item["name"]):
        linked_companies = [
            company["name"]
            for company in companies.values()
            if person["id"] in company.get("related_people", [])
        ]
        body = person["summary"]
        meta = linked_companies[:3] if linked_companies else ["人物页正在补充关联公司"]
        cards.append(card(person["name"], body, meta=meta, href=f"{person['id']}/index.html", eyebrow="Person"))
    return (
        hero(
            "人物索引",
            "人物页不做名人录，而是回答谁在关键案例里改变了企业轨迹。",
            eyebrow="People",
            pills=["Managers matter"],
            stats=[("人物", str(len(people))), ("关联公司", str(sum(1 for company in companies.values() if company.get("related_people"))))],
        )
        + section("关键人物", f'<div class="cards">{"".join(cards)}</div>')
    )


def build_person_page(page_path: Path, person: dict, companies: dict) -> str:
    company_cards = []
    for company in sorted(companies.values(), key=lambda item: item["name"]):
        if person["id"] not in company.get("related_people", []):
            continue
        company_cards.append(
            card(
                company["name"],
                company["summary"],
                meta=[company.get("category", "未分类"), year_range(company)],
                href=rel_href(page_path, f"/companies/{company['id']}/index.html"),
                eyebrow=company.get("english_name"),
            )
        )
    content = f'<div class="cards">{"".join(company_cards)}</div>' if company_cards else '<div class="empty-state">当前没有关联公司。</div>'
    return (
        hero(person["name"], person["summary"], eyebrow="Person")
        + section("相关公司与案例", content)
    )


def build_concepts_index(concepts: dict, companies: dict) -> str:
    cards = []
    for concept in sorted(concepts.values(), key=lambda item: item["name"]):
        company_names = [
            company["name"]
            for company in companies.values()
            if concept["id"] in company.get("related_concepts", [])
        ]
        meta = company_names[:3] if company_names else ["概念页正在补充对应公司"]
        cards.append(card(concept["name"], concept["summary"], meta=meta, href=f"{concept['id']}/index.html", eyebrow="Concept"))
    return (
        hero(
            "概念索引",
            "概念页负责把抽象词汇重新锚回具体公司和 case，而不是停留在定义层面。",
            eyebrow="Concepts",
            pills=["Case-linked ideas"],
            stats=[("概念", str(len(concepts))), ("被公司引用", str(sum(1 for company in companies.values() if company.get("related_concepts"))))],
        )
        + section("核心概念", f'<div class="cards">{"".join(cards)}</div>')
    )


def build_concept_page(page_path: Path, concept: dict, companies: dict) -> str:
    company_cards = []
    for company in sorted(companies.values(), key=lambda item: (-len(item.get("cases", [])), item["name"])):
        if concept["id"] not in company.get("related_concepts", []):
            continue
        company_cards.append(
            card(
                company["name"],
                company["summary"],
                meta=[company.get("category", "未分类"), f"{len(company.get('cases', []))} cases"],
                href=rel_href(page_path, f"/companies/{company['id']}/index.html"),
                eyebrow=company.get("english_name"),
            )
        )
    content = f'<div class="cards">{"".join(company_cards)}</div>' if company_cards else '<div class="empty-state">当前没有整理出对应公司。</div>'
    return hero(concept["name"], concept["summary"], eyebrow="Concept") + section("能体现这个概念的公司", content)


def build_letters_index(letter_files: list[str]) -> str:
    by_decade = defaultdict(list)
    for filename in letter_files:
        year = int(filename[:4])
        by_decade[(year // 10) * 10].append(filename)

    groups = []
    for decade in sorted(by_decade):
        tags = []
        for filename in by_decade[decade]:
            year = filename[:4]
            tags.append(anchor_tag(f"{year} PDF", f"../pdfs/{filename}"))
        groups.append(f'<section class="panel"><h3>{decade}s</h3><div class="tag-row">{"".join(tags)}</div></section>')

    return (
        hero(
            "历年股东信",
            "所有 case 和 company evidence 都会回链到这些原始 PDF。站点里的一切判断，最终都应该能回到原文。",
            eyebrow="Letters",
            pills=["Primary sources", "PDF archive"],
            stats=[("年份", str(len(letter_files))), ("起点", letter_files[0][:4]), ("终点", letter_files[-1][:4])],
        )
        + section("按年代浏览", '<div class="grid">' + "".join(groups) + "</div>")
    )


def write_page(relative_path: str, *, title: str, description: str, active: str, body: str) -> None:
    page_path = DIST / relative_path
    page_path.parent.mkdir(parents=True, exist_ok=True)
    page_path.write_text(
        html_page(page_path, title=title, description=description, active=active, body=body),
        encoding="utf-8",
    )


def main() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True, exist_ok=True)

    shutil.copytree(ASSETS, DIST / "assets")

    pdf_dir = DIST / "pdfs"
    pdf_dir.mkdir()
    letter_files = []
    for pdf in sorted(ROOT.glob("*ltr.pdf")):
        shutil.copy2(pdf, pdf_dir / pdf.name)
        letter_files.append(pdf.name)

    letters = load_letters(LETTER_DIR)
    company_catalog = load_json(DATA / "company_aliases.json")
    company_overrides = load_collection(DATA / "companies")
    cases = load_collection(DATA / "cases")
    people = load_collection(DATA / "people")
    concepts = load_collection(DATA / "concepts")
    companies = prepare_companies(company_catalog, company_overrides, cases, letters)

    global SITE_METRICS
    SITE_METRICS = {
        "company_count": len(companies),
        "case_count": len(cases),
        "corpus_span": f"{letters[0]['year']}-{letters[-1]['year']}",
    }

    write_page(
        "index.html",
        title="巴菲特投资案例库",
        description="Coverage 参考索引站，depth 回到 Berkshire letters 的巴菲特研究站。",
        active="home",
        body=build_home(companies, cases, people, concepts, letter_files),
    )

    write_page(
        "companies/index.html",
        title="公司索引",
        description="覆盖更广、证据更深的巴菲特公司研究索引。",
        active="companies",
        body=build_companies_index(companies, cases),
    )
    for company in companies.values():
        write_page(
            f"companies/{company['id']}/index.html",
            title=f"{company['name']} · 公司页",
            description=company["summary"],
            active="companies",
            body=build_company_page(DIST / f"companies/{company['id']}/index.html", company, cases, people, concepts),
        )

    write_page(
        "cases/index.html",
        title="案例索引",
        description="以买点、价值和退出逻辑为核心组织的巴菲特案例页。",
        active="cases",
        body=build_cases_index(cases, companies),
    )
    for case in cases.values():
        company = companies[case["company_id"]]
        write_page(
            f"cases/{case['id']}/index.html",
            title=f"{case['title']} · 案例页",
            description=case["summary"]["one_liner"],
            active="cases",
            body=build_case_page(DIST / f"cases/{case['id']}/index.html", case, company),
        )

    write_page(
        "people/index.html",
        title="人物索引",
        description="把关键人物重新锚回公司与投资案例。",
        active="people",
        body=build_people_index(people, companies),
    )
    for person in people.values():
        write_page(
            f"people/{person['id']}/index.html",
            title=f"{person['name']} · 人物页",
            description=person["summary"],
            active="people",
            body=build_person_page(DIST / f"people/{person['id']}/index.html", person, companies),
        )

    write_page(
        "concepts/index.html",
        title="概念索引",
        description="把概念重新锚回公司、证据与案例。",
        active="concepts",
        body=build_concepts_index(concepts, companies),
    )
    for concept in concepts.values():
        write_page(
            f"concepts/{concept['id']}/index.html",
            title=f"{concept['name']} · 概念页",
            description=concept["summary"],
            active="concepts",
            body=build_concept_page(DIST / f"concepts/{concept['id']}/index.html", concept, companies),
        )

    write_page(
        "letters/index.html",
        title="历年股东信",
        description="1977-2024 年伯克希尔股东信 PDF 归档。",
        active="letters",
        body=build_letters_index(letter_files),
    )

    write_page(
        "404.html",
        title="页面未找到",
        description="页面未找到。",
        active="home",
        body=hero("页面未找到", "你访问的页面不存在，返回首页或从索引页重新进入。", eyebrow="404"),
    )

    print(f"Built static site into {DIST}")


if __name__ == "__main__":
    main()
