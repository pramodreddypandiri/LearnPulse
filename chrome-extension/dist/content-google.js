"use strict";
(() => {
  // src/types.ts
  var STORAGE_KEY = "learnpulse_daily";
  function getTodayString() {
    return (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  }
  async function readStorage() {
    const today = getTodayString();
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    if (!stored || stored.date !== today) {
      return { date: today, entries: [] };
    }
    return stored;
  }
  async function appendEntry(entry) {
    const storage = await readStorage();
    const ONE_HOUR_MS = 60 * 60 * 1e3;
    const isDuplicate = storage.entries.some(
      (existing) => existing.content === entry.content && Math.abs(existing.timestamp - entry.timestamp) < ONE_HOUR_MS
    );
    if (isDuplicate) return;
    storage.entries.push(entry);
    await chrome.storage.local.set({ [STORAGE_KEY]: storage });
  }

  // src/content-google.ts
  function extractGoogleQuery() {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("q");
    if (!query || query.trim().length === 0) return null;
    return query.trim().replace(/\s+/g, " ");
  }
  async function captureCurrentSearch() {
    const query = extractGoogleQuery();
    if (!query) return;
    if (query.length < 3) return;
    const entry = {
      type: "search",
      content: query,
      source: "google",
      timestamp: Date.now()
    };
    await appendEntry(entry);
    console.log(`[LearnPulse] Captured Google search: "${query}"`);
  }
  var lastCapturedUrl = "";
  function watchForNavigation() {
    setInterval(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastCapturedUrl && currentUrl.includes("google.com/search")) {
        lastCapturedUrl = currentUrl;
        captureCurrentSearch();
      }
    }, 1500);
  }
  lastCapturedUrl = window.location.href;
  captureCurrentSearch();
  watchForNavigation();
})();
//# sourceMappingURL=content-google.js.map
