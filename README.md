# Random Movie Generator

This app picks a random movie from the parsed list, saves shared picks in
Supabase, and prevents repeats globally until you clear the history.

## Run

Option 1 (recommended):

```
make run
```

Option 2 (manual):

```
python3 scripts/build_data.py
open index.html
```

You can also double click `index.html` after running the build step.
If the browser blocks Supabase requests from `file://`, run a local server:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Data

The build script parses `movie_list.txt` and creates:

- `movies_clean.txt` (tab-separated, easy to read)
- `movies.json` (structured data)
- `movies.js` (browser-friendly data for the UI)

History and selected movies are stored in Supabase (global across visitors),
and can be cleared with the "Clear history" button.

## Supabase Setup (required for shared picks)

1. Open the Supabase SQL editor for your project.
2. Run the SQL in `supabase.sql` to create the `picks` table and policies.
3. If you use a different project, update `SUPABASE_URL` and
   `SUPABASE_ANON_KEY` in `app.js`.

If you see CORS errors after deployment, add your site URL in
Supabase -> Settings -> API -> Additional Allowed Origins.

## GitHub Pages

After pushing to GitHub, enable Pages:

Repo Settings -> Pages -> Deploy from branch -> `main` / `/`.
