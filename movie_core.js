/* Shared, dependency-free collection rules. Works from file:// and in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MovieCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const defaultFilters = () => ({
    decade: "any",
    runtime: "any",
    rating: "0",
    certificate: "any",
    hidePicked: true,
    country: "US",
    platform: "any",
  });
  const minutes = (runtime = "") =>
    Number((runtime.match(/(\d+)h/) || [0, 0])[1]) * 60 +
    Number((runtime.match(/(\d+)m/) || [0, 0])[1]);
  const slug = (title) =>
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "");
  const torrentURL = (movie, quality = "1080p") =>
    `https://www.limetorrents.fun/search/all/${encodeURIComponent(slug(`${movie.title} ${movie.year} ${["720p", "1080p", "2160p"].includes(quality) ? quality : "1080p"}`))}/`;
  const uniqueIds = (values, movieById) => [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map(Number)
        .filter((id) => movieById.has(id)),
    ),
  ];
  function normalizeState(raw, movieById) {
    const source = raw && typeof raw === "object" ? raw : {};
    const customExcluded = {};
    for (const [id, entry] of Object.entries(source.customExcluded || {})) {
      if (
        movieById.has(Number(id)) &&
        entry &&
        (typeof entry === "object" || typeof entry === "string")
      ) {
        customExcluded[id] = {
          category:
            typeof entry === "string"
              ? entry
              : String(entry.category || "other"),
          addedAt: entry.addedAt || null,
        };
      }
    }
    const history = uniqueIds(source.history, movieById);
    return {
      version: 4,
      history,
      picks: uniqueIds(source.picks ?? history, movieById),
      saved: uniqueIds(source.saved, movieById),
      customExcluded,
      restored: uniqueIds(source.restored, movieById),
      currentId: movieById.has(Number(source.currentId))
        ? Number(source.currentId)
        : null,
      filters: {
        ...defaultFilters(),
        ...(source.filters && typeof source.filters === "object"
          ? source.filters
          : {}),
      },
      animate: source.animate !== false,
      quality: ["720p", "1080p", "2160p"].includes(source.quality)
        ? source.quality
        : "1080p",
    };
  }
  const isExcluded = (id, state, sourceExcluded) =>
    Boolean(state.customExcluded[id]) ||
    (sourceExcluded.has(id) && !state.restored.includes(id));
  function streamingMatch(movie, country, streaming) {
    const match = streaming?.regions?.[country]?.movies?.[movie.id];
    return match?.title === movie.title && match?.year === movie.year
      ? match
      : null;
  }
  function matchesFilters(movie, filters, streaming = null) {
    if (
      filters.platform &&
      filters.platform !== "any" &&
      !streamingMatch(
        movie,
        filters.country || "US",
        streaming,
      )?.providers?.includes(filters.platform)
    )
      return false;
    const time = minutes(movie.runtime);
    if (filters.decade === "classic" && movie.year >= 1980) return false;
    if (
      !["any", "classic"].includes(filters.decade) &&
      Math.floor(movie.year / 10) * 10 !== Number(filters.decade)
    )
      return false;
    if (
      filters.runtime === "long"
        ? time <= 150
        : filters.runtime !== "any" && (!time || time > Number(filters.runtime))
    )
      return false;
    if (Number(movie.imdb_rating) < Number(filters.rating)) return false;
    if (filters.certificate === "Not Rated")
      return (
        !movie.certificate ||
        ["Not Rated", "Unrated"].includes(movie.certificate)
      );
    return (
      filters.certificate === "any" || movie.certificate === filters.certificate
    );
  }
  function eligibleMovies(movies, state, sourceExcluded, streaming = null) {
    const watched = new Set(state.history),
      picked = new Set(state.picks);
    return movies.filter(
      (movie) =>
        !isExcluded(movie.id, state, sourceExcluded) &&
        !watched.has(movie.id) &&
        (!state.filters.hidePicked || !picked.has(movie.id)) &&
        matchesFilters(movie, state.filters, streaming),
    );
  }
  function randomIndex(length, crypto = globalThis.crypto) {
    if (!Number.isInteger(length) || length <= 0)
      throw new RangeError("A nonempty movie pool is required.");
    if (!crypto?.getRandomValues) return Math.floor(Math.random() * length);
    const limit = Math.floor(4294967296 / length) * length,
      values = new Uint32Array(1);
    do {
      crypto.getRandomValues(values);
    } while (values[0] >= limit);
    return values[0] % length;
  }
  return {
    defaultFilters,
    minutes,
    slug,
    torrentURL,
    normalizeState,
    isExcluded,
    matchesFilters,
    streamingMatch,
    eligibleMovies,
    randomIndex,
  };
});
