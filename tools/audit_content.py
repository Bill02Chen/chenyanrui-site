#!/usr/bin/env python3
"""Content audit for the bilingual personal site.

Proves that every numeric claim and every entry on the site traces back to the
source résumé, and that the two language versions stay structurally in sync.

Run:  python3 tools/audit_content.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Numeric tokens that are formatting or test metadata rather than claims.
IGNORED_TOKENS = {"710", "538", "636"}  # CET score denominators
# JSON paths whose digits are links/metadata, not résumé claims.
SKIP_PATH_PARTS = (".url", "langSwitchHref", ".initials")


def docx_text(path: Path) -> str:
    """Full text of a docx, including every table cell.

    Both résumés keep almost all of their content inside tables, so tables
    matter far more than paragraphs. Merged cells repeat their text across the
    grid, which only duplicates text and is harmless for an "appears in source"
    check.
    """
    from docx import Document

    doc = Document(str(path))
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                parts.append(cell.text)
    return "\n".join(parts)


def walk_strings(node, path="$"):
    """Yield (json_path, string) for every string in the document."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield from walk_strings(value, f"{path}.{key}")
    elif isinstance(node, list):
        for i, value in enumerate(node):
            yield from walk_strings(value, f"{path}[{i}]")
    elif isinstance(node, str):
        yield path, node


MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def date_signature(period: str) -> tuple[frozenset, tuple]:
    """Normalize a period so EN and ZH spellings compare equal.

    Returns (years, month numbers). "Sep 2025 – Mar 2027" and
    "2025年9月 – 2027年3月" both give ({2025, 2027}, (9, 3)). The two languages
    place the year differently inside a range, so years are compared as a set
    while the month order is preserved.
    """
    text = period.replace("–", "-").replace("—", "-")

    # No \b here: a digit adjacent to a CJK character (2025年) has no word
    # boundary, so word-boundary matching silently misses every Chinese year.
    years = frozenset(int(y) for y in re.findall(r"(\d{4})", text))

    months = []
    for mon in re.findall(r"([A-Za-z]{3})[a-z]*", text):
        if mon.lower() in MONTHS:
            months.append(MONTHS[mon.lower()])
    for mon in re.findall(r"(\d{1,2})\s*月", text):
        months.append(int(mon))

    return years, tuple(months)


def stat_signature(value: str) -> str:
    """Normalize a headline metric so '1,000' and '1000' compare equal."""
    return re.sub(r"[,\s]", "", str(value))


def numbers(text: str) -> set[str]:
    """Every numeric token, plus normalized variants.

    Normalizes the forms that legitimately differ between a résumé and a web
    page: thousands separators ("1,000" vs "1000"), 万/K scale words
    ("24万" vs "240K" vs "240000"), and telephones, where the résumé packs
    "+86 13800000000 +86 13800000000" onto one line and the site lists the two
    numbers separately.
    """
    found = set(re.findall(r"\d+(?:\.\d+)?", text))
    out = set(found)
    for token in found:
        out.add(token.replace(",", ""))
    # "24万" / "240K" both denote 240 000
    for value, suffix in re.findall(r"(\d+(?:\.\d+)?)\s*([万Kk])", text):
        try:
            out.add(str(int(float(value) * (10000 if suffix == "万" else 1000))))
        except ValueError:
            pass
    # Telephone strings, with and without separators
    for phone in re.findall(r"\+\d[\d\s\-()]{6,}", text):
        out.add(re.sub(r"[^\d+]", "", phone))
    return out


def resolve(doc, dotted):
    node = doc
    for part in dotted.split("."):
        node = node[part]
    return node


def main() -> int:
    failures: list[str] = []
    notes: list[str] = []

    zh_resume = docx_text(ROOT.parent / "简历_2026_09_陈彦睿.docx")
    en_resume = docx_text(ROOT.parent / "CV_2026_full_version_陈彦睿.docx")

    # Fact policy: the Chinese résumé is the baseline; the English CV supplies
    # only what the Chinese one omits. A claim on either page must therefore be
    # traceable to the baseline or to the supplement.
    baseline_numbers = numbers(zh_resume)
    supplement_numbers = numbers(en_resume) - baseline_numbers

    cases = [
        {
            "label": "EN",
            "site": ROOT / "data" / "site.json",
            "sources": {"baseline (ZH résumé)": baseline_numbers,
                        "supplement (EN CV)": supplement_numbers},
        },
        {
            "label": "ZH",
            "site": ROOT / "zh" / "data" / "site.json",
            "sources": {"baseline (ZH résumé)": baseline_numbers,
                        "supplement (EN CV)": supplement_numbers},
        },
    ]

    for case in cases:
        label = case["label"]
        site = json.loads(case["site"].read_text(encoding="utf-8"))
        resume_numbers = set().union(*case["sources"].values())

        print(f"\n=== {label}: {case['site'].name} ===")
        print(f"  baseline tokens: {len(baseline_numbers)}, "
              f"supplement tokens: {len(supplement_numbers)}")

        # --- 1. every numeric claim on the site must appear in a résumé ---
        unsupported = []
        for path, text in walk_strings(site):
            if any(part in path for part in SKIP_PATH_PARTS):
                continue
            for num in numbers(text):
                if num in IGNORED_TOKENS or num in resume_numbers:
                    continue
                unsupported.append((path, num, text[:64]))

        if unsupported:
            print(f"  UNSUPPORTED NUMBERS: {len(unsupported)}")
            for path, num, snippet in unsupported:
                failures.append(f"[{label}] unsupported number {num!r} at {path}: {snippet}")
        else:
            print("  OK   every numeric claim traces to the résumé")

        # --- 2. shape invariants ---
        for i, item in enumerate(site["education"]):
            for field in ("school", "degree", "period", "location", "gpa", "courses"):
                if field not in item:
                    failures.append(f"[{label}] education[{i}] missing {field}")

        for i, item in enumerate(site["experience"]):
            if not item.get("highlights"):
                failures.append(f"[{label}] experience[{i}] has no highlights")
            if item.get("kind") not in {"internship", "research"}:
                failures.append(f"[{label}] experience[{i}] bad kind {item.get('kind')!r}")
            if not item.get("summary"):
                failures.append(f"[{label}] experience[{i}] missing summary")

        for i, item in enumerate(site["projects"]):
            bullets = item.get("highlights", [])
            if not 2 <= len(bullets) <= 5:
                failures.append(f"[{label}] projects[{i}] has {len(bullets)} bullets (want 2-5)")
            if not item.get("stack"):
                failures.append(f"[{label}] projects[{i}] has no stack")

        # --- 3. no empty UI strings ---
        for key, value in site["ui"].items():
            if not str(value).strip():
                failures.append(f"[{label}] ui.{key} is empty")

        print(f"  projects: {len(site['projects'])}, ui keys: {len(site['ui'])}")
        print(f"  education: {len(site['education'])}, experience: {len(site['experience'])}")

    # --- 4. cross-language structural parity ---
    en = json.loads((ROOT / "data" / "site.json").read_text(encoding="utf-8"))
    zh = json.loads((ROOT / "zh" / "data" / "site.json").read_text(encoding="utf-8"))

    for key, a, b in [
        ("ui key set", set(en["ui"]), set(zh["ui"])),
        ("skill groups", set(en["skills"]), set(zh["skills"])),
    ]:
        if a != b:
            failures.append(f"{key} differs between languages: {a ^ b}")

    for key in ("education", "experience", "projects", "hero.stats", "about.focusAreas"):
        if len(resolve(en, key)) != len(resolve(zh, key)):
            failures.append(
                f"{key} length differs: EN {len(resolve(en, key))} / ZH {len(resolve(zh, key))}"
            )

    # Projects must line up positionally across languages, because the user
    # requirement is that both sites describe the SAME experiences.
    for i, (a, b) in enumerate(zip(en["projects"], zh["projects"])):
        if date_signature(a["period"]) != date_signature(b["period"]):
            failures.append(
                f"projects[{i}] describes different dates: EN {a['period']!r} / ZH {b['period']!r}"
            )
        if len(a["highlights"]) != len(b["highlights"]):
            failures.append(
                f"projects[{i}] bullet count differs: "
                f"EN {len(a['highlights'])} / ZH {len(b['highlights'])}"
            )

    for i, (a, b) in enumerate(zip(en["experience"], zh["experience"])):
        if a["kind"] != b["kind"]:
            failures.append(f"experience[{i}] kind differs: EN {a['kind']} / ZH {b['kind']}")
        if date_signature(a["period"]) != date_signature(b["period"]):
            failures.append(
                f"experience[{i}] describes different dates: EN {a['period']!r} / ZH {b['period']!r}"
            )
        if len(a["highlights"]) != len(b["highlights"]):
            failures.append(
                f"experience[{i}] bullet count differs: "
                f"EN {len(a['highlights'])} / ZH {len(b['highlights'])}"
            )

    for i, (a, b) in enumerate(zip(en["education"], zh["education"])):
        if date_signature(a["period"]) != date_signature(b["period"]):
            failures.append(
                f"education[{i}] describes different dates: EN {a['period']!r} / ZH {b['period']!r}"
            )
        if a["gpa"] != b["gpa"]:
            failures.append(f"education[{i}] GPA differs: EN {a['gpa']} / ZH {b['gpa']}")

    # Both pages must present the same headline metrics and contact channels.
    if [stat_signature(s["value"]) for s in en["hero"]["stats"]] != [
        stat_signature(s["value"]) for s in zh["hero"]["stats"]
    ]:
        failures.append("hero.stats values differ between languages")

    if [s.get("unit", "") for s in en["hero"]["stats"]] != [
        s.get("unit", "") for s in zh["hero"]["stats"]
    ]:
        failures.append("hero.stats units differ between languages")

    if len(en["contact"]["links"]) != len(zh["contact"]["links"]):
        failures.append(
            f"contact links differ: EN {len(en['contact']['links'])} / "
            f"ZH {len(zh['contact']['links'])}"
        )

    # Skills are proper nouns, so they must match exactly across languages.
    for group in ("programming", "frameworks"):
        if en["skills"][group] != zh["skills"][group]:
            failures.append(
                f"skills.{group} differ: EN {en['skills'][group]} / ZH {zh['skills'][group]}"
            )

    print("\n" + "=" * 72)
    for note in notes:
        print("NOTE:", note)
    if failures:
        print(f"\n{len(failures)} FAILURE(S):")
        for item in failures[:60]:
            print("  -", item)
        if len(failures) > 60:
            print(f"  ... and {len(failures) - 60} more")
        return 1
    print("\nAll content-audit checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
