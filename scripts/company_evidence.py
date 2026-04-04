#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


KEYWORD_RULES = [
    ("sell", ["sell", "sold", "dispose", "disposed", "eliminated", "exit", "exited"]),
    (
        "hold",
        [
            "hold",
            "holding",
            "holdings",
            "untouched",
            "permanent",
            "maintain indefinitely",
            "dividend",
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
            "purchases",
            "loaded up",
            "cost",
            "completed",
            "major purchases",
        ],
    ),
    (
        "valuation",
        [
            "intrinsic value",
            "market value",
            "market prices",
            "price-earnings",
            "valued at",
            "cost market",
        ],
    ),
    (
        "market-context",
        [
            "stock market",
            "market for the acquisition",
            "interest rates",
            "general market decline",
            "business activity",
        ],
    ),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a citation-first evidence report for a Buffett investment case."
    )
    parser.add_argument("--company", required=True, help="Company id from data/company_aliases.json")
    parser.add_argument(
        "--aliases-file",
        type=Path,
        default=Path("data/company_aliases.json"),
        help="JSON file that maps company ids to alias lists",
    )
    parser.add_argument(
        "--extract-dir",
        type=Path,
        default=Path("output/letters"),
        help="Directory containing extracted JSON files from scripts/extract_letters.py",
    )
    parser.add_argument("--start-year", type=int, help="Optional lower year bound")
    parser.add_argument("--end-year", type=int, help="Optional upper year bound")
    parser.add_argument("--out", type=Path, help="Optional markdown output path")
    return parser.parse_args()


def load_aliases(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Alias file must contain an object at the top level.")
    return data


def load_letters(extract_dir: Path, start_year: int | None, end_year: int | None) -> list[dict]:
    letters = []
    for path in sorted(extract_dir.glob("*.json")):
        year = int(path.stem)
        if start_year and year < start_year:
            continue
        if end_year and year > end_year:
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        letters.append(payload)
    return letters


def compile_alias_pattern(aliases: list[str]) -> re.Pattern[str]:
    escaped = sorted({re.escape(alias) for alias in aliases}, key=len, reverse=True)
    return re.compile("|".join(escaped), re.IGNORECASE)


def normalize_inline(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def classify(snippet: str) -> str:
    lowered = snippet.lower()
    hold_overrides = [
        "did not buy or sell",
        "sold no",
        "leave our holdings untouched",
        "leave our holding untouched",
        "rip van winkle",
    ]
    if any(phrase in lowered for phrase in hold_overrides):
        return "hold"
    for label, keywords in KEYWORD_RULES:
        if any(keyword in lowered for keyword in keywords):
            return label
    return "context"


def snippet_around(text: str, start: int, end: int, window: int = 180) -> str:
    left = max(0, start - window)
    right = min(len(text), end + window)
    return normalize_inline(text[left:right])


def table_like_lines(text: str, alias_pattern: re.Pattern[str]) -> list[str]:
    rows = []
    for line in text.splitlines():
        match = alias_pattern.search(line)
        if not match:
            continue

        normalized = normalize_inline(line)
        before = normalized[: match.start()]
        after = normalized[match.end() :]
        before_numbers = re.findall(r"\d[\d,.\(\)]*", before)
        after_numbers = re.findall(r"\d[\d,.\(\)]*", after)

        if not ((before_numbers and len(after_numbers) >= 2) or len(after_numbers) >= 3):
            continue

        if len(normalized) > 320 and "Shares" not in normalized and "12/31/" not in normalized:
            continue

        rows.append(normalized)
    return rows


def build_report(company_id: str, company_name: str, aliases: list[str], letters: list[dict]) -> str:
    alias_pattern = compile_alias_pattern(aliases)
    evidence_rows = []
    holdings_rows = []

    for letter in letters:
        year = letter["year"]
        for page in letter["pages"]:
            page_no = page["page"]
            text = page["text"]
            matches = list(alias_pattern.finditer(text))
            if not matches:
                continue

            page_rows = table_like_lines(text, alias_pattern)
            for row in page_rows:
                holdings_rows.append((year, page_no, row))

            seen_snippets = set()
            for match in matches[:3]:
                snippet = snippet_around(text, match.start(), match.end())
                if snippet in seen_snippets:
                    continue
                seen_snippets.add(snippet)
                evidence_rows.append(
                    {
                        "year": year,
                        "page": page_no,
                        "tag": classify(snippet),
                        "snippet": snippet,
                    }
                )

    evidence_rows.sort(key=lambda item: (item["year"], item["page"], item["tag"], item["snippet"]))
    holdings_rows = sorted(set(holdings_rows), key=lambda item: (item[0], item[1], item[2]))

    lines = [
        f"# {company_name} 证据草稿",
        "",
        "## 别名",
        "",
        f"- company id: `{company_id}`",
        f"- aliases: {', '.join(aliases)}",
        "",
        "## 研究提醒",
        "",
        "- 这份输出是“证据底稿”，不是最后成文。",
        "- 更适合先回答：哪些年份、哪些页、哪些句子最值得人工展开。",
        "- 如果一家公司仍在持有，页面里应该写“不卖逻辑”，而不是强行虚构卖点。",
        "",
    ]

    if holdings_rows:
        lines.extend(
            [
                "## 持仓表格高信号行",
                "",
            ]
        )
        for year, page_no, row in holdings_rows:
            lines.append(f"- {year} / p.{page_no}: `{row}`")
        lines.append("")

    lines.extend(
        [
            "## 时间线证据",
            "",
        ]
    )

    if not evidence_rows:
        lines.append("- 没有检索到匹配结果。")
        lines.append("")
    else:
        for row in evidence_rows:
            lines.append(
                f"- {row['year']} / p.{row['page']} / `{row['tag']}`: {row['snippet']}"
            )
        lines.append("")

    lines.extend(
        [
            "## 建议下一步补写",
            "",
            "- 把 `buy`、`hold`、`sell`、`valuation` 四类证据拆成页面锚点。",
            "- 对表格行里的成本和市值做结构化录入，后面就能画时间线。",
            "- 对没有首次买入原文的案例，明确标注“本地语料仅能从后续回顾中反推”。",
            "",
        ]
    )

    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    aliases_map = load_aliases(args.aliases_file)

    if args.company not in aliases_map:
        print(
            f"Unknown company id: {args.company}. Available ids: {', '.join(sorted(aliases_map))}",
            file=sys.stderr,
        )
        return 1

    letters = load_letters(args.extract_dir, args.start_year, args.end_year)
    if not letters:
        print("No extracted letters found. Run scripts/extract_letters.py first.", file=sys.stderr)
        return 1

    company_meta = aliases_map[args.company]
    report = build_report(
        company_id=args.company,
        company_name=company_meta["name"],
        aliases=company_meta["aliases"],
        letters=letters,
    )

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(report + "\n", encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        print(report)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
