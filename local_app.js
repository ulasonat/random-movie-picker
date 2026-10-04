(() => {
  "use strict";
  const Core = window.MovieCore;
  const streaming = window.STREAMING_DATA || null;
  const $ = (id) => document.getElementById(id);
  const categories = new Map([
    ["horror", "Horror"],
    ["abuse_victimization", "Abuse / victimization"],
    ["children", "Children / family"],
    ["animation", "Animation"],
    ["non_live_action", "Non-live action"],
    ["male_gay", "LGBTQ+ themes"],
    ["seen_elsewhere", "Seen elsewhere"],
    ["other", "Not for me"],
  ]);
  const seedCategories = window.EXCLUDED_MOVIES?.categories || [];
  const sourceExcluded = new Map();
  const movieById = new Map(
    (window.MOVIES || []).map((movie) => [movie.id, movie]),
  );
  for (const category of seedCategories)
    for (const movie of category.movies) {
      sourceExcluded.set(movie.id, category.key);
      movieById.set(movie.id, movie);
    }
  const movies = [...movieById.values()];
  const storageKey = "random-movie-generator:local:v4";
  let storageUnavailable = false;
  function readStorage(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  }
  const storedState =
    readStorage(storageKey) ||
    readStorage("random-movie-generator:local:v3") ||
    readStorage("random-movie-generator:local:v2") ||
    readStorage("random-movie-generator:local:v1");
  let state = Core.normalizeState(storedState, movieById);
  // Invalid saved dropdown values should never silently empty the collection.
  for (const key of ["decade", "runtime", "rating", "certificate"]) {
    if (
      ![...$(`filter-${key}`).options].some(
        (option) => option.value === String(state.filters[key]),
      )
    )
      state.filters[key] = Core.defaultFilters()[key];
  }
  if (
    state.currentId &&
    (Core.isExcluded(state.currentId, state, sourceExcluded) ||
      ![...state.picks, ...state.saved, ...state.history].includes(
        state.currentId,
      ))
  )
    state.currentId = null;
  let activeView = "discover",
    busy = false,
    exclusionTarget = null;
  let selectedCategory = "all",
    excludedPage = 1,
    libraryPage = 1,
    libraryTab = "picks";
  let selectedExclusions = new Set(),
    visibleExclusions = [],
    undo = null,
    toastTimer,
    confirmAction = null;
  let descriptionExpanded = false,
    descriptionSourceURL = null;
  const pageSize = 16;
  const posterCache = new Map(Object.entries(window.POSTER_SEED || {}));
  const cachedPosters = readStorage("frame:poster-cache:v1");
  if (cachedPosters && typeof cachedPosters === "object")
    for (const [key, value] of Object.entries(cachedPosters)) {
      if (value && value.image && Date.now() - value.cachedAt < 30 * 86400000)
        posterCache.set(key, value);
    }
  const inflightPosters = new Map();
  const posterQueue = [];
  let posterRequests = 0;
  const icons = {
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    shuffle:
      '<path d="m16 3 4 4-4 4M4 7h3c5 0 5 10 10 10h3M4 17h3c2 0 3-2 4-4m2-2c1-2 2-4 4-4h3m-4 6 4 4-4 4"/>',
    bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    ban: '<circle cx="12" cy="12" r="8"/><path d="m6.5 6.5 11 11"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14" transform="translate(0 -2)"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    play: '<path d="m8 4 12 8-12 8z"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  };
  function addIcons(root = document) {
    root.querySelectorAll("[data-icon]").forEach((el) => {
      el.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[el.dataset.icon] || ""}</svg>`;
    });
  }
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function announce(message, undoAction = null) {
    clearTimeout(toastTimer);
    undo = undoAction;
    $("toast-message").textContent = message;
    $("undo-action").hidden = !undo;
    $("toast").hidden = false;
    toastTimer = setTimeout(
      () => {
        if (!$("toast").matches(":hover, :focus-within"))
          $("toast").hidden = true;
      },
      undoAction ? 12000 : 6500,
    );
  }
  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      if (!storageUnavailable) {
        storageUnavailable = true;
        announce(
          "Browser storage is full or unavailable. Export your collection to keep these changes.",
        );
      }
    }
  }
  function mutate(message, callback) {
    const before = JSON.stringify(state);
    callback();
    save();
    render();
    announce(message, () => {
      state = Core.normalizeState(JSON.parse(before), movieById);
      syncFilters();
      save();
      render();
      announce("Undone.");
    });
  }
  const currentMovie = () => movieById.get(state.currentId);
  const isExcluded = (id) => Core.isExcluded(id, state, sourceExcluded);
  const eligible = () =>
    Core.eligibleMovies(movies, state, sourceExcluded, streaming);
  const streamingRegion = () => streaming?.regions?.[state.filters.country];
  function justWatchLink(url, label = "JustWatch ↗") {
    const link = node("a", "", label);
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }
  function streamingDate() {
    return new Date(streaming.checkedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  function syncPlatforms() {
    const select = $("filter-platform");
    const region = streamingRegion();
    select.replaceChildren(new Option("Any platform", "any"));
    for (const provider of region?.providers || [])
      select.add(new Option(provider.name, provider.id));
    if (
      ![...select.options].some(
        (option) => option.value === state.filters.platform,
      )
    ) {
      if (!region && state.filters.platform !== "any")
        select.add(
          new Option(
            "Selected platform · data unavailable",
            state.filters.platform,
          ),
        );
      else state.filters.platform = "any";
    }
    select.value = state.filters.platform;
  }
  function renderStreamingStatus() {
    const region = streamingRegion();
    const status = $("streaming-status");
    status.replaceChildren();
    if (!region) {
      status.textContent =
        "Streaming data is unavailable. Choose Any platform to browse your full collection.";
      return;
    }
    const stale = Date.now() - Date.parse(streaming.checkedAt) > 14 * 86400000;
    status.append(
      document.createTextNode(
        `Subscription matches only; some titles may be missing. Checked ${streamingDate()} · `,
      ),
      justWatchLink(
        `https://www.justwatch.com/${state.filters.country.toLowerCase()}`,
      ),
    );
    if (stale)
      status.append(document.createTextNode(" Availability may have changed."));
  }
  function renderStreamingMovie() {
    const root = $("streaming-availability");
    const movie = currentMovie();
    root.hidden = !movie;
    root.replaceChildren();
    if (!movie) return;
    const region = streamingRegion();
    const country = state.filters.country === "TR" ? "Turkey" : "United States";
    const match = Core.streamingMatch(movie, state.filters.country, streaming);
    const providers = (region?.providers || [])
      .filter((provider) => match?.providers.includes(provider.id))
      .map((provider) => provider.name);
    if (providers.length) {
      root.append(
        node("span", "", `Included with · ${country}`),
        node("strong", "", providers.join(" · ")),
        node("span", "", `Checked ${streamingDate()}`),
      );
    } else {
      root.append(
        node("span", "", `Subscription availability unverified in ${country}.`),
      );
    }
    const base = `https://www.justwatch.com/${state.filters.country.toLowerCase()}`;
    const path = match?.path;
    const url =
      path &&
      new RegExp(`^/${state.filters.country.toLowerCase()}/(movie|film)/`).test(
        path,
      )
        ? `https://www.justwatch.com${path}`
        : `${base}/search?q=${encodeURIComponent(`${movie.title} ${movie.year}`)}`;
    root.append(justWatchLink(url, "Check on JustWatch ↗"));
  }
  const cacheKey = (movie) => `${movie.title}|${movie.year}`;
  function cachePoster(movie, value) {
    posterCache.set(cacheKey(movie), value);
    if (!value) return;
    try {
      localStorage.setItem(
        "frame:poster-cache:v1",
        JSON.stringify(
          Object.fromEntries(
            [...posterCache.entries()].filter(([, v]) => v).slice(-250),
          ),
        ),
      );
    } catch {
      /* Artwork caching is optional. */
    }
  }
  async function wikiQuery(params) {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      redirects: "1",
      prop: "pageimages|extracts|pageprops|info",
      inprop: "url",
      piprop: "thumbnail",
      pithumbsize: "500",
      pilicense: "any",
      exintro: "1",
      explaintext: "1",
      exsentences: "2",
      ...params,
    });
    const response = await fetch(url, { signal: AbortSignal.timeout(6500) });
    if (!response.ok) throw new Error("Artwork unavailable");
    return Object.values((await response.json()).query?.pages || {});
  }
  function chooseWikiPage(pages, movie) {
    const normalize = (title) =>
      title
        .normalize("NFKD")
        .toLowerCase()
        .replace(/\([^)]*\)/g, "")
        .replace(/[^\p{L}\p{N}]/gu, "");
    const matching = pages.filter(
      (page) =>
        !page.missing &&
        !Object.prototype.hasOwnProperty.call(
          page.pageprops || {},
          "disambiguation",
        ) &&
        normalize(page.title) === normalize(movie.title) &&
        /\bfilm\b/i.test(page.extract || "") &&
        new RegExp(`\\b${movie.year}\\b`).test(
          (page.extract || "").slice(0, 500),
        ),
    );
    matching.sort((a, b) => Number(!!b.thumbnail) - Number(!!a.thumbnail));
    return matching[0];
  }
  async function fetchPoster(movie) {
    const names = [
      `${movie.title} (${movie.year} film)`,
      `${movie.title} (film)`,
      movie.title,
    ];
    let page = chooseWikiPage(
      await wikiQuery({ titles: names.join("|") }),
      movie,
    );
    if (!page)
      page = chooseWikiPage(
        await wikiQuery({
          generator: "search",
          gsrsearch: `"${movie.title}" ${movie.year} film`,
          gsrnamespace: "0",
          gsrlimit: "3",
        }),
        movie,
      );
    if (!page) return null;
    const image = page.thumbnail?.source;
    return {
      image:
        image && /^https:\/\/upload\.wikimedia\.org\//.test(image)
          ? image
          : null,
      description: page.extract || "",
      url:
        page.fullurl ||
        `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))}`,
      cachedAt: Date.now(),
    };
  }
  function drainPosterQueue() {
    while (posterRequests < 3 && posterQueue.length) {
      const { movie, resolve } = posterQueue.shift();
      posterRequests++;
      fetchPoster(movie)
        .then((data) => {
          cachePoster(movie, data);
          resolve(data);
        })
        .catch(() => resolve(null))
        .finally(() => {
          inflightPosters.delete(cacheKey(movie));
          posterRequests--;
          drainPosterQueue();
        });
    }
  }
  function getPoster(movie, priority = false) {
    const key = cacheKey(movie);
    if (posterCache.has(key)) return Promise.resolve(posterCache.get(key));
    if (inflightPosters.has(key)) return inflightPosters.get(key);
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    inflightPosters.set(key, promise);
    posterQueue[priority ? "unshift" : "push"]({ movie, resolve });
    drainPosterQueue();
    return promise;
  }
  const posterLoads = new WeakMap();
  function placeImage(element, movie, data) {
    if (!data?.image) return Promise.resolve(false);
    if (element.querySelector("img")) return Promise.resolve(true);
    const pending = posterLoads.get(element);
    if (pending?.id === movie.id && pending?.source === data.image)
      return pending.promise;
    const img = document.createElement("img");
    img.alt = `${movie.title} (${movie.year}) poster`;
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    const promise = new Promise((resolve) => {
      img.onload = () => {
        const matches = element.dataset.movieId === String(movie.id);
        if (matches && !element.querySelector("img")) element.append(img);
        resolve(matches);
      };
      img.onerror = () => resolve(false);
    });
    posterLoads.set(element, { id: movie.id, source: data.image, promise });
    img.src = data.image;
    promise.finally(() => {
      if (posterLoads.get(element)?.promise === promise)
        posterLoads.delete(element);
    });
    return promise;
  }
  const posterObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          posterObserver.unobserve(entry.target);
          const movie = movieById.get(Number(entry.target.dataset.movieId));
          if (movie)
            getPoster(movie).then((data) => {
              if (entry.target.isConnected)
                placeImage(entry.target, movie, data);
            });
        }
    },
    { rootMargin: "100px" },
  );
  function makePoster(movie, className = "mini-poster") {
    const el = node("div", `${className} poster-placeholder`);
    el.dataset.movieId = movie.id;
    el.append(node("span", "", movie.title), node("small", "", movie.year));
    if (posterCache.has(cacheKey(movie)))
      placeImage(el, movie, posterCache.get(cacheKey(movie)));
    else posterObserver.observe(el);
    return el;
  }
  function renderCurrent() {
    const movie = currentMovie();
    renderStreamingMovie();
    const hasMovie = Boolean(movie);
    $("poster-collage").hidden = hasMovie;
    $("main-poster").hidden = !hasMovie;
    for (const id of [
      "movie-meta",
      "movie-actions",
      "movie-links",
      "selection-actions",
    ])
      $(id).hidden = !hasMovie;
    document
      .querySelector(".movie-story")
      .classList.toggle("has-movie", hasMovie);
    $("pick-label").textContent = hasMovie
      ? "Pick another film"
      : "Pick a film";
    $("movie-eyebrow").textContent = hasMovie
      ? "TONIGHT’S POSSIBILITIES START HERE"
      : "THE BEST PLAN IS A LITTLE CHANCE";
    if (!movie) {
      descriptionExpanded = false;
      descriptionSourceURL = null;
      $("reveal-description").hidden = true;
      $("movie-description").hidden = false;
      $("movie-title").innerHTML = "Meet your next<br /><em>favorite.</em>";
      $("movie-description").innerHTML =
        "An old favorite. An unexpected gem.<br />Your next movie is just a pick away.";
      $("poster-credit").hidden = true;
      $("stage-caption").textContent = "A world of stories awaits.";
      $("feature-number").textContent = "LET CHANCE CHOOSE";
      $("main-poster").dataset.movieId = "";
      return;
    }
    $("movie-title").textContent = movie.title;
    $("feature-number").textContent =
      `FEATURE Nº ${String(movie.id).padStart(4, "0")}`;
    $("stage-caption").textContent = `${movie.year}  /  ${movie.runtime}`;
    const meta = $("movie-meta");
    meta.replaceChildren();
    const ratingGroup = node("span", "rating-group");
    ratingGroup.append(
      node("span", "rating", `★ ${Number(movie.imdb_rating).toFixed(1)}`),
      node("span", "vote-count", `${movie.votes || "—"} votes`),
    );
    ratingGroup.setAttribute(
      "aria-label",
      `IMDb ${movie.imdb_rating.toFixed(1)} from ${movie.votes || "unknown"} votes`,
    );
    meta.append(
      ratingGroup,
      node("span", "", String(movie.year)),
      node("span", "", "·"),
      node("span", "", movie.runtime),
      node("span", "certificate", movie.certificate || "Not rated"),
    );
    const mainPoster = $("main-poster");
    if (mainPoster.dataset.movieId !== String(movie.id)) {
      descriptionExpanded = false;
      descriptionSourceURL = null;
      mainPoster.dataset.movieId = movie.id;
      mainPoster.replaceChildren(
        node("span", "", movie.title),
        node("small", "", movie.year),
      );
      $("movie-description").textContent =
        "The description is not available right now.";
      $("poster-credit").hidden = true;
      getPoster(movie, true).then((data) => {
        if (state.currentId !== movie.id) return;
        placeImage(mainPoster, movie, data);
        if (data?.description)
          $("movie-description").textContent = data.description;
        if (data?.url && /^https:\/\/en\.wikipedia\.org\//.test(data.url)) {
          descriptionSourceURL = data.url;
          $("poster-credit").href = data.url;
        }
        renderDescriptionVisibility();
      });
    }
    renderDescriptionVisibility();
    const saved = state.saved.includes(movie.id),
      watched = state.history.includes(movie.id);
    $("undo-selection").disabled = !state.picks.includes(movie.id);
    $("undo-selection-hint").textContent = watched
      ? "Keep watched status"
      : "Return to pool";
    $("save-movie").innerHTML =
      `<span data-icon="bookmark"></span> ${saved ? "Saved" : "Save"}`;
    $("watch-movie").innerHTML =
      `<span data-icon="check"></span> ${watched ? "Watched" : "Mark watched"}`;
    $("save-movie").setAttribute("aria-pressed", String(saved));
    $("watch-movie").setAttribute("aria-pressed", String(watched));
    addIcons($("movie-actions"));
    $("trailer-link").href =
      `https://www.youtube.com/results?search_query=${encodeURIComponent(`${movie.title} ${movie.year} official trailer`)}`;
    $("imdb-link").href =
      `https://www.imdb.com/find/?q=${encodeURIComponent(`${movie.title} ${movie.year}`)}&s=tt`;
    $("torrent-link").href = Core.torrentURL(movie, state.quality);
    $("torrent-link").setAttribute(
      "aria-label",
      `Search LimeTorrents for ${movie.title} ${movie.year} ${state.quality} (opens in new tab)`,
    );
    $("quality").value = state.quality;
  }
  function renderDescriptionVisibility() {
    const movie = currentMovie();
    $("reveal-description").hidden = !movie;
    $("reveal-description").setAttribute(
      "aria-expanded",
      String(Boolean(movie && descriptionExpanded)),
    );
    $("reveal-description").querySelector("span:last-child").textContent =
      descriptionExpanded ? "Hide description" : "Reveal description";
    $("movie-description").hidden = Boolean(movie && !descriptionExpanded);
    $("poster-credit").hidden =
      !movie || !descriptionExpanded || !descriptionSourceURL;
  }
  function renderCounts() {
    const count = eligible().length;
    renderStreamingStatus();
    const pool = movies.filter((movie) => !isExcluded(movie.id)).length;
    const excluded = movies.length - pool;
    $("pool-count").textContent = pool.toLocaleString();
    $("available-count").textContent = count
      ? `${count.toLocaleString()} films fit your mood`
      : state.filters.platform !== "any"
        ? "No verified subscription matches. Try another platform or wider filters."
        : "No films match. Try widening your filters.";
    $("filter-count").textContent = count.toLocaleString();
    document.querySelector(".foot-note").textContent = state.filters.hidePicked
      ? "Good taste. No repeats."
      : "Previous picks included.";
    $("excluded-nav-count").textContent = excluded.toLocaleString();
    $("excluded-total").textContent = excluded.toLocaleString();
    $("pick-movie").disabled = busy || !count;
    $("reshuffle-pool").hidden =
      count > 0 || !state.picks.length || !state.filters.hidePicked;
    $("pick-hint").innerHTML = count
      ? "<kbd>Space</kbd> for a little serendipity"
      : "Change your filters or bring back previous picks.";
    $("picks-count").textContent = state.picks.length;
    $("saved-count").textContent = state.saved.length;
    $("watched-count").textContent = state.history.length;
  }
  function renderRecent() {
    const root = $("recent-movies");
    root.replaceChildren();
    const recent = state.picks.filter((id) => !isExcluded(id)).slice(0, 4);
    if (!recent.length) {
      const empty = node("div", "empty-recent");
      empty.append(
        node("span", "", "↶"),
        node(
          "div",
          "",
          "Your next discoveries will live here. Picking a film won’t mark it watched.",
        ),
      );
      root.append(empty);
      return;
    }
    for (const id of recent) {
      const movie = movieById.get(id),
        button = node("button", "recent-card");
      const details = node("div");
      details.append(
        node("strong", "", movie.title),
        node(
          "span",
          "muted",
          `${movie.year} · ★ ${movie.imdb_rating.toFixed(1)}`,
        ),
      );
      button.append(makePoster(movie), details);
      button.addEventListener("click", () => showMovie(id));
      root.append(button);
    }
  }
  function allExclusions() {
    return movies
      .filter((movie) => isExcluded(movie.id))
      .map((movie) => ({
        ...movie,
        category:
          state.customExcluded[movie.id]?.category ||
          sourceExcluded.get(movie.id),
        custom: Boolean(state.customExcluded[movie.id]),
      }));
  }
  const queryMatch = (movie, query) =>
    `${movie.title} ${movie.year}`
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .includes(
        query
          .toLocaleLowerCase()
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim(),
      );
  function renderCategories(all) {
    const root = $("category-list");
    root.replaceChildren();
    for (const [key, label] of [["all", "All exclusions"], ...categories]) {
      const count =
        key === "all"
          ? all.length
          : all.filter((movie) => movie.category === key).length;
      const button = node(
        "button",
        `category-button${selectedCategory === key ? " active" : ""}`,
        label,
      );
      button.append(node("span", "", String(count)));
      button.setAttribute("aria-pressed", String(selectedCategory === key));
      button.addEventListener("click", () => {
        selectedCategory = key;
        excludedPage = 1;
        selectedExclusions.clear();
        renderExcluded();
      });
      root.append(button);
    }
  }
  function emptyState(root, heading, copy) {
    const empty = node("div", "empty-state");
    empty.append(
      node("span", "empty-symbol", "✳"),
      node("h3", "", heading),
      node("p", "", copy),
    );
    root.append(empty);
  }
  function pagination(root, page, count, onChange) {
    root.replaceChildren();
    const pages = Math.max(1, Math.ceil(count / pageSize));
    if (pages <= 1) return;
    const prev = node("button", "button small secondary", "← Previous"),
      next = node("button", "button small secondary", "Next →");
    prev.disabled = page <= 1;
    next.disabled = page >= pages;
    prev.onclick = () => onChange(page - 1);
    next.onclick = () => onChange(page + 1);
    root.append(prev, node("span", "", `${page} / ${pages}`), next);
  }
  function syncBulkActions() {
    $("restore-selected").disabled = selectedExclusions.size === 0;
    $("restore-selected").textContent = selectedExclusions.size
      ? `Restore ${selectedExclusions.size} selected`
      : "Restore selected";
    $("select-page").textContent =
      visibleExclusions.length &&
      visibleExclusions.every((movie) => selectedExclusions.has(movie.id))
        ? "Deselect page"
        : "Select page";
    $("select-page").disabled = !visibleExclusions.length;
  }
  function renderExcluded() {
    const all = allExclusions();
    renderCategories(all);
    const source = $("excluded-source").value,
      query = $("excluded-search").value,
      sort = $("excluded-sort").value;
    const filtered = all.filter(
      (movie) =>
        (selectedCategory === "all" || movie.category === selectedCategory) &&
        queryMatch(movie, query) &&
        (source === "all" || movie.custom === (source === "custom")),
    );
    filtered.sort((a, b) =>
      sort === "newest"
        ? b.year - a.year || a.title.localeCompare(b.title)
        : sort === "rating"
          ? b.imdb_rating - a.imdb_rating || a.title.localeCompare(b.title)
          : a.title.localeCompare(b.title),
    );
    excludedPage = Math.max(
      1,
      Math.min(excludedPage, Math.ceil(filtered.length / pageSize)),
    );
    visibleExclusions = filtered.slice(
      (excludedPage - 1) * pageSize,
      excludedPage * pageSize,
    );
    selectedExclusions = new Set(
      [...selectedExclusions].filter((id) =>
        filtered.some((movie) => movie.id === id),
      ),
    );
    $("excluded-results").textContent =
      `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "movie" : "movies"}${query ? " found" : ""}`;
    const root = $("excluded-list");
    root.replaceChildren();
    if (!filtered.length)
      emptyState(
        root,
        "Nothing here.",
        "Try another category or search. Your collection stays just as you like it.",
      );
    for (const movie of visibleExclusions) {
      const row = node("article", "excluded-row");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "row-select";
      check.checked = selectedExclusions.has(movie.id);
      check.setAttribute("aria-label", `Select ${movie.title}`);
      check.onchange = () => {
        if (check.checked) selectedExclusions.add(movie.id);
        else selectedExclusions.delete(movie.id);
        syncBulkActions();
      };
      const details = node("div", "row-main");
      details.append(
        node("h3", "row-title", movie.title),
        node(
          "div",
          "row-meta",
          `${movie.year} · ${movie.runtime} · ★ ${movie.imdb_rating.toFixed(1)}`,
        ),
        node(
          "span",
          "source-label",
          movie.custom
            ? "Excluded by you"
            : movie.exclusion_reason || "Original collection",
        ),
      );
      const restore = node("button", "button small secondary", "Restore");
      restore.setAttribute("aria-label", `Restore ${movie.title}`);
      restore.onclick = () => restoreMovies([movie.id]);
      row.append(
        check,
        makePoster(movie),
        details,
        node("span", "category-tag", categories.get(movie.category) || "Other"),
        restore,
      );
      root.append(row);
    }
    syncBulkActions();
    pagination(
      $("excluded-pagination"),
      excludedPage,
      filtered.length,
      (page) => {
        excludedPage = page;
        selectedExclusions.clear();
        renderExcluded();
        $("excluded-list").scrollIntoView({ block: "start" });
      },
    );
  }
  function restoreMovies(ids) {
    const selected = ids.filter((id) => isExcluded(id));
    if (!selected.length) return;
    mutate(
      selected.length === 1
        ? `${movieById.get(selected[0]).title} is back in your collection.`
        : `${selected.length} movies restored.`,
      () => {
        for (const id of selected) {
          delete state.customExcluded[id];
          if (sourceExcluded.has(id) && !state.restored.includes(id))
            state.restored.push(id);
        }
      },
    );
    selectedExclusions.clear();
    syncBulkActions();
  }
  function renderLibrary() {
    document.querySelectorAll("[data-library]").forEach((button) => {
      const active = button.dataset.library === libraryTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const key = libraryTab === "watched" ? "history" : libraryTab;
    const list = state[key]
      .map((id) => movieById.get(id))
      .filter((movie) => queryMatch(movie, $("library-search").value));
    libraryPage = Math.max(
      1,
      Math.min(libraryPage, Math.ceil(list.length / pageSize)),
    );
    $("library-results").textContent =
      `${list.length} ${list.length === 1 ? "film" : "films"} ${libraryTab === "picks" ? "picked" : libraryTab}`;
    $("clear-history").textContent =
      libraryTab === "watched" ? "Clear watched history" : "Clear pick history";
    $("clear-history").hidden = libraryTab === "saved" || !state[key].length;
    const root = $("library-list");
    root.replaceChildren();
    if (!list.length)
      emptyState(
        root,
        $("library-search").value
          ? "No matching films."
          : libraryTab === "saved"
            ? "For another night."
            : libraryTab === "watched"
              ? "Roll the credits."
              : "The story starts here.",
        $("library-search").value
          ? "Try a different title or year."
          : libraryTab === "saved"
            ? "Tap Save on a pick to keep it here for later."
            : libraryTab === "watched"
              ? "Mark a film watched when you’ve seen it. A pick alone doesn’t count."
              : "Pick a film and your discoveries will collect here.",
      );
    for (const movie of list.slice(
      (libraryPage - 1) * pageSize,
      libraryPage * pageSize,
    )) {
      const card = node("article", "journal-card"),
        open = node("button", "journal-open");
      open.append(
        makePoster(movie, "journal-poster"),
        node("h3", "", movie.title),
        node(
          "div",
          "row-meta",
          `${movie.year} · ★ ${movie.imdb_rating.toFixed(1)}`,
        ),
      );
      open.onclick = () => showMovie(movie.id);
      const controls = node("div", "journal-controls");
      const remove = node(
        "button",
        "",
        libraryTab === "watched" ? "Unwatch" : "Remove",
      );
      remove.setAttribute(
        "aria-label",
        `Remove ${movie.title} from ${libraryTab}`,
      );
      remove.onclick = () =>
        mutate(`${movie.title} removed from ${libraryTab}.`, () => {
          state[key] = state[key].filter((id) => id !== movie.id);
          if (key === "picks" && state.currentId === movie.id)
            state.currentId = null;
        });
      const action = node(
        "button",
        "",
        state.saved.includes(movie.id) ? "Saved ✓" : "Save",
      );
      action.onclick = () => toggleSaved(movie.id);
      controls.append(remove);
      if (libraryTab !== "saved") controls.append(action);
      card.append(open, controls);
      root.append(card);
    }
    pagination($("library-pagination"), libraryPage, list.length, (page) => {
      libraryPage = page;
      renderLibrary();
      $("library-list").scrollIntoView({ block: "start" });
    });
  }
  function render() {
    // Release detached list nodes before observing the newly rendered ones.
    posterObserver.disconnect();
    renderCounts();
    renderCurrent();
    renderRecent();
    if (activeView === "excluded") renderExcluded();
    if (activeView === "library") renderLibrary();
  }
  function syncFilters() {
    if (!["US", "TR"].includes(state.filters.country))
      state.filters.country = "US";
    $("filter-country").value = state.filters.country;
    syncPlatforms();
    for (const key of ["decade", "runtime", "rating", "certificate"])
      $(`filter-${key}`).value = state.filters[key];
    $("hide-picked").checked = state.filters.hidePicked;
    $("animate-picks").checked = state.animate;
    syncPresets();
  }
  function syncPresets() {
    const f = state.filters;
    const base =
      f.decade === "any" &&
      f.runtime === "any" &&
      f.rating === "0" &&
      f.certificate === "any";
    document.querySelectorAll("[data-preset]").forEach((button) => {
      const key = button.dataset.preset;
      const active =
        key === "any"
          ? base
          : key === "quick"
            ? f.runtime === "90"
            : key === "great"
              ? f.rating === "8"
              : f.decade === "classic";
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }
  const pause = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));
  const motionReduced = () =>
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  async function pickMovie() {
    if (busy || activeView !== "discover") return;
    const available = eligible();
    if (!available.length) {
      announce("No matching films. Try changing your filters.");
      return;
    }
    const movie = available[Core.randomIndex(available.length)];
    const card = $("feature-card"),
      veil = $("reveal-veil");
    const story = document.querySelector(".movie-story");
    const animated = state.animate && !motionReduced();
    const returnFocus = card.contains(document.activeElement);
    const animations = [];
    busy = true;
    descriptionExpanded = false;
    card.setAttribute("aria-busy", "true");
    card.inert = true;
    $("toast").hidden = true;
    undo = null;
    if (animated) {
      card.classList.add("is-revealing");
      veil.hidden = false;
    }
    state.currentId = movie.id;
    render();
    const poster = $("main-poster");
    const setStartPosition = () => {
      // FLIP: the actual poster starts in the center and lands in its normal slot.
      // The stacked phone layout naturally moves it up rather than sideways.
      poster.style.removeProperty("--reveal-x");
      poster.style.removeProperty("--reveal-y");
      poster.style.removeProperty("--reveal-scale");
      const destination = poster.getBoundingClientRect();
      const frame = card.getBoundingClientRect();
      const scale = Math.min(
        innerWidth <= 540 ? 1.25 : 1.04,
        (frame.height - 70) / destination.height,
      );
      const dx =
        frame.left + frame.width / 2 - destination.left - destination.width / 2;
      const dy =
        frame.top +
        frame.height * 0.48 -
        destination.top -
        destination.height / 2;
      poster.style.setProperty("--reveal-x", `${dx}px`);
      poster.style.setProperty("--reveal-y", `${dy}px`);
      poster.style.setProperty("--reveal-scale", scale);
      return `translate(${dx}px, ${dy}px) scale(${scale})`;
    };
    try {
      if (animated) {
        setStartPosition();
        // Prepare the chosen artwork, never flash names or posters of other films.
        await Promise.race([
          getPoster(movie, true).then((data) =>
            placeImage(poster, movie, data),
          ),
          pause(4500),
        ]);
        if (
          activeView === "discover" &&
          state.currentId === movie.id &&
          !motionReduced()
        ) {
          const startTransform = setStartPosition();
          card.dataset.revealPhase = "unblur";
          animations.push(
            poster.animate(
              [
                {
                  transform: startTransform,
                  filter: "blur(24px)",
                  opacity: 0.45,
                  offset: 0,
                },
                {
                  transform: startTransform,
                  filter: "blur(14px)",
                  opacity: 1,
                  offset: 0.18,
                },
                {
                  transform: startTransform,
                  filter: "blur(0px)",
                  opacity: 1,
                  offset: 0.67,
                },
                {
                  transform: startTransform,
                  filter: "blur(0px)",
                  opacity: 1,
                  offset: 0.73,
                  easing: "cubic-bezier(.2,.75,.3,1)",
                },
                {
                  transform: "translate(0px, 0px) scale(1)",
                  filter: "blur(0px)",
                  opacity: 1,
                  offset: 1,
                },
              ],
              {
                duration: 2750,
                easing: "linear",
                fill: "both",
              },
            ),
          );
          animations.push(
            veil.animate(
              [
                { opacity: 1, offset: 0 },
                { opacity: 1, offset: 0.7 },
                { opacity: 0, offset: 1 },
              ],
              { duration: 2750, fill: "both", easing: "ease-in-out" },
            ),
          );
          animations.push(
            story.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: 380,
              delay: 2040,
              fill: "both",
              easing: "ease-out",
            }),
          );
          const details = [...story.children].filter((child) => !child.hidden);
          details.forEach((child, index) => {
            animations.push(
              child.animate(
                [
                  {
                    transform: "translateY(15px)",
                    opacity: 0,
                    filter: "blur(3px)",
                  },
                  {
                    transform: "translateY(0)",
                    opacity: 1,
                    filter: "blur(0px)",
                  },
                ],
                {
                  duration: 520,
                  delay: 1970 + index * 55,
                  fill: "both",
                  easing: "cubic-bezier(.2,.75,.3,1)",
                },
              ),
            );
          });
          await Promise.all(
            animations.map((animation) => animation.finished.catch(() => {})),
          );
        }
      }
    } catch (_) {
      // Animation or artwork failure must never strand the picked movie.
    } finally {
      for (const animation of animations) animation.cancel();
      card.classList.remove("is-revealing");
      delete card.dataset.revealPhase;
      for (const key of ["--reveal-x", "--reveal-y", "--reveal-scale"])
        poster.style.removeProperty(key);
      veil.hidden = true;
      card.inert = false;
      card.setAttribute("aria-busy", "false");
      busy = false;
      if (state.currentId === movie.id) {
        state.picks = [
          movie.id,
          ...state.picks.filter((id) => id !== movie.id),
        ];
        save();
      }
      render();
      if (
        returnFocus &&
        activeView === "discover" &&
        (document.activeElement === document.body ||
          document.activeElement.matches(".skip-link")) &&
        !$("pick-movie").disabled
      )
        $("pick-movie").focus({ preventScroll: true });
      $("pick-status").textContent =
        `Tonight’s pick: ${movie.title} (${movie.year}).`;
    }
  }
  function showMovie(id) {
    if (busy) return;
    descriptionExpanded = false;
    state.currentId = id;
    save();
    if (location.hash !== "#discover") location.hash = "discover";
    else render();
    window.scrollTo({
      top: 0,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  function toggleSaved(id) {
    if (!movieById.has(id) || busy) return;
    const exists = state.saved.includes(id);
    mutate(
      exists ? "Removed from saved movies." : "Saved for another night.",
      () => {
        state.saved = exists
          ? state.saved.filter((value) => value !== id)
          : [id, ...state.saved];
      },
    );
  }
  function toggleWatched() {
    const movie = currentMovie();
    if (!movie || busy) return;
    const exists = state.history.includes(movie.id);
    mutate(
      exists
        ? "Removed from watched history."
        : `${movie.title} marked watched.`,
      () => {
        state.history = exists
          ? state.history.filter((id) => id !== movie.id)
          : [movie.id, ...state.history];
      },
    );
  }
  function navigate() {
    const view = location.hash.slice(1);
    activeView = ["discover", "excluded", "library"].includes(view)
      ? view
      : "discover";
    for (const name of ["discover", "excluded", "library"])
      $(`view-${name}`).hidden = name !== activeView;
    document.querySelectorAll("[data-view]").forEach((link) => {
      if (link.dataset.view === activeView)
        link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    render();
  }
  function confirmClear() {
    const watched = libraryTab === "watched",
      key = watched ? "history" : "picks";
    $("confirm-title").textContent = watched
      ? "Clear watched history?"
      : "Clear pick history?";
    $("confirm-description").textContent = watched
      ? "This removes your watched markers. Saved movies and exclusions stay as they are."
      : "Previously picked films can appear again. Your watched movies, saved list, and exclusions stay as they are.";
    confirmAction = () =>
      mutate(
        watched ? "Watched history cleared." : "Pick history cleared.",
        () => {
          state[key] = [];
          if (key === "picks") state.currentId = null;
        },
      );
    $("confirm-dialog").showModal();
  }
  $("pick-movie").onclick = pickMovie;
  $("reveal-description").onclick = () => {
    if (!currentMovie() || busy) return;
    descriptionExpanded = !descriptionExpanded;
    renderDescriptionVisibility();
  };
  $("save-movie").onclick = () => toggleSaved(state.currentId);
  $("watch-movie").onclick = toggleWatched;
  $("undo-selection").onclick = () => {
    const movie = currentMovie();
    if (!movie || busy || !state.picks.includes(movie.id)) return;
    state.picks = state.picks.filter((id) => id !== movie.id);
    state.currentId = null;
    save();
    render();
    $("pick-status").textContent = "";
    $("pick-movie").focus({ preventScroll: true });
    announce(
      state.history.includes(movie.id)
        ? `Selection undone. ${movie.title} remains marked watched.`
        : `Selection undone. ${movie.title} is back in the pool.`,
    );
  };
  $("exclude-movie").onclick = () => {
    if (!currentMovie() || busy) return;
    exclusionTarget = state.currentId;
    $("exclude-dialog-title").textContent =
      `${currentMovie().title} (${currentMovie().year})`;
    $("exclude-category").value = "other";
    $("exclude-dialog").showModal();
  };
  $("cancel-exclude").onclick = () => $("exclude-dialog").close();
  $("exclude-dialog").addEventListener("close", () => {
    exclusionTarget = null;
  });
  $("confirm-exclude").onclick = () => {
    const movie = movieById.get(exclusionTarget);
    if (!movie) return;
    const category = $("exclude-category").value;
    $("exclude-dialog").close();
    mutate(`${movie.title} moved to Excluded.`, () => {
      state.customExcluded[movie.id] = {
        category,
        addedAt: new Date().toISOString(),
      };
      state.restored = state.restored.filter((id) => id !== movie.id);
      state.picks = state.picks.filter((id) => id !== movie.id);
      if (state.currentId === movie.id) state.currentId = null;
    });
    if (!currentMovie()) {
      $("pick-status").textContent = "";
      $("pick-movie").focus({ preventScroll: true });
    }
  };
  for (const key of ["decade", "runtime", "rating", "certificate"])
    $(`filter-${key}`).onchange = (event) => {
      state.filters[key] = event.target.value;
      syncPresets();
      save();
      renderCounts();
    };
  $("filter-platform").onchange = (event) => {
    state.filters.platform = event.target.value;
    save();
    renderCounts();
  };
  $("filter-country").onchange = (event) => {
    state.filters.country = event.target.value;
    syncPlatforms();
    save();
    renderCounts();
    renderStreamingMovie();
  };
  $("hide-picked").onchange = (event) => {
    state.filters.hidePicked = event.target.checked;
    save();
    renderCounts();
  };
  $("animate-picks").onchange = (event) => {
    state.animate = event.target.checked;
    save();
  };
  $("quality").onchange = (event) => {
    state.quality = event.target.value;
    save();
    renderCurrent();
  };
  $("reset-filters").onclick = () => {
    state.filters = {
      ...Core.defaultFilters(),
      country: state.filters.country,
    };
    syncFilters();
    save();
    renderCounts();
  };
  document.querySelectorAll("[data-preset]").forEach(
    (button) =>
      (button.onclick = () => {
        state.filters = {
          ...Core.defaultFilters(),
          hidePicked: state.filters.hidePicked,
          country: state.filters.country,
          platform: state.filters.platform,
        };
        if (button.dataset.preset === "quick") state.filters.runtime = "90";
        if (button.dataset.preset === "great") state.filters.rating = "8";
        if (button.dataset.preset === "classic")
          state.filters.decade = "classic";
        syncFilters();
        save();
        renderCounts();
      }),
  );
  $("reshuffle-pool").onclick = () => {
    state.filters.hidePicked = false;
    syncFilters();
    save();
    renderCounts();
    announce("Previous picks can appear again. Watched movies stay out.");
  };
  for (const id of ["excluded-search", "excluded-source", "excluded-sort"])
    $(id).addEventListener(id.endsWith("search") ? "input" : "change", () => {
      excludedPage = 1;
      selectedExclusions.clear();
      renderExcluded();
    });
  $("select-page").onclick = () => {
    const allSelected = visibleExclusions.every((movie) =>
      selectedExclusions.has(movie.id),
    );
    for (const movie of visibleExclusions)
      if (allSelected) selectedExclusions.delete(movie.id);
      else selectedExclusions.add(movie.id);
    renderExcluded();
  };
  $("restore-selected").onclick = () => restoreMovies([...selectedExclusions]);
  document.querySelectorAll("[data-library]").forEach(
    (button) =>
      (button.onclick = () => {
        libraryTab = button.dataset.library;
        libraryPage = 1;
        renderLibrary();
      }),
  );
  $("library-search").oninput = () => {
    libraryPage = 1;
    renderLibrary();
  };
  $("clear-history").onclick = confirmClear;
  $("cancel-confirm").onclick = () => $("confirm-dialog").close();
  $("accept-confirm").onclick = () => {
    $("confirm-dialog").close();
    confirmAction?.();
    confirmAction = null;
  };
  $("undo-action").onclick = () => {
    const action = undo;
    undo = null;
    action?.();
  };
  $("dismiss-toast").onclick = () => {
    $("toast").hidden = true;
  };
  $("export-data").onclick = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          { ...state, exportedAt: new Date().toISOString() },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `frame-collection-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce("Collection exported.");
  };
  document.addEventListener("keydown", (event) => {
    if (
      event.code !== "Space" ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      document.querySelector("dialog[open]")
    )
      return;
    if (
      /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(event.target.tagName) ||
      event.target.isContentEditable
    )
      return;
    if (activeView === "discover") {
      event.preventDefault();
      pickMovie();
    }
  });
  window.addEventListener("hashchange", navigate);
  // Keep collection changes consistent when the local page is open in two tabs.
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey && event.newValue && !busy) {
      try {
        state = Core.normalizeState(JSON.parse(event.newValue), movieById);
        syncFilters();
        render();
      } catch {
        /* Ignore malformed writes. */
      }
    }
  });
  addIcons();
  syncFilters();
  navigate();
  save();
})();
