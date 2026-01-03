(() => {
  const movies = Array.isArray(window.MOVIES) ? window.MOVIES : [];
  const movieById = new Map(movies.map((movie) => [movie.id, movie]));

  const SUPABASE_URL = "https://chusgjeewoyufqrdieuk.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_2J_q1q51tb_MW8_xGwcRtg_ejTPofx5";

  const supabaseClient =
    window.supabase && typeof window.supabase.createClient === "function"
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null;

  const elements = {
    totalCount: document.getElementById("total-count"),
    remainingCount: document.getElementById("remaining-count"),
    historyCount: document.getElementById("history-count"),
    status: document.getElementById("status"),
    movieTitle: document.getElementById("movie-title"),
    movieSub: document.getElementById("movie-sub"),
    moviePills: document.getElementById("movie-pills"),
    historyList: document.getElementById("history-list"),
    historyEmpty: document.getElementById("history-empty"),
    currentCard: document.getElementById("current-card"),
    generateButton: document.querySelector("[data-action='generate']"),
    clearButton: document.querySelector("[data-action='clear']"),
  };

  const state = {
    history: [],
    syncing: false,
    lastError: null,
    lastPickedId: null,
  };

  let selectedIds = new Set();

  const createPill = (label, tone) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    if (tone) {
      pill.dataset.tone = tone;
    }
    pill.textContent = label;
    return pill;
  };

  const secureRandomIndex = (max) => {
    if (max <= 0) {
      return 0;
    }
    if (window.crypto && window.crypto.getRandomValues) {
      const range = 0xffffffff;
      const bucketSize = Math.floor((range + 1) / max) * max;
      const values = new Uint32Array(1);
      let value = 0;
      do {
        window.crypto.getRandomValues(values);
        value = values[0];
      } while (value >= bucketSize);
      return value % max;
    }
    return Math.floor(Math.random() * max);
  };

  const isDuplicateError = (error) =>
    error && (error.code === "23505" || /duplicate key/i.test(error.message));

  const formatSupabaseError = (error) => {
    if (!error) {
      return "Unexpected error.";
    }
    if (/relation .*picks.* does not exist/i.test(error.message)) {
      return "Supabase table not found. Run supabase.sql in your Supabase SQL editor.";
    }
    return `Supabase error: ${error.message}`;
  };

  const applyHistory = (ids) => {
    const cleaned = [];
    const seen = new Set();
    ids.forEach((rawId) => {
      const id = Number(rawId);
      if (!Number.isInteger(id) || !movieById.has(id) || seen.has(id)) {
        return;
      }
      cleaned.push(id);
      seen.add(id);
    });
    state.history = cleaned;
    selectedIds = new Set(cleaned);
  };

  const updateCounts = () => {
    const total = movies.length;
    const remaining = total - selectedIds.size;
    elements.totalCount.textContent = total.toLocaleString();
    elements.remainingCount.textContent = remaining.toLocaleString();
    elements.historyCount.textContent = `${state.history.length} selected`;
    elements.generateButton.disabled =
      !supabaseClient || state.syncing || remaining === 0;
    elements.clearButton.disabled =
      !supabaseClient || state.syncing || state.history.length === 0;
    return remaining;
  };

  const renderStatus = (remaining) => {
    if (!movies.length) {
      elements.status.textContent =
        "Movie data is missing. Run scripts/build_data.py.";
      return;
    }
    if (!supabaseClient) {
      elements.status.textContent =
        "Supabase client not available. Check the script include.";
      return;
    }
    if (state.lastError) {
      elements.status.textContent = state.lastError;
      return;
    }
    if (state.syncing) {
      elements.status.textContent = "Syncing shared history...";
      return;
    }
    if (remaining === 0) {
      elements.status.textContent =
        "All movies have been selected globally. Clear history to start over.";
      return;
    }
    if (selectedIds.size === 0) {
      elements.status.textContent =
        "No shared picks yet. Click Generate to pick the first movie.";
      return;
    }
    elements.status.textContent = `${remaining} movies left globally.`;
  };

  const renderCurrent = (movie, isFresh) => {
    if (!movie) {
      elements.movieTitle.textContent = "No movie selected yet";
      elements.movieSub.textContent = "Click Generate to pick a movie.";
      elements.moviePills.innerHTML = "";
      return;
    }

    elements.movieTitle.textContent = movie.title;
    elements.movieSub.textContent = `#${movie.id} | ${movie.year}`;
    elements.moviePills.innerHTML = "";
    elements.moviePills.appendChild(createPill(`Runtime ${movie.runtime}`));
    elements.moviePills.appendChild(
      createPill(`Certificate ${movie.certificate || "N/A"}`)
    );
    elements.moviePills.appendChild(
      createPill(
        `Metascore ${movie.metascore !== null ? movie.metascore : "N/A"}`,
        movie.metascore !== null ? "accent" : null
      )
    );
    elements.moviePills.appendChild(
      createPill(`IMDb ${movie.imdb_rating.toFixed(1)}`, "accent")
    );
    elements.moviePills.appendChild(createPill(`Votes ${movie.votes}`));

    if (isFresh) {
      elements.currentCard.classList.remove("is-fresh");
      void elements.currentCard.offsetWidth;
      elements.currentCard.classList.add("is-fresh");
    }
  };

  const renderHistory = (history) => {
    elements.historyList.innerHTML = "";
    if (!history.length) {
      elements.historyEmpty.style.display = "block";
      return;
    }
    elements.historyEmpty.style.display = "none";
    history.forEach((id) => {
      const movie = movieById.get(id);
      if (!movie) {
        return;
      }
      const item = document.createElement("li");
      item.className = "history-item";

      const idBadge = document.createElement("div");
      idBadge.className = "history-id";
      idBadge.textContent = `#${movie.id}`;

      const title = document.createElement("div");
      title.className = "history-title";
      title.textContent = movie.title;

      const meta = document.createElement("div");
      meta.className = "history-meta";
      const certificate = movie.certificate || "N/A";
      const metascore =
        movie.metascore !== null ? `Metascore ${movie.metascore}` : "Metascore N/A";
      meta.textContent = `${movie.year} | ${movie.runtime} | ${certificate} | IMDb ${movie.imdb_rating.toFixed(
        1
      )} | ${metascore} | Votes ${movie.votes}`;

      item.appendChild(idBadge);
      item.appendChild(title);
      item.appendChild(meta);
      elements.historyList.appendChild(item);
    });
  };

  const updateUI = () => {
    const remaining = updateCounts();
    const currentMovie = state.history.length
      ? movieById.get(state.history[0])
      : null;
    const isFresh =
      state.lastPickedId &&
      currentMovie &&
      currentMovie.id === state.lastPickedId;
    renderCurrent(currentMovie, isFresh);
    if (isFresh) {
      state.lastPickedId = null;
    }
    renderHistory(state.history);
    renderStatus(remaining);
  };

  const fetchHistory = async () => {
    const { data, error } = await supabaseClient
      .from("picks")
      .select("id, picked_at")
      .order("picked_at", { ascending: false });

    if (error) {
      return { ok: false, error };
    }
    return { ok: true, ids: data.map((row) => row.id) };
  };

  const syncHistory = async ({ silent = false } = {}) => {
    if (!supabaseClient || state.syncing) {
      return false;
    }
    state.syncing = true;
    if (!silent) {
      state.lastError = null;
    }
    updateUI();

    const result = await fetchHistory();
    if (!result.ok) {
      if (!silent) {
        state.lastError = formatSupabaseError(result.error);
      }
      state.syncing = false;
      updateUI();
      return false;
    }

    applyHistory(result.ids);
    state.syncing = false;
    updateUI();
    return true;
  };

  const pickRandomMovie = async () => {
    if (state.syncing || !supabaseClient) {
      return;
    }
    state.syncing = true;
    state.lastError = null;
    updateUI();

    const latest = await fetchHistory();
    if (!latest.ok) {
      state.lastError = formatSupabaseError(latest.error);
      state.syncing = false;
      updateUI();
      return;
    }
    applyHistory(latest.ids);

    const availableIds = movies
      .filter((movie) => !selectedIds.has(movie.id))
      .map((movie) => movie.id);

    if (!availableIds.length) {
      state.syncing = false;
      updateUI();
      return;
    }

    let pickedId = null;
    while (availableIds.length) {
      const idx = secureRandomIndex(availableIds.length);
      const id = availableIds[idx];
      const { error } = await supabaseClient.from("picks").insert({ id });
      if (!error) {
        pickedId = id;
        break;
      }
      if (isDuplicateError(error)) {
        availableIds.splice(idx, 1);
        continue;
      }
      state.lastError = formatSupabaseError(error);
      break;
    }

    if (pickedId) {
      state.lastPickedId = pickedId;
    }

    const after = await fetchHistory();
    if (after.ok) {
      applyHistory(after.ids);
    } else {
      state.lastError = formatSupabaseError(after.error);
    }

    state.syncing = false;
    updateUI();
  };

  const clearHistory = async () => {
    if (state.syncing || !supabaseClient || !state.history.length) {
      return;
    }
    const confirmed = window.confirm(
      "Clear shared picks and allow all movies to be selected again?"
    );
    if (!confirmed) {
      return;
    }

    state.syncing = true;
    state.lastError = null;
    updateUI();

    const { error } = await supabaseClient
      .from("picks")
      .delete()
      .neq("id", -1);

    if (error) {
      state.lastError = formatSupabaseError(error);
    }

    const latest = await fetchHistory();
    if (latest.ok) {
      applyHistory(latest.ids);
    } else {
      state.lastError = formatSupabaseError(latest.error);
    }

    state.syncing = false;
    updateUI();
  };

  const startAutoRefresh = () => {
    window.setInterval(() => {
      if (!state.syncing) {
        syncHistory({ silent: true });
      }
    }, 20000);
  };

  if (!movies.length) {
    state.lastError = "Movie data not found. Run scripts/build_data.py.";
  } else if (!supabaseClient) {
    state.lastError =
      "Supabase client not available. Check the script include.";
  }

  elements.generateButton.addEventListener("click", pickRandomMovie);
  elements.clearButton.addEventListener("click", clearHistory);

  updateUI();

  if (supabaseClient) {
    syncHistory();
    startAutoRefresh();
  }
})();
