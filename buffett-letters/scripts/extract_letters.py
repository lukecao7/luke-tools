#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError as exc:
    raise SystemExit(
        "Missing dependency: pypdf. Run `python3 -m pip install -r requirements.txt` first."
    ) from exc


PDF_PATTERN = re.compile(r"(?P<year>\d{4})ltr\.pdf$")


def normalize_text(text: str) -> str:
    text = text.replace("\u00a0", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract Berkshire letter PDFs into per-page JSON and full-text TXT files."
    )
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=Path("."),
        help="Directory containing files like 1988ltr.pdf",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("output/letters"),
        help="Directory for extracted JSON/TXT files",
    )
    parser.add_argument(
        "--years",
        nargs="*",
        help="Optional list of years to extract, for example: --years 1988 1989 2022",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing extracted files",
    )
    return parser.parse_args()


def selected_pdfs(source_dir: Path, years: set[str] | None) -> list[Path]:
    pdfs = []
    for path in sorted(source_dir.glob("*ltr.pdf")):
        match = PDF_PATTERN.fullmatch(path.name)
        if not match:
            continue
        year = match.group("year")
        if years and year not in years:
            continue
        pdfs.append(path)
    return pdfs


def extract_pdf(path: Path) -> dict:
    reader = PdfReader(str(path))
    pages = []
    full_text_blocks = []

    for page_index, page in enumerate(reader.pages, start=1):
        text = normalize_text(page.extract_text() or "")
        pages.append(
            {
                "page": page_index,
                "char_count": len(text),
                "text": text,
            }
        )
        full_text_blocks.append(f"[[page {page_index}]]\n{text}")

    return {
        "year": int(path.name[:4]),
        "source_file": path.name,
        "source_path": str(path.resolve()),
        "page_count": len(pages),
        "pages": pages,
        "full_text": "\n\n".join(full_text_blocks).strip(),
    }


def main() -> int:
    args = parse_args()
    years = set(args.years) if args.years else None
    pdfs = selected_pdfs(args.source_dir, years)

    if not pdfs:
        print("No matching PDFs found.", file=sys.stderr)
        return 1

    args.output_dir.mkdir(parents=True, exist_ok=True)
    processed = 0

    for pdf_path in pdfs:
        year = pdf_path.name[:4]
        json_path = args.output_dir / f"{year}.json"
        txt_path = args.output_dir / f"{year}.txt"

        if not args.overwrite and json_path.exists() and txt_path.exists():
            print(f"skip {pdf_path.name} (already extracted)")
            continue

        payload = extract_pdf(pdf_path)
        json_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        txt_path.write_text(payload["full_text"] + "\n", encoding="utf-8")
        processed += 1
        print(
            f"ok {pdf_path.name} -> {json_path} ({payload['page_count']} pages)"
        )

    print(f"done: {processed} file(s) written to {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
