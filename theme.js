// Run before the stylesheet so a saved dark theme never paints a light page.
(() => {
  "use strict";
  const key = "frame:theme:v1";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const validPreference = (value) =>
    value === "dark" || value === "light" ? value : null;
  let preference = null;
  try {
    preference = validPreference(localStorage.getItem(key));
  } catch {
    // The toggle still works when browser storage is unavailable.
  }

  function applyTheme() {
    const theme = preference || (system.matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content =
      theme === "dark" ? "#17191c" : "#f8f6f1";
    const button = document.getElementById("theme-toggle");
    if (button) {
      const action = theme === "dark" ? "Light mode" : "Dark mode";
      document.getElementById("theme-label").textContent = action;
      button.setAttribute("aria-label", `Switch to ${action.toLowerCase()}`);
      button.title = `Switch to ${action.toLowerCase()}`;
    }
  }

  applyTheme();
  document.addEventListener("DOMContentLoaded", () => {
    applyTheme();
    document.getElementById("theme-toggle").addEventListener("click", () => {
      preference =
        document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(key, preference);
      } catch {
        // Keep the chosen theme for this visit.
      }
      applyTheme();
    });
  });
  system.addEventListener("change", () => {
    if (!preference) applyTheme();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) {
      preference = validPreference(event.newValue);
      applyTheme();
    }
  });
})();
