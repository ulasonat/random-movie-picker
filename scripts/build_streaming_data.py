#!/usr/bin/env python3
"""Refresh positive subscription matches from JustWatch's public web catalogue.

No account, API key, or browser session is used. This is a dated snapshot, not a
claim of complete/live coverage. The public web endpoint is not a supported
partner API and may change; failures leave the previous snapshot untouched.
"""

import json
import re
import time
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = "https://apis.justwatch.com/graphql"
SERVICES = {
    "US": {
        "hbo-max": ("HBO Max", ["mxx"]),
        "netflix": ("Netflix", ["nfx"]),
        "prime-video": ("Prime Video", ["amp"]),
        "disney-plus": ("Disney+", ["dnp"]),
        "hulu": ("Hulu", ["hlu"]),
        "apple-tv": ("Apple TV", ["atp"]),
        "paramount-plus": ("Paramount+", ["ppp", "ppe"]),
        "peacock": ("Peacock", ["pct"]),
        "mubi": ("MUBI", ["mbi"]),
        "criterion": ("Criterion Channel", ["crc"]),
    },
    "TR": {
        "hbo-max": ("HBO Max", ["mxx"]),
        "netflix": ("Netflix", ["nfx"]),
        "prime-video": ("Prime Video", ["prv"]),
        "disney-plus": ("Disney+", ["dnp"]),
        "mubi": ("MUBI", ["mbi"]),
        "tv-plus": ("TV+", ["ttp"]),
        "tod": ("TOD", ["tdt"]),
        "tabii": ("tabii", ["tab"]),
        "exxen": ("Exxen", ["exn"]),
    },
}
QUERY = """
query FrameCatalogue($country: Country!, $filter: TitleFilter, $after: String) {
  popularTitles(country: $country, first: 100, after: $after,
                sortBy: POPULAR, filter: $filter) {
    totalCount
    pageInfo { hasNextPage endCursor }
    edges { node {
      id
      content(country: $country, language: en) {
        title originalTitle originalReleaseYear fullPath
      }
      english: content(country: US, language: en) { title }
      offers(country: $country, platform: WEB,
             filter: {monetizationTypes: [FLATRATE]}) {
        monetizationType package { shortName }
      }
    } }
  }
}
"""


def title_key(title, year):
    title = unicodedata.normalize("NFKD", title or "").casefold()
    title = "".join(c for c in title if not unicodedata.combining(c))
    return re.sub(r"[^\w]", "", title), year


def request(query, variables):
    body = json.dumps({"query": query, "variables": variables}).encode()
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                ENDPOINT, body, {"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=30) as response:
                payload = json.load(response)
            if payload.get("errors"):
                raise RuntimeError(json.dumps(payload["errors"]))
            return payload["data"]
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def catalogue(country, service, packages):
    after = None
    seen_cursors = set()
    expected = None
    fetched = 0
    while True:
        result = request(QUERY, {
            "country": country,
            "after": after,
            "filter": {
                "objectTypes": ["MOVIE"],
                "packages": packages,
                "monetizationTypes": ["FLATRATE"],
                # Curated source requires >=50k votes and rating >=6.5. Wider
                # floors reduce unrelated traffic; omissions stay unknown.
                "imdbVotes": {"min": 10000},
                "imdbScore": {"min": 6},
            },
        })["popularTitles"]
        if expected is None:
            expected = result["totalCount"]
        fetched += len(result["edges"])
        yield from (edge["node"] for edge in result["edges"])
        if not result["pageInfo"]["hasNextPage"]:
            if fetched < expected:
                raise RuntimeError(f"{country}/{service}: incomplete catalogue ({fetched}/{expected})")
            print(f"{country}/{service}: {fetched} catalogue titles", flush=True)
            break
        after = result["pageInfo"]["endCursor"]
        if not after or after in seen_cursors or not result["edges"]:
            raise RuntimeError(f"{country}/{service}: incomplete catalogue pagination")
        seen_cursors.add(after)
        time.sleep(0.12)


def build_region(country, index, by_id):
    services = SERVICES[country]
    package_to_service = {
        package: service
        for service, (_, packages) in services.items()
        for package in packages
    }
    known = request(
        "query Packages($country: Country!) { packages(country: $country, "
        "platform: WEB) { shortName clearName } }", {"country": country}
    )["packages"]
    missing = set(package_to_service) - {p["shortName"] for p in known}
    if missing:
        raise RuntimeError(f"{country}: provider codes changed: {missing}")
    matches = {}
    seen_titles = set()
    for service, (_, packages) in services.items():
        for film in catalogue(country, service, packages):
            seen_titles.add(film["id"])
            content = film["content"]
            titles = [content["title"], content.get("originalTitle"),
                      (film.get("english") or {}).get("title")]
            ids = set()
            for title in titles:
                ids.update(index.get(title_key(title, content["originalReleaseYear"]), []))
            if len(ids) != 1:
                continue  # Do not guess ambiguous titles or release years.
            providers = sorted({
                package_to_service[offer["package"]["shortName"]]
                for offer in film["offers"]
                if offer["monetizationType"] == "FLATRATE"
                and offer["package"]["shortName"] in package_to_service
            })
            path = content.get("fullPath", "")
            if not providers or not re.match(rf"^/{country.lower()}/(movie|film)/", path):
                continue
            movie_id = ids.pop()
            matches.setdefault(movie_id, {})[film["id"]] = {
                "title": by_id[movie_id]["title"],
                "year": by_id[movie_id]["year"],
                "providers": providers,
                "path": path,
                "sourceId": film["id"],
            }
    # Reject multiple source films with the same normalized title and year.
    movies = {str(k): next(iter(v.values())) for k, v in sorted(matches.items()) if len(v) == 1}
    if not movies:
        raise RuntimeError(f"{country}: no verified matches; keeping previous snapshot")
    return {
        "label": "United States" if country == "US" else "Turkey",
        "providers": [{"id": key, "name": name} for key, (name, _) in services.items()],
        "catalogueTitles": len(seen_titles),
        "movies": movies,
    }


def main():
    movies = json.loads((ROOT / "movies_curated_final.json").read_text())
    excluded = json.loads((ROOT / "excluded_movies_curated.json").read_text())
    for category in excluded["categories"]:
        movies.extend(category["movies"])
    index = {}
    for movie in movies:
        index.setdefault(title_key(movie["title"], movie["year"]), set()).add(movie["id"])
    by_id = {movie["id"]: movie for movie in movies}
    regions = {country: build_region(country, index, by_id) for country in SERVICES}
    data = {
        "version": 1,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "source": "JustWatch",
        "offerType": "subscription",
        "regions": regions,
    }
    output = ROOT / "streaming_data.js"
    temp = output.with_suffix(".js.tmp")
    temp.write_text(
        "/* Generated by scripts/build_streaming_data.py. Positive matches only. */\n"
        "(function (root) {\n  const data = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) +
        ";\n  if (typeof module === 'object' && module.exports) module.exports = data;\n"
        "  else root.STREAMING_DATA = data;\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n"
    )
    temp.replace(output)
    for country, region in regions.items():
        print(f"{country}: {len(region['movies'])} verified collection matches")


if __name__ == "__main__":
    main()
