const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../movie_core.js");
const curated = require("../movies_curated_final.json");
const seed = require("../excluded_movies_curated.json");
const byId = new Map(curated.map((movie) => [movie.id, movie]));
const exclusions = new Map();
for (const category of seed.categories)
  for (const movie of category.movies) {
    byId.set(movie.id, movie);
    exclusions.set(movie.id, category.key);
  }
const movies = [...byId.values()];
const emptyState = () => C.normalizeState(null, byId);

test("builds the requested title-year-quality search and encodes punctuation", () => {
  assert.equal(
    C.torrentURL({ title: "Iron Man", year: 2008 }),
    "https://www.limetorrents.fun/search/all/iron-man-2008-1080p/",
  );
  assert.equal(
    C.torrentURL({ title: "Amélie: It's a Film!", year: 2001 }, "2160p"),
    "https://www.limetorrents.fun/search/all/amelie-its-a-film-2001-2160p/",
  );
  assert.equal(
    C.torrentURL({ title: "Iron Man", year: 2008 }, "invalid"),
    C.torrentURL({ title: "Iron Man", year: 2008 }),
  );
});

test("imports legacy watched history and exclusions without invalid or duplicate IDs", () => {
  const state = C.normalizeState(
    {
      history: [1, "1", 2, -1, 999999],
      currentId: 2,
      customExcluded: {
        1: { category: "horror" },
        999999: { category: "other" },
      },
    },
    byId,
  );
  assert.deepEqual(state.history, [1, 2]);
  assert.deepEqual(state.picks, [1, 2]);
  assert.equal(state.currentId, 2);
  assert.deepEqual(Object.keys(state.customExcluded), ["1"]);
  assert.equal(state.customExcluded[1].category, "horror");
});

test("keeps original exclusions and restores only explicitly restored titles", () => {
  const state = emptyState(),
    restored = [...exclusions.keys()][0];
  assert.equal(
    C.eligibleMovies(movies, state, exclusions).length,
    curated.length,
  );
  state.restored.push(restored);
  assert.equal(
    C.eligibleMovies(movies, state, exclusions).length,
    curated.length + 1,
  );
  state.customExcluded[restored] = { category: "other" };
  assert(
    !C.eligibleMovies(movies, state, exclusions).some(
      (movie) => movie.id === restored,
    ),
  );
});

test("picks, watched movies and exclusions stay separate; repeat mode still omits watched", () => {
  const state = emptyState();
  state.picks = [1];
  state.history = [2];
  state.customExcluded[3] = { category: "other" };
  let eligible = C.eligibleMovies(movies, state, exclusions);
  assert(!eligible.some((movie) => [1, 2, 3].includes(movie.id)));
  state.filters.hidePicked = false;
  eligible = C.eligibleMovies(movies, state, exclusions);
  assert(eligible.some((movie) => movie.id === 1));
  assert(!eligible.some((movie) => [2, 3].includes(movie.id)));
});

test("combines era, runtime, rating and certificate filters", () => {
  const state = emptyState();
  state.filters = {
    ...C.defaultFilters(),
    decade: "1990",
    runtime: "120",
    rating: "7",
    certificate: "R",
  };
  const eligible = C.eligibleMovies(movies, state, exclusions);
  assert(eligible.length > 0);
  assert(
    eligible.every(
      (movie) =>
        movie.year >= 1990 &&
        movie.year < 2000 &&
        C.minutes(movie.runtime) <= 120 &&
        movie.imdb_rating >= 7 &&
        movie.certificate === "R",
    ),
  );
  state.filters = { ...C.defaultFilters(), decade: "classic", runtime: "long" };
  assert(
    C.eligibleMovies(movies, state, exclusions).every(
      (movie) => movie.year < 1980 && C.minutes(movie.runtime) > 150,
    ),
  );
});

test("platform filtering uses verified subscriptions in the selected country", () => {
  const state = emptyState();
  const [first, second, unknown] = curated;
  const entry = (movie, providers) => ({
    title: movie.title,
    year: movie.year,
    providers,
  });
  const streaming = {
    regions: {
      US: {
        movies: {
          [first.id]: entry(first, ["hbo-max", "netflix"]),
          [second.id]: entry(second, ["netflix"]),
        },
      },
      TR: { movies: { [second.id]: entry(second, ["hbo-max"]) } },
    },
  };
  state.filters.platform = "hbo-max";
  assert.deepEqual(
    C.eligibleMovies([first, second, unknown], state, exclusions, streaming),
    [first],
  );
  state.filters.country = "TR";
  assert.deepEqual(
    C.eligibleMovies([first, second, unknown], state, exclusions, streaming),
    [second],
  );
  state.filters.platform = "any";
  assert.equal(
    C.eligibleMovies([first, second, unknown], state, exclusions, streaming)
      .length,
    3,
  );
});

test("unknown or stale identities never become platform matches; other rules still apply", () => {
  const state = emptyState();
  const movie = curated[0];
  state.filters.platform = "hbo-max";
  assert.deepEqual(C.eligibleMovies([movie], state, exclusions), []);
  const record = {
    title: movie.title,
    year: movie.year,
    providers: ["hbo-max"],
  };
  const streaming = { regions: { US: { movies: { [movie.id]: record } } } };
  assert.equal(
    C.eligibleMovies([movie], state, exclusions, streaming).length,
    1,
  );
  assert.equal(
    C.streamingMatch({ ...movie, year: movie.year + 1 }, "US", streaming),
    null,
  );
  assert.equal(
    C.streamingMatch({ ...movie, title: "Different film" }, "US", streaming),
    null,
  );
  state.picks = [movie.id];
  assert.deepEqual(C.eligibleMovies([movie], state, exclusions, streaming), []);
  state.filters.hidePicked = false;
  assert.equal(
    C.eligibleMovies([movie], state, exclusions, streaming).length,
    1,
  );
  state.history = [movie.id];
  assert.deepEqual(C.eligibleMovies([movie], state, exclusions, streaming), []);
  state.history = [];
  state.customExcluded[movie.id] = { category: "other" };
  assert.deepEqual(C.eligibleMovies([movie], state, exclusions, streaming), []);
  state.customExcluded = {};
  state.filters.runtime = "90";
  assert.deepEqual(C.eligibleMovies([movie], state, exclusions, streaming), []);
});

test("existing history migrates with Any platform; streaming preferences persist", () => {
  const legacy = C.normalizeState(
    { picks: [1], saved: [2], filters: { rating: "8" } },
    byId,
  );
  assert.equal(legacy.filters.platform, "any");
  assert.equal(legacy.filters.country, "US");
  assert.deepEqual(legacy.picks, [1]);
  assert.deepEqual(legacy.saved, [2]);
  legacy.filters.platform = "hbo-max";
  legacy.filters.country = "TR";
  assert.deepEqual(
    C.normalizeState(JSON.parse(JSON.stringify(legacy)), byId),
    legacy,
  );
});

test("bundled streaming snapshot joins real collection identities and regional provider links", () => {
  const streaming = require("../streaming_data.js");
  assert.equal(streaming.offerType, "subscription");
  assert(Number.isFinite(Date.parse(streaming.checkedAt)));
  for (const [country, region] of Object.entries(streaming.regions)) {
    const providers = new Set(region.providers.map((provider) => provider.id));
    assert(Object.keys(region.movies).length > 0);
    for (const [id, entry] of Object.entries(region.movies)) {
      const movie = byId.get(Number(id));
      assert(movie, `Unknown collection ID ${id}`);
      assert.equal(C.streamingMatch(movie, country, streaming), entry);
      assert(entry.providers.length > 0);
      assert(entry.providers.every((provider) => providers.has(provider)));
      assert(
        new RegExp(`^/${country.toLowerCase()}/(movie|film)/`).test(entry.path),
      );
      assert.match(entry.sourceId, /^tm\d+$/);
    }
    const state = emptyState();
    state.filters.country = country;
    state.filters.platform = "hbo-max";
    assert(C.eligibleMovies(movies, state, exclusions, streaming).length > 0);
  }
});

test("runtime boundaries and unrated certificates are accurate", () => {
  assert.equal(C.minutes("2h 6m"), 126);
  assert.equal(C.minutes("57m"), 57);
  assert.equal(C.minutes("2h"), 120);
  const movie = {
    year: 2000,
    runtime: "1h 30m",
    imdb_rating: 7,
    certificate: "Approved",
  };
  assert(C.matchesFilters(movie, { ...C.defaultFilters(), runtime: "90" }));
  assert(
    !C.matchesFilters(
      { ...movie, runtime: "1h 31m" },
      { ...C.defaultFilters(), runtime: "90" },
    ),
  );
  assert(
    !C.matchesFilters(movie, {
      ...C.defaultFilters(),
      certificate: "Not Rated",
    }),
  );
  assert(
    C.matchesFilters(
      { ...movie, certificate: null },
      { ...C.defaultFilters(), certificate: "Not Rated" },
    ),
  );
});

test("returns an empty pool safely and random indexing rejects empty arrays", () => {
  const state = emptyState();
  state.history = curated.map((movie) => movie.id);
  assert.deepEqual(C.eligibleMovies(movies, state, exclusions), []);
  assert.throws(() => C.randomIndex(0), RangeError);
  assert.equal(C.randomIndex(1), 0);
});
