#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "movie_list.txt"
OUT_CLEAN = ROOT / "movies_clean.txt"
OUT_JSON = ROOT / "movies.json"
OUT_JS = ROOT / "movies.js"

ENTRY_RE = re.compile(r"^(\d+)\.\s+(.*)")
INFO_RE = re.compile(r"^(\d{4})(\d+h(?: \d+m)?|\d+m)")
VOTES_RE = re.compile(r"\(([^)]+)\)")


def next_non_empty(lines: list[str], start: int) -> int | None:
    idx = start
    while idx < len(lines) and not lines[idx].strip():
        idx += 1
    return idx if idx < len(lines) else None


def parse_entries(lines: list[str]) -> list[dict]:
    entries: list[dict] = []
    errors: list[str] = []
    i = 0

    while i < len(lines):
        line = lines[i].strip()
        match = ENTRY_RE.match(line)
        if not match:
            i += 1
            continue

        movie_id = int(match.group(1))
        title = match.group(2).strip()

        info_idx = next_non_empty(lines, i + 1)
        rating_idx = next_non_empty(lines, (info_idx or 0) + 1)
        votes_idx = next_non_empty(lines, (rating_idx or 0) + 1)

        if info_idx is None or rating_idx is None or votes_idx is None:
            errors.append(f"Movie {movie_id}: missing info/rating/votes line")
            i += 1
            continue

        info_line = lines[info_idx].strip()
        rating_line = lines[rating_idx].strip()
        votes_line = lines[votes_idx].strip()

        info_match = INFO_RE.match(info_line)
        if not info_match:
            errors.append(f"Movie {movie_id}: info format mismatch -> {info_line!r}")
            i = votes_idx + 1
            continue

        year = int(info_match.group(1))
        runtime = info_match.group(2).strip()
        remainder = info_line[info_match.end():].strip()
        metascore = None
        certificate = None

        if "Metascore" in remainder:
            before_meta = remainder.split("Metascore", 1)[0]
            score_match = re.search(r"(\d+)$", before_meta)
            if score_match:
                digits = score_match.group(1)
                prefix = before_meta[: score_match.start()]
                cert_digits = ""
                if len(digits) >= 3 and digits.endswith("100"):
                    metascore = 100
                    cert_digits = digits[:-3]
                elif len(digits) >= 2:
                    metascore = int(digits[-2:])
                    cert_digits = digits[:-2]
                else:
                    metascore = int(digits)
                certificate = (prefix + cert_digits).strip() or None
            else:
                certificate = before_meta.strip() or None
        else:
            certificate = remainder.strip() or None

        try:
            imdb_rating = float(rating_line)
        except ValueError:
            errors.append(f"Movie {movie_id}: rating format mismatch -> {rating_line!r}")
            i = votes_idx + 1
            continue

        votes_match = VOTES_RE.search(votes_line)
        if not votes_match:
            errors.append(f"Movie {movie_id}: votes format mismatch -> {votes_line!r}")
            i = votes_idx + 1
            continue

        votes = votes_match.group(1).strip()

        entries.append(
            {
                "id": movie_id,
                "title": title,
                "year": year,
                "runtime": runtime,
                "certificate": certificate,
                "metascore": metascore,
                "imdb_rating": imdb_rating,
                "votes": votes,
            }
        )

        i = votes_idx + 1

    if errors:
        raise ValueError("Parsing errors:\n- " + "\n- ".join(errors[:10]))

    return entries


def validate_entries(entries: list[dict]) -> None:
    if not entries:
        raise ValueError("No entries parsed from movie_list.txt")

    ids = [entry["id"] for entry in entries]
    max_id = max(ids)
    missing = sorted(set(range(1, max_id + 1)) - set(ids))

    if missing:
        raise ValueError(f"Missing movie ids: {missing[:10]}")

    if len(entries) != max_id:
        raise ValueError(
            f"Entry count mismatch: parsed={len(entries)}, max_id={max_id}"
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
        "// Auto-generated by scripts/build_data.py. Do not edit manually.\n"
        f"window.MOVIES = {payload};\n"
    )
    OUT_JS.write_text(content, encoding="utf-8")


def main() -> int:
    if not SOURCE.exists():
        print(f"Missing {SOURCE}", file=sys.stderr)
        return 1

    lines = SOURCE.read_text(encoding="utf-8", errors="replace").splitlines()
    entries = parse_entries(lines)
    validate_entries(entries)

    write_clean_txt(entries)
    write_json(entries)
    write_js(entries)

    print(f"Parsed {len(entries)} movies.")
    print(f"Wrote: {OUT_CLEAN.name}, {OUT_JSON.name}, {OUT_JS.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
