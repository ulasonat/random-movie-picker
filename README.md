# Frame — your next great film

A movie picker with a curated collection, real film artwork, and a personal movie journal.

## Open online

[Open Frame](https://ulasonat.github.io/random-movie-picker/) — hosted on GitHub Pages. Share this URL with anyone; no sign-in or installation is needed.

Each browser has its own picks, exclusions, and watch history. The online site has a separate history from the original local file; it does not upload or sync that file's browser data.

GitHub Pages publishes the repository's `main` branch. The site is plain HTML, CSS, and JavaScript; `.nojekyll` keeps deployment independent of a site generator.

## Open in Chrome

```sh
make run
```

Or open `local.html` in Chrome. Everything needed to pick movies is already built; no server, dependency install, or API key is required. `index.html` redirects to the same local UI.

## Features

- Light and dark themes, with a toggle in the header. Frame follows the device theme until a choice is saved, and keeps that choice across visits and open tabs.
- Random picks with a 2.75-second poster reveal (blur to clear, then a slide into place), a reduced-motion option, and a Space shortcut.
- Era, runtime, IMDb rating, and certificate filters, plus four quick presets.
- Separate picked, saved, and watched lists. Picking a movie does **not** mark it watched.
- No repeated picks by default. Watched and excluded movies stay out of the random pool.
- A searchable exclusions library with category and source filters, sorting, pagination, individual/bulk restore, and undo. Original exclusions remain active until explicitly restored.
- Movie posters and descriptions hidden behind a Reveal description button, from the corresponding Wikipedia articles, with source links and a title-based fallback when artwork is unavailable.
- Trailer and IMDb searches, plus LimeTorrents title/year searches with 720p, 1080p (default), or 2160p. Search links open in a new tab; the app does not download movies.
- A JSON collection export from My movies.

## Local data and privacy

Picks and preferences stay in the current browser under `random-movie-generator:local:v4`. Existing v3, v2, or v1 history is imported on first use; the old storage is left intact. Existing legacy watched markers remain watched.

Keep opening the same `local.html` file to retain its browser storage. Moving it, changing browser profiles, or switching to an HTTP server can use a different storage area.

Artwork requests send the film title and year to Wikipedia; Google Fonts supplies the typefaces. Both are optional: the app uses local poster samples, title cards, and system fonts if offline. Artwork lookups are cached, limited to three concurrent requests, and never block picking a movie. Wikipedia excerpts and artwork sources are documented in `assets/README.md`.

## Files

- `local.html`, `styles.css`, `local_app.js`, `theme.js`: interface and browser behavior.
- `movie_core.js`: collection rules, filter matching, state migration, and search URL construction.
- `movies_curated_final.js`: the existing 2,206-film curated pool.
- `excluded_movies_curated.js`: the 449 source exclusions.
- `poster_seed.js`, `assets/`: four local poster examples and their article metadata.
- `app.js`, `supabase.sql`: legacy shared-picks implementation, not loaded by Frame.

The legacy `make build` target uses `movie_list.txt`. The curated-data builder uses the local `original_prompt.txt` source, which is not published in this repository. Normal use does not require rebuilding the data.

## Checks

Run `node --test tests/movie_core.test.cjs` for the collection, migration, filter, and URL tests. The interface was also exercised in isolated Chrome sessions at widths from 320 to 1440 pixels, including keyboard navigation, reduced motion, offline artwork fallback, restore/undo, and accessibility checks.

## Exclusion review

The 2026-09-26 review uses your narrow primary-theme criteria: 201 horror films, 19 abuse/victimization-focused films, and 84 primarily children’s films. The children’s count includes 69 titles that were already excluded under other categories. The active collection is 2,206 films. See `EXCLUSION_REVIEW.md` for decisions and retained boundary examples. `exclusion_review.json` is consumed by `scripts/build_curated_list.py`, so rebuilding retains this review.

Removing a movie from Picked returns it to eligibility unless it is also watched/excluded or fails the current filters; removing the currently displayed pick also resets the main card. The IMDb vote count comes from your saved source list, like the rating.

The Desktop and Dock `Frame.app` launcher opens the online site in Chrome. Use `make run` to open the original local file and its separate history.
