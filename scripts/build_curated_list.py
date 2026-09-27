#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "original_prompt.txt"
OUT_CLEAN = ROOT / "movies_curated_final_clean.txt"
OUT_JSON = ROOT / "movies_curated_final.json"
OUT_JS = ROOT / "movies_curated_final.js"
OUT_EXCLUDED_JSON = ROOT / "excluded_movies_curated.json"
OUT_EXCLUDED_JS = ROOT / "excluded_movies_curated.js"
REVIEW = ROOT / "exclusion_review.json"

ANIMATION_MARKER = "and thesea re the animation  movies im thinking not to include from above"
ENTRY_RE = re.compile(r"^(\d+)\.\s+(.*)")
YEAR_RE = re.compile(r"^\d{4}$")
RUNTIME_RE = re.compile(r"^(?:\d+h(?: \d+m)?|\d+m)$")
RATING_RE = re.compile(r"^\d\.\d$")
VOTES_RE = re.compile(r"^\(([^)]+)\)$")

CATEGORY_META = [
    ("male_gay", "Male Gay / Gender-Related"),
    ("non_live_action", "Non-Live Action / Special Format"),
    ("animation", "Animation / Hybrid / Family Animation"),
    ("horror", "Horror"),
    ("abuse_victimization", "Abuse / Victimization"),
    ("children", "Children / Family"),
    ("other", "Other Custom Flags"),
]


def movie_key(title: str, year: int) -> str:
    return f"{title} ({year})"


RESTORE = {
    movie_key("Avatar", 2009),
    movie_key("Avatar: The Way of Water", 2022),
    movie_key("Avatar: Fire and Ash", 2025),
    movie_key("Who Framed Roger Rabbit", 1988),
    movie_key("Sin City: A Dame to Kill For", 2014),
}

ADDITIONAL_EXCLUDE = {
    movie_key("Team America: World Police", 2004),
    movie_key("The Dark Crystal", 1982),
    movie_key("Hamilton", 2020),
    movie_key("Homeward Bound: The Incredible Journey", 1993),
    movie_key("Rocketry: The Nambi Effect", 2022),
    movie_key("Space Jam", 1996),
}

LGBT_EXCLUDE = {
    movie_key("The Adventures of Priscilla, Queen of the Desert", 1994),
    movie_key("The Birdcage", 1996),
    movie_key("Love, Simon", 2018),
    movie_key("Red, White & Royal Blue", 2023),
    movie_key("Brokeback Mountain", 2005),
    movie_key("Milk", 2008),
    movie_key("Moonlight", 2016),
    movie_key("Call Me by Your Name", 2017),
    movie_key("A Single Man", 2009),
    movie_key("My Own Private Idaho", 1991),
    movie_key("I Love You Phillip Morris", 2009),
    movie_key("Boys Don't Cry", 1999),
    movie_key("The Danish Girl", 2015),
    movie_key("All of Us Strangers", 2023),
    movie_key("Pride", 2014),
    movie_key("Cabaret", 1972),
    movie_key("The Rocky Horror Picture Show", 1975),
}


def split_source(lines: list[str]) -> tuple[list[str], list[str]]:
    try:
        marker_idx = next(i for i, line in enumerate(lines) if ANIMATION_MARKER in line)
    except StopIteration as exc:
        raise ValueError("Could not find animation section marker in original_prompt.txt") from exc
    return lines[:marker_idx], lines[marker_idx:]


def next_non_empty(lines: list[str], start: int) -> int | None:
    idx = start
    while idx < len(lines) and not lines[idx].strip():
        idx += 1
    return idx if idx < len(lines) else None


def is_entry_start(lines: list[str], idx: int) -> bool:
    match = ENTRY_RE.match(lines[idx].strip())
    if not match:
        return False

    year_idx = next_non_empty(lines, idx + 1)
    runtime_idx = next_non_empty(lines, (year_idx or 0) + 1)
    if year_idx is None or runtime_idx is None:
        return False

    year_line = lines[year_idx].strip()
    runtime_line = lines[runtime_idx].strip()
    return bool(YEAR_RE.match(year_line) and RUNTIME_RE.match(runtime_line))


def parse_prompt_entries(lines: list[str]) -> list[dict]:
    entries: list[dict] = []
    entry_starts = [
        idx for idx, _ in enumerate(lines) if is_entry_start(lines, idx)
    ]

    for pos, start_idx in enumerate(entry_starts):
        end_idx = entry_starts[pos + 1] if pos + 1 < len(entry_starts) else len(lines)
        block = lines[start_idx:end_idx]
        line = block[0].strip()
        match = ENTRY_RE.match(line)
        if not match:
            continue

        entry_id = int(match.group(1))
        title = match.group(2).strip()

        year_idx = next_non_empty(block, 1)
        runtime_idx = next_non_empty(block, (year_idx or 0) + 1)
        cert_or_rating_idx = next_non_empty(block, (runtime_idx or 0) + 1)

        if year_idx is None or runtime_idx is None or cert_or_rating_idx is None:
            raise ValueError(f"Incomplete entry for {title}")

        year_line = block[year_idx].strip()
        runtime_line = block[runtime_idx].strip()
        cert_or_rating_line = block[cert_or_rating_idx].strip()

        if not YEAR_RE.match(year_line):
            raise ValueError(f"Unexpected year line for {title}: {year_line!r}")
        if not RUNTIME_RE.match(runtime_line):
            raise ValueError(f"Unexpected runtime line for {title}: {runtime_line!r}")

        certificate = None
        if RATING_RE.match(cert_or_rating_line):
            rating_idx = cert_or_rating_idx
        else:
            certificate = cert_or_rating_line or None
            rating_idx = next_non_empty(block, cert_or_rating_idx + 1)
            if rating_idx is None:
                raise ValueError(f"Missing rating for {title}")

        votes_idx = next_non_empty(block, rating_idx + 1)
        if votes_idx is None:
            raise ValueError(f"Missing votes for {title}")

        rating_line = block[rating_idx].strip()
        votes_line = block[votes_idx].strip().replace("\xa0", "")

        if not RATING_RE.match(rating_line):
            raise ValueError(f"Unexpected rating line for {title}: {rating_line!r}")
        votes_match = VOTES_RE.match(votes_line)
        if not votes_match:
            raise ValueError(f"Unexpected votes line for {title}: {votes_line!r}")

        entries.append(
            {
                "id": entry_id,
                "title": title,
                "year": int(year_line),
                "runtime": runtime_line,
                "certificate": certificate,
                "metascore": None,
                "imdb_rating": float(rating_line),
                "votes": votes_match.group(1).strip(),
            }
        )

    return entries


def validate_entry_count(entries: list[dict], expected_count: int, label: str) -> None:
    if len(entries) != expected_count:
        raise ValueError(
            f"Expected {expected_count} {label} entries, parsed {len(entries)}"
        )


def write_clean_txt(entries: list[dict]) -> None:
    with OUT_CLEAN.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t")
        writer.writerow(
            [
                "id",
                "title",
                "year",
                "runtime",
                "certificate",
                "metascore",
                "imdb_rating",
                "votes",
            ]
        )
        for entry in entries:
            writer.writerow(
                [
                    entry["id"],
                    entry["title"],
                    entry["year"],
                    entry["runtime"],
                    entry["certificate"] or "",
                    entry["metascore"] if entry["metascore"] is not None else "",
                    entry["imdb_rating"],
                    entry["votes"],
                ]
            )


def write_json(entries: list[dict]) -> None:
    with OUT_JSON.open("w", encoding="utf-8") as handle:
        json.dump(entries, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def write_js(entries: list[dict]) -> None:
    payload = json.dumps(entries, ensure_ascii=False, separators=(",", ":"))
    content = (
        "// Auto-generated by scripts/build_curated_list.py. Do not edit manually.\n"
        f"window.MOVIES = {payload};\n"
    )
    OUT_JS.write_text(content, encoding="utf-8")


def build_excluded_payload(
    main_entries: list[dict], animation_entries: list[dict], curated: list[dict],
    reviewed: dict[int, dict],
) -> dict:
    curated_keys = {movie_key(entry["title"], entry["year"]) for entry in curated}
    main_by_key = {
        movie_key(entry["title"], entry["year"]): entry for entry in main_entries
    }
    animation_keys = {
        movie_key(entry["title"], entry["year"]): entry for entry in animation_entries
    }

    categorized: dict[str, list[dict]] = {
        "male_gay": [],
        "non_live_action": [],
        "animation": [],
        "horror": [],
        "abuse_victimization": [],
        "children": [],
        "other": [],
    }

    for key, entry in main_by_key.items():
        if key in curated_keys:
            continue
        if entry["id"] in reviewed:
            decision = reviewed[entry["id"]]
            categorized[decision["category"]].append({
                **entry, "exclusion_reason": decision["reason"],
                "review_date": "2026-09-26",
            })
        elif key in LGBT_EXCLUDE:
            categorized["male_gay"].append(entry)
        elif key in ADDITIONAL_EXCLUDE:
            categorized["non_live_action"].append(entry)
        elif key in animation_keys and key not in RESTORE:
            categorized["animation"].append(entry)
        else:
            categorized["other"].append(entry)

    categories = []
    for category_key, label in CATEGORY_META:
        items = sorted(categorized[category_key], key=lambda item: item["id"])
        categories.append(
            {
                "key": category_key,
                "label": label,
                "count": len(items),
                "movies": items,
            }
        )

    return {
        "source_total": len(main_entries),
        "curated_total": len(curated),
        "excluded_total": len(main_entries) - len(curated),
        "categories": categories,
    }


def write_excluded_json(payload: dict) -> None:
    with OUT_EXCLUDED_JSON.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def write_excluded_js(payload: dict) -> None:
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    content = (
        "// Auto-generated by scripts/build_curated_list.py. Do not edit manually.\n"
        f"window.EXCLUDED_MOVIES = {serialized};\n"
    )
    OUT_EXCLUDED_JS.write_text(content, encoding="utf-8")


def main() -> int:
    if not SOURCE.exists():
        print(f"Missing {SOURCE}", file=sys.stderr)
        return 1

    lines = SOURCE.read_text(encoding="utf-8", errors="replace").splitlines()
    main_lines, animation_lines = split_source(lines)

    main_entries = parse_prompt_entries(main_lines)
    animation_entries = parse_prompt_entries(animation_lines)
    validate_entry_count(main_entries, 2655, "main")
    validate_entry_count(animation_entries, 196, "animation")

    animation_exclude = {
        movie_key(entry["title"], entry["year"]) for entry in animation_entries
    }
    excluded = (animation_exclude - RESTORE) | ADDITIONAL_EXCLUDE | LGBT_EXCLUDE

    reviewed: dict[int, dict] = {}
    if REVIEW.exists():
        review = json.loads(REVIEW.read_text(encoding="utf-8"))
        by_id = {entry["id"]: entry for entry in main_entries}
        valid_categories = {key for key, _ in CATEGORY_META}
        for decision in review["decisions"]:
            entry = by_id.get(decision["id"])
            if (not entry or entry["title"] != decision["title"]
                    or entry["year"] != decision["year"]
                    or decision["category"] not in valid_categories
                    or decision["id"] in reviewed):
                raise ValueError(f"Invalid or duplicate exclusion review: {decision}")
            reviewed[entry["id"]] = decision
            excluded.add(movie_key(entry["title"], entry["year"]))

    curated = [
        entry
        for entry in main_entries
        if movie_key(entry["title"], entry["year"]) not in excluded
    ]
    excluded_payload = build_excluded_payload(main_entries, animation_entries, curated, reviewed)

    write_clean_txt(curated)
    write_json(curated)
    write_js(curated)
    write_excluded_json(excluded_payload)
    write_excluded_js(excluded_payload)

    print(f"Main source movies: {len(main_entries)}")
    print(f"Animation exclusions from source: {len(animation_entries)}")
    print(f"Curated final movies: {len(curated)}")
    print(
        "Files: "
        f"{OUT_CLEAN.name}, {OUT_JSON.name}, {OUT_JS.name}, "
        f"{OUT_EXCLUDED_JSON.name}, {OUT_EXCLUDED_JS.name}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
