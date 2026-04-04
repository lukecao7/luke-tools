#!/usr/bin/env python3

from __future__ import annotations

import json
import shutil
from collections import defaultdict
from datetime import datetime, timezone
from html import escape
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
ASSETS = ROOT / "site_assets"
DATA = ROOT / "data"

NAV_ITEMS = [
    ("首页", "/index.html", "home"),
    ("公司", "/companies/index.html", "companies"),
    ("案例", "/cases/index.html", "cases"),
    ("人物", "/people/index.html", "people"),
    ("概念", "/concepts/index.html", "concepts"),
    ("信件", "/letters/index.html", "letters"),
]


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


def rel_href(page_path: Path, target: str) -> str:
    src = page_path.parent
    dst = DIST / target.lstrip("/")
    return Path(shutil.os.path.relpath(dst, src)).as_posix()


def html_page(page_path: Path, *, title: str, description: str, active: str, body: str) -> str:
    nav_links = []
    for label, href, key in NAV_ITEMS:
        classes = "active" if key == active else ""
        nav_links.append(
            f'<a class="{classes}" href="{escape(rel_href(page_path, href))}">{escape(label)}</a>'
        )

    year = datetime.now(timezone.utc).year
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
    <header class="topbar">
      <div class="topbar-inner">
        <a href="{escape(rel_href(page_path, '/index.html'))}" class="brand">
          <span class="brand-mark">Buffett Casebook</span>
          <span class="brand-name">巴菲特投资案例库</span>
        </a>
        <nav class="nav">
          {''.join(nav_links)}
        </nav>
      </div>
    </header>
    <main class="page">
      {body}
    </main>
    <footer class="footer">
      <div class="footer-inner small">
        <div>索引层解决 coverage，案例层解决 depth。</div>
        <div>Built from Berkshire letters and case JSON. {year}</div>
      </div>
    </footer>
  </div>
</body>
</html>
"""


def wrap_tag(text: str, cls: str = "tag") -> str:
    return f'<span class="{cls}">{escape(text)}</span>'


def hero(title: str, lede: str, *, eyebrow: str, pills: list[str] | None = None, stats: list[tuple[str, str]] | None = None) -> str:
    pills_html = ""
    if pills:
        pills_html = '<div class="pill-row">' + "".join(wrap_tag(item, "pill") for item in pills) + "</div>"
    stats_html = ""
    if stats:
        stats_html = '<div class="stats">' + "".join(
            f'<div class="stat"><strong>{escape(value)}</strong>{escape(label)}</div>' for label, value in stats
        ) + "</div>"
    return f"""
    <section class="hero">
      <div class="hero-grid">
        <div>
          <p class="eyebrow">{escape(eyebrow)}</p>
          <h1>{escape(title)}</h1>
          <p class="lede">{escape(lede)}</p>
        </div>
        <div>
          {pills_html}
          {stats_html}
        </div>
      </div>
    </section>
    """


def card(title: str, body: str, *, meta: list[str] | None = None, href: str | None = None) -> str:
    meta_html = ""
    if meta:
        meta_html = '<div class="card-meta">' + "".join(wrap_tag(m) for m in meta) + "</div>"
    link_html = ""
    if href:
        link_html = f'<a class="card-link" href="{escape(href)}">查看详情 <span aria-hidden="true">→</span></a>'
    return f"""
    <article class="card">
      <h3>{escape(title)}</h3>
      <p>{escape(body)}</p>
      {meta_html}
      {link_html}
    </article>
    """


def section(title: str, content: str, *, copy: str | None = None) -> str:
    copy_html = f'<p class="section-copy">{escape(copy)}</p>' if copy else ""
    return f"""
    <section class="section">
      <div class="section-head">
        <div>
          <h2>{escape(title)}</h2>
          {copy_html}
        </div>
      </div>
      {content}
    </section>
    """


def format_money(value: float | int | None) -> str:
    if value is None:
        return "—"
    if value >= 1000:
        return f"${value:,.0f}m"
    return f"${value:,.3f}m".rstrip("0").rstrip(".")


def build_home(companies: dict, cases: dict, people: dict, concepts: dict, letters: list[str]) -> str:
    featured_cards = []
    for case in cases.values():
        featured_cards.append(
            card(
                case["title"],
                case["summary"]["one_liner"],
                meta=[
                    case["status"],
                    case["case_type"],
                    f"{case['buy_window']['start_year']}-{case['buy_window'].get('end_year', case['buy_window']['start_year'])}",
                ],
                href=f"cases/{case['id']}/index.html",
            )
        )

    pillars = [
        card("索引层", "保留公司、人物、概念、年份四种入口，让研究材料好找。", meta=["coverage"]),
        card("案例层", "把公司页从百科介绍改成 deep dive 入口，重点写价值、环境、验证和退出逻辑。", meta=["depth"]),
        card("证据层", "所有关键判断都尽量落到年份、页码和原文摘录，减少后见之明。", meta=["citations"]),
    ]

    body = (
        hero(
            "从股东信到投资决策的研究站",
            "保留索引的广度，但把真正的价值放到公司案例的深挖：买入时点、价值锚、市场环境、验证过程，以及卖出或不卖逻辑。",
            eyebrow="Buffett Investment Casebook",
            pills=["Deep dive case pages", "Citation-first research", "GitHub Pages ready"],
            stats=[
                ("公司", str(len(companies))),
                ("案例", str(len(cases))),
                ("人物", str(len(people))),
                ("信件", str(len(letters))),
            ],
        )
        + section("精选案例", f'<div class="cards">{"".join(featured_cards)}</div>', copy="先把最有代表性的案例做深，而不是一开始把所有公司都写浅。")
        + section("方法论", f'<div class="cards">{"".join(pillars)}</div>')
        + section(
            "站点入口",
            '<div class="cards">'
            + card("公司索引", "按公司看巴菲特体系里的角色、相关人物和对应案例。", href="companies/index.html")
            + card("人物索引", "看谁在关键转折中改变了企业命运。", href="people/index.html")
            + card("概念索引", "把护城河、品牌、危机机会等概念落到具体案例。", href="concepts/index.html")
            + card("历年信件", "所有 1977-2024 年 PDF 原文都能直接打开。", href="letters/index.html")
            + "</div>",
        )
    )
    return body


def build_companies_index(companies: dict, cases: dict, people: dict, concepts: dict) -> str:
    cards = []
    for company in companies.values():
        related_case_titles = [cases[case_id]["title"] for case_id in company.get("cases", []) if case_id in cases]
        meta = [f"{company.get('ticker', 'N/A')}", f"{company['first_mention_year']}-{company['latest_mention_year']}"]
        meta.extend(item for item in related_case_titles[:2])
        cards.append(
            card(
                company["name"],
                company["summary"],
                meta=meta,
                href=f"{company['id']}/index.html",
            )
        )
    return (
        hero(
            "公司索引",
            "公司页负责建立上下文和分发案例，不再承担全部分析。",
            eyebrow="Companies",
            pills=["Entry pages, not encyclopedia pages"],
        )
        + section("全部公司", f'<div class="cards">{"".join(cards)}</div>')
    )


def linked_tags(page_path: Path, items: list[str], mapping: dict[str, dict], base: str) -> str:
    tags = []
    for item_id in items:
        meta = mapping.get(item_id)
        if not meta:
            tags.append(wrap_tag(item_id))
            continue
        href = rel_href(page_path, f"/{base}/{item_id}/index.html")
        tags.append(f'<a class="tag" href="{escape(href)}">{escape(meta["name"])}</a>')
    return '<div class="tag-row">' + "".join(tags) + "</div>"


def build_company_page(page_path: Path, company: dict, cases: dict, people: dict, concepts: dict) -> str:
    case_cards = []
    for case_id in company.get("cases", []):
        case = cases[case_id]
        case_cards.append(
            card(
                case["title"],
                case["summary"]["one_liner"],
                meta=[case["status"], case["case_type"]],
                href=rel_href(page_path, f"/cases/{case['id']}/index.html"),
            )
        )

    body = (
        hero(
            company["name"],
            company["summary"],
            eyebrow=f"Company · {company.get('ticker', 'N/A')}",
            pills=[
                f"首次提及 {company['first_mention_year']}",
                f"最近提及 {company['latest_mention_year']}",
            ],
        )
        + section(
            "适合从这里进入的案例",
            f'<div class="cards">{"".join(case_cards)}</div>',
            copy="公司页只做分发，真正的深挖请进入 case page。",
        )
        + section("相关人物", linked_tags(page_path, company.get("related_people", []), people, "people"))
        + section("相关概念", linked_tags(page_path, company.get("related_concepts", []), concepts, "concepts"))
    )
    return body


def build_cases_index(cases: dict, companies: dict) -> str:
    cards = []
    for case in cases.values():
        company = companies[case["company_id"]]
        cards.append(
            card(
                case["title"],
                case["summary"]["one_liner"],
                meta=[company["name"], case["status"], case["case_type"]],
                href=f"{case['id']}/index.html",
            )
        )
    return (
        hero(
            "案例索引",
            "案例页是站点的核心资产。每个案例都优先回答：为什么在那个时间点买、买的时候值多少、后来怎么验证、为什么卖或不卖。",
            eyebrow="Cases",
            pills=["Summary", "Why Then", "Value Track", "Evidence Ledger"],
        )
        + section("全部案例", f'<div class="cards">{"".join(cards)}</div>')
    )


def checkpoints_table(checkpoints: list[dict]) -> str:
    rows = []
    for item in checkpoints:
        rows.append(
            "<tr>"
            f"<td>{escape(str(item['year']))}</td>"
            f"<td>{escape(item['label'])}</td>"
            f"<td>{escape(f'{item.get('shares', '—'):,.0f}' if item.get('shares') else '—')}</td>"
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


def build_case_page(page_path: Path, case: dict, company: dict) -> str:
    summary = case["summary"]
    kpis = [
        ("案例类型", case["case_type"]),
        ("状态", case["status"]),
        ("买入窗口", f"{case['buy_window']['start_year']}-{case['buy_window'].get('end_year', case['buy_window']['start_year'])}"),
        ("总成本", format_money(summary.get("cost_basis_total_usd_m"))),
    ]
    kpi_html = '<div class="kpi-grid">' + "".join(
        f'<div class="kpi"><div class="kpi-label">{escape(label)}</div><div class="kpi-value">{escape(value)}</div></div>'
        for label, value in kpis
    ) + "</div>"

    market_context = '<div class="timeline">' + "".join(
        f'<article class="timeline-item"><div class="timeline-label">{escape(str(item["year"]))}</div><strong>{escape(item["summary"])}</strong></article>'
        for item in case.get("market_context", [])
    ) + "</div>"

    thesis = "<div class='panel'><ul>" + "".join(f"<li>{escape(item)}</li>" for item in case.get("thesis", [])) + "</ul></div>"
    hold_logic = "<div class='panel'><ul>" + "".join(f"<li>{escape(item)}</li>" for item in case.get("hold_logic", [])) + "</ul></div>"
    known_gaps = "<div class='callout'><strong>语料边界：</strong><ul>" + "".join(
        f"<li>{escape(item)}</li>" for item in case.get("known_gaps", [])
    ) + "</ul></div>"

    evidence_rows = []
    for citation in case.get("citations", []):
        pdf_href = rel_href(page_path, f"/pdfs/{citation['year']}ltr.pdf")
        evidence_rows.append(
            f"""
            <article class="evidence-row">
              <div class="evidence-meta">
                <span class="evidence-tag">{escape(citation['tag'])}</span>
                <span class="pill">{escape(str(citation['year']))} / p.{escape(str(citation['page']))}</span>
                <a class="pill" href="{escape(pdf_href)}#page={escape(str(citation['page']))}">打开原文 PDF</a>
              </div>
              <strong>{escape(citation['claim'])}</strong>
              <p class="quote">{escape(citation.get('excerpt', ''))}</p>
            </article>
            """
        )

    body = (
        hero(
            case["title"],
            summary["one_liner"],
            eyebrow=f"Case · {company['name']}",
            pills=[company["name"], case["case_type"], case["summary"]["current_state"]],
        )
        + section("Summary", kpi_html)
        + section(
            "Why Then",
            f'<div class="two-col"><div class="panel"><p>{escape(summary["one_liner"])}</p></div><div>{market_context}</div></div>',
            copy="先写买入时的环境，再写后来发生了什么，避免把后见之明揉成一团。",
        )
        + section("Value At Entry", checkpoints_table(case.get("valuation_checkpoints", [])))
        + section("Business Quality & Thesis", thesis)
        + section("Exit Or Hold Logic", hold_logic)
        + section("Evidence Ledger", '<div class="evidence-list">' + "".join(evidence_rows) + "</div>")
        + section("Known Gaps", known_gaps)
    )
    return body


def build_people_index(people: dict, companies: dict, cases: dict) -> str:
    cards = []
    for person in people.values():
        company_links = [company["name"] for company in companies.values() if person["id"] in company.get("related_people", [])]
        cards.append(
            f"""
            <article class="list-card">
              <h3><a href="{escape(person['id'])}/index.html">{escape(person['name'])}</a></h3>
              <p>{escape(person['summary'])}</p>
              <ul>{''.join(f'<li>{escape(name)}</li>' for name in company_links[:4])}</ul>
            </article>
            """
        )
    return (
        hero(
            "人物索引",
            "人物页不是名人录，而是回答谁在关键案例里改变了企业的轨迹。",
            eyebrow="People",
            pills=["Management matters"],
        )
        + section("关键人物", f'<div class="list-grid">{"".join(cards)}</div>')
    )


def build_person_page(page_path: Path, person: dict, companies: dict, cases: dict) -> str:
    company_cards = []
    for company in companies.values():
        if person["id"] not in company.get("related_people", []):
            continue
        company_cards.append(
            card(
                company["name"],
                company["summary"],
                meta=[f"{company['first_mention_year']}-{company['latest_mention_year']}"],
                href=rel_href(page_path, f"/companies/{company['id']}/index.html"),
            )
        )
    return (
        hero(
            person["name"],
            person["summary"],
            eyebrow="Person",
        )
        + section("相关公司与案例", f'<div class="cards">{"".join(company_cards)}</div>')
    )


def build_concepts_index(concepts: dict, companies: dict) -> str:
    cards = []
    for concept in concepts.values():
        company_names = [company["name"] for company in companies.values() if concept["id"] in company.get("related_concepts", [])]
        cards.append(
            f"""
            <article class="list-card">
              <h3><a href="{escape(concept['id'])}/index.html">{escape(concept['name'])}</a></h3>
              <p>{escape(concept['summary'])}</p>
              <ul>{''.join(f'<li>{escape(name)}</li>' for name in company_names[:4])}</ul>
            </article>
            """
        )
    return (
        hero(
            "概念索引",
            "概念页负责把抽象词汇重新锚回具体案例，而不是停留在定义层面。",
            eyebrow="Concepts",
            pills=["Case-linked ideas"],
        )
        + section("核心概念", f'<div class="list-grid">{"".join(cards)}</div>')
    )


def build_concept_page(page_path: Path, concept: dict, companies: dict) -> str:
    company_cards = []
    for company in companies.values():
        if concept["id"] not in company.get("related_concepts", []):
            continue
        company_cards.append(
            card(
                company["name"],
                company["summary"],
                href=rel_href(page_path, f"/companies/{company['id']}/index.html"),
            )
        )
    return (
        hero(
            concept["name"],
            concept["summary"],
            eyebrow="Concept",
        )
        + section("能体现这个概念的公司", f'<div class="cards">{"".join(company_cards)}</div>')
    )


def build_letters_index(letter_files: list[str]) -> str:
    by_decade = defaultdict(list)
    for filename in letter_files:
        year = int(filename[:4])
        by_decade[(year // 10) * 10].append(filename)

    groups = []
    for decade in sorted(by_decade):
        cards = []
        for filename in by_decade[decade]:
            year = filename[:4]
            cards.append(
                f'<a class="tag" href="../pdfs/{escape(filename)}">{escape(year)} 股东信 PDF</a>'
            )
        groups.append(
            f'<section class="panel"><h3>{decade}s</h3><div class="tag-row">{"".join(cards)}</div></section>'
        )

    return (
        hero(
            "历年股东信",
            "这里保留 1977-2024 年的原始 PDF，案例页里的证据链接会直接跳回这些原文。",
            eyebrow="Letters",
            pills=["Primary sources", "PDF archive"],
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

    companies = load_collection(DATA / "companies")
    cases = load_collection(DATA / "cases")
    people = load_collection(DATA / "people")
    concepts = load_collection(DATA / "concepts")

    write_page(
        "index.html",
        title="巴菲特投资案例库",
        description="Fork 索引层，重做 Deep Dive 层的巴菲特投资案例研究站。",
        active="home",
        body=build_home(companies, cases, people, concepts, letter_files),
    )
    write_page(
        "companies/index.html",
        title="公司索引",
        description="巴菲特投资案例库的公司索引。",
        active="companies",
        body=build_companies_index(companies, cases, people, concepts),
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
        description="巴菲特投资案例库的案例索引。",
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
        description="关键人物与相关案例。",
        active="people",
        body=build_people_index(people, companies, cases),
    )
    for person in people.values():
        write_page(
            f"people/{person['id']}/index.html",
            title=f"{person['name']} · 人物页",
            description=person["summary"],
            active="people",
            body=build_person_page(DIST / f"people/{person['id']}/index.html", person, companies, cases),
        )

    write_page(
        "concepts/index.html",
        title="概念索引",
        description="把概念重新锚回案例。",
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
