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
  var WEB_APP_LS_KEY = "learnpulse_entries";
  function formatEntriesAsText(entries) {
    const searches = entries.filter((e) => e.type === "search").sort((a, b) => a.timestamp - b.timestamp).map((e) => e.content);
    const urls = entries.filter((e) => e.type === "visit").sort((a, b) => a.timestamp - b.timestamp).map((e) => e.content);
    return [...searches, ...urls].filter(Boolean).join("\n");
  }

  // src/content-learnpulse.ts
  (async () => {
    const storage = await readStorage();
    if (!storage.entries.length) {
      console.log("[LearnPulse] Content script: no entries for today, skipping inject");
      return;
    }
    const text = formatEntriesAsText(storage.entries);
    const lsKey = WEB_APP_LS_KEY;
    try {
      localStorage.setItem(lsKey, JSON.stringify({ text, savedAt: Date.now() }));
      console.log(`[LearnPulse] Content script: wrote ${storage.entries.length} entries to localStorage['${lsKey}']`);
    } catch (e) {
      console.error("[LearnPulse] Content script: failed to write localStorage:", e);
      return;
    }
    try {
      window.postMessage(
        { type: "learnpulse:inject", text },
        window.location.origin
        // only the same-origin page receives this
      );
      console.log("[LearnPulse] Content script: sent postMessage to page");
    } catch (e) {
      console.warn("[LearnPulse] Content script: postMessage failed:", e);
    }
  })();
  window.addEventListener("message", async (e) => {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type !== "learnpulse:clear") return;
    try {
      const clearedStorage = { date: getTodayString(), entries: [] };
      await chrome.storage.local.set({ [STORAGE_KEY]: clearedStorage });
      try {
        localStorage.removeItem(WEB_APP_LS_KEY);
      } catch {
      }
      console.log("[LearnPulse] Content script: cleared chrome.storage entries on user request");
    } catch (err) {
      console.error("[LearnPulse] Content script: failed to clear chrome.storage:", err);
    }
  });
})();
//# sourceMappingURL=content-learnpulse.js.map
