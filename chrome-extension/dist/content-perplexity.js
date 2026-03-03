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

  // src/content-perplexity.ts
  function extractPerplexityQueryFromUrl() {
    const url = new URL(window.location.href);
    const qParam = url.searchParams.get("q");
    if (qParam && qParam.trim().length > 0) {
      return qParam.trim();
    }
    const pathParts = url.pathname.split("/");
    const searchIndex = pathParts.indexOf("search");
    if (searchIndex !== -1 && pathParts[searchIndex + 1]) {
      const slug = pathParts[searchIndex + 1];
      const slugParts = slug.split("-");
      let queryEndIndex = slugParts.length;
      for (let i = slugParts.length - 1; i >= 0; i--) {
        const part = slugParts[i];
        if (/[0-9A-Z]/.test(part) && part.length > 4) {
          queryEndIndex = i;
          break;
        }
      }
      const queryWords = slugParts.slice(0, queryEndIndex);
      if (queryWords.length === 0) return null;
      return queryWords.join(" ");
    }
    return null;
  }
  async function captureQuery(query, context) {
    const cleaned = query.trim();
    if (!cleaned || cleaned.length < 3) return;
    const entry = {
      type: "search",
      content: cleaned,
      source: "perplexity",
      timestamp: Date.now()
    };
    await appendEntry(entry);
    console.log(`[LearnPulse] Captured Perplexity ${context}: "${cleaned}"`);
  }
  var capturedFollowUps = /* @__PURE__ */ new Set();
  function scanForUserQueries() {
    const QUERY_SELECTORS = [
      '[data-testid="user-query"]',
      // Current version
      ".query-text",
      // Older version
      "[data-cke-widget-wrapper] .text",
      // CKEditor-based version
      "p.break-words.font-display"
      // Another known selector
    ];
    for (const selector of QUERY_SELECTORS) {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => {
        const text = el.textContent?.trim();
        if (text && text.length >= 3 && !capturedFollowUps.has(text)) {
          capturedFollowUps.add(text);
          captureQuery(text, "followup");
        }
      });
    }
  }
  function watchForFollowUpQuestions() {
    let scanTimeout = null;
    const observer = new MutationObserver(() => {
      if (scanTimeout) clearTimeout(scanTimeout);
      scanTimeout = setTimeout(scanForUserQueries, 500);
    });
    observer.observe(document.body, {
      childList: true,
      // Watch for elements being added/removed
      subtree: true
      // Watch all descendants (not just direct children)
    });
  }
  var initialQuery = extractPerplexityQueryFromUrl();
  if (initialQuery) {
    captureQuery(initialQuery, "url");
  }
  scanForUserQueries();
  watchForFollowUpQuestions();
})();
//# sourceMappingURL=content-perplexity.js.map
