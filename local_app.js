(() => {
  const movies = Array.isArray(window.MOVIES) ? window.MOVIES : [];
  const movieById = new Map(movies.map((movie) => [movie.id, movie]));
  const storageKey = "random-movie-generator:local:v1";

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

  const defaultState = { history: [] };

  const createPill = (label, tone) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    if (tone) {
      pill.dataset.tone = tone;
    }
    pill.textContent = label;
    return pill;
  };

  const normalizeHistory = (history) => {
    if (!Array.isArray(history)) {
      return [];
    }
    const seen = new Set();
    const cleaned = [];
    for (const rawId of history) {
      const id = Number(rawId);
      if (!Number.isInteger(id) || !movieById.has(id) || seen.has(id)) {
        continue;
      }
      cleaned.push(id);
      seen.add(id);
    }
    return cleaned;
  };

  const loadState = () => {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return { ...defaultState };
    }
    try {
      const parsed = JSON.parse(raw);
      return { history: normalizeHistory(parsed.history) };
    } catch (error) {
      return { ...defaultState };
    }
  };

  const saveState = (state) => {
    localStorage.setItem(storageKey, JSON.stringify(state));
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

  const state = loadState();
  let selectedIds = new Set(state.history);

  const updateCounts = () => {
    const total = movies.length;
    const remaining = total - selectedIds.size;
    elements.totalCount.textContent = total.toLocaleString();
    elements.remainingCount.textContent = remaining.toLocaleString();
    elements.historyCount.textContent = `${selectedIds.size} selected`;
    elements.generateButton.disabled = remaining === 0;
    return remaining;
  };

  const renderStatus = (remaining) => {
    if (!movies.length) {
      elements.status.textContent =
        "Movie data is missing. Run scripts/build_data.py.";
      return;
    }
    if (remaining === 0) {
      elements.status.textContent =
        "All movies have been selected. Clear history to start over.";
      return;
    }
    if (selectedIds.size === 0) {
      elements.status.textContent =
        "Click Generate to pick a random movie from the list.";
      return;
    }
    elements.status.textContent = `${remaining} movies left to pick.`;
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

  const pickRandomMovie = () => {
    const available = movies.filter((movie) => !selectedIds.has(movie.id));
    if (!available.length) {
      renderStatus(0);
      return;
    }
    const choice = available[secureRandomIndex(available.length)];
    state.history.unshift(choice.id);
    selectedIds.add(choice.id);
    saveState(state);
    renderCurrent(choice, true);
    renderHistory(state.history);
    const remaining = updateCounts();
    renderStatus(remaining);
  };

  const clearHistory = () => {
    if (!state.history.length) {
      return;
    }
    const confirmed = window.confirm(
      "Clear saved picks and allow all movies to be selected again?"
    );
    if (!confirmed) {
      return;
    }
    state.history = [];
    selectedIds = new Set();
    saveState(state);
    updateUI();
  };

  const updateUI = () => {
    const remaining = updateCounts();
    const currentMovie = state.history.length
      ? movieById.get(state.history[0])
      : null;
    renderCurrent(currentMovie, false);
    renderHistory(state.history);
    renderStatus(remaining);
  };

  if (!movies.length) {
    elements.status.textContent =
      "Movie data not found. Run scripts/build_data.py.";
    elements.generateButton.disabled = true;
  } else {
    updateUI();
  }

  elements.generateButton.addEventListener("click", pickRandomMovie);
  elements.clearButton.addEventListener("click", clearHistory);
})();
