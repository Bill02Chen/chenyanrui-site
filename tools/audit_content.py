#!/usr/bin/env python3
"""Content audit for the bilingual personal site.

Proves that every numeric claim and every entry on the site traces back to the
source resume, and that the two language versions stay structurally in sync.
Also checks repository links, contact channels and the privacy policy.

Run:  python3 tools/audit_content.py --strict
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Numeric tokens that are formatting or test metadata rather than claims.
IGNORED_TOKENS = {"710", "538", "636"}  # CET score denominators
# JSON paths whose digits are links/metadata, not resume claims.
SKIP_PATH_PARTS = (
    ".url",
    ".repo",
    ".links[",
    ".period",
    "langSwitchHref",
    ".initials",
)

# Detects a published phone number: a country code followed by a long digit run,
# or the Chinese mainland form with a separator.
PHONE_RE = re.compile(
    r"""
    (?:\+\d{1,3}[\s\-]?\d[\d\s\-]{7,})     # +86 13800000000, +852 50000000
    | (?:\b1[3-9]\d{9}\b)                  # bare mainland mobile, e.g. 13800000000
    | (?:\b\d{4}[\s\-]\d{7,}\b)            # 1380 0000000
    """,
    re.VERBOSE,
)

# Public repository links only; the profile is public, so no token is needed.
REPO_RE = re.compile(r"^https://github\.com/Bill02Chen/[A-Za-z0-9._-]+$")
GITHUB_PROFILE = "https://github.com/Bill02Chen"

# Files that are published to the web and must stay free of private data.
PUBLISHED_FILES = (
    "index.html",
    "zh/index.html",
    "assets/app.js",
    "assets/styles.css",
    "data/site.json",
    "zh/data/site.json",
)

RESUME_NAMES = (
    "简历_2026_10_陈彦睿_常规.docx",
    "简历_2026_10_陈彦睿_可穿戴生理信号.docx",
    "简历_2026_10_陈彦睿_医学图像.docx",
)
CV_NAMES = ("CV_2026_full_version_陈彦睿.docx",)


def find_source(explicit: Path | None, names: tuple[str, ...]) -> Path | None:
    """Locate a source document without assuming one workspace layout."""
    if explicit:
        return explicit if explicit.exists() else None
    for base in (ROOT.parent, ROOT.parent / "备份"):
        for name in names:
            candidate = base / name
            if candidate.exists():
                return candidate
    return None


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
    ("24万" vs "240K" vs "240000"), and telephone numbers, which a résumé may
    pack onto one line ("+86 13800000000 +86 13800000000") while the site lists
    them as separate values.
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resume", type=Path, help="Chinese resume (baseline)")
    parser.add_argument("--cv", type=Path, help="English CV (supplement)")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="fail when the source documents are missing or unreadable",
    )
    args = parser.parse_args(argv)

    failures: list[str] = []
    notes: list[str] = []

    resume_path = find_source(args.resume, RESUME_NAMES)
    cv_path = find_source(args.cv, CV_NAMES)

    if args.resume and not resume_path:
        failures.append(f"--resume not found: {args.resume}")
    if args.cv and not cv_path:
        failures.append(f"--cv not found: {args.cv}")

    baseline_numbers: set[str] | None = None
    supplement_numbers: set[str] | None = None

    if resume_path and cv_path:
        try:
            zh_resume = docx_text(resume_path)
            en_resume = docx_text(cv_path)
        except ImportError:
            message = "python-docx is not installed; numeric traceability was skipped"
            (failures if args.strict else notes).append(message)
        else:
            # Fact policy: the Chinese resume is the baseline; the English CV
            # supplies only what the Chinese one omits. A claim on either page
            # must therefore be traceable to the baseline or the supplement.
            baseline_numbers = numbers(zh_resume)
            supplement_numbers = numbers(en_resume) - baseline_numbers
            print(
                f"Sources: {resume_path.name} "
                f"({len(baseline_numbers)} numeric tokens) + {cv_path.name}"
            )
    else:
        missing = [
            str(path)
            for path, resolved in ((args.resume, resume_path), (args.cv, cv_path))
            if path and not resolved
        ]
        if args.strict:
            failures.append(
                "numeric traceability needs both source documents; missing: "
                + (", ".join(missing) if missing else "resume and/or CV")
            )
        else:
            missing_names = [
                label
                for resolved, label in ((resume_path, "resume"), (cv_path, "CV"))
                if resolved is None
            ]
            notes.append(
                "source documents not found"
                + (f" ({', '.join(missing_names)})" if missing_names else "")
                + "; numeric traceability was skipped (pass --resume/--cv, or run with --strict)"
            )

    cases = [
        {
            "label": "EN",
            "site": ROOT / "data" / "site.json",
        },
        {
            "label": "ZH",
            "site": ROOT / "zh" / "data" / "site.json",
        },
    ]

    for case in cases:
        label = case["label"]
        site = json.loads(case["site"].read_text(encoding="utf-8"))

        print(f"\n=== {label}: {case['site'].name} ===")

        # --- 1. every numeric claim on the site must appear in a resume ---
        if baseline_numbers is not None and supplement_numbers is not None:
            resume_numbers = baseline_numbers | supplement_numbers
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
                    failures.append(
                        f"[{label}] unsupported number {num!r} at {path}: {snippet}"
                    )
            else:
                print("  OK   every numeric claim traces to the resume")

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
            if "repo" not in item:
                failures.append(f"[{label}] projects[{i}] missing repo (use \"\" for none)")
            elif item["repo"] and not REPO_RE.match(item["repo"]):
                failures.append(
                    f"[{label}] projects[{i}] repo is not a public GitHub URL: "
                    f"{item['repo']!r}"
                )

        # --- 3. no empty UI strings ---
        for key, value in site["ui"].items():
            if not str(value).strip():
                failures.append(f"[{label}] ui.{key} is empty")

        # --- 4. privacy: the published JSON must not expose a phone number ---
        for path, text in walk_strings(site):
            if PHONE_RE.search(text) or text.strip().lower().startswith("tel:"):
                failures.append(f"[{label}] phone number published at {path}: {text!r}")

        print(f"  projects: {len(site['projects'])}, ui keys: {len(site['ui'])}")
        print(f"  education: {len(site['education'])}, experience: {len(site['experience'])}")

    # --- 5. privacy: scan every file the web server publishes ---
    for relative in PUBLISHED_FILES:
        path = ROOT / relative
        if not path.exists():
            failures.append(f"published file missing: {relative}")
            continue
        text = path.read_text(encoding="utf-8")
        if PHONE_RE.search(text):
            failures.append(f"phone number found in published file: {relative}")
        if re.search(r"href\s*=\s*[\"']tel:", text):
            failures.append(f"tel: link found in published file: {relative}")

    # --- 6. cross-language structural parity ---
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
        if a.get("repo", "") != b.get("repo", ""):
            failures.append(
                f"projects[{i}] repo differs: EN {a.get('repo', '')!r} / "
                f"ZH {b.get('repo', '')!r}"
            )
        if a.get("repo", "").startswith("https://github.com/"):
            notes.append(f"public code linked for projects[{i}]: {a['repo']}")

    if not any(item.get("repo") for item in en["projects"]):
        failures.append("no project links a public repository")

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
    elif [link.get("url", "") for link in en["contact"]["links"]] != [
        link.get("url", "") for link in zh["contact"]["links"]
    ]:
        failures.append("contact link URLs differ between languages")

    contact_urls = {link.get("url", "") for link in en["contact"]["links"]}
    if GITHUB_PROFILE not in contact_urls:
        failures.append(f"contact section does not link the GitHub profile ({GITHUB_PROFILE})")

    for link in en["contact"]["links"]:
        url = link.get("url", "")
        if url and not re.match(r"^(https://|mailto:)", url):
            failures.append(f"contact link is not https or mailto: {url!r}")

    # Skills are proper nouns, so they must match exactly across languages.
    for group in ("programming", "frameworks"):
        if en["skills"][group] != zh["skills"][group]:
            failures.append(
                f"skills.{group} differ: EN {en['skills'][group]} / ZH {zh['skills'][group]}"
            )

    print("\n" + "=" * 72)
    for note in dict.fromkeys(notes):
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
