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
      const script = document.createElement("script");
      script.textContent = `
      (function() {
        try {
          var stored = localStorage.getItem(${JSON.stringify(lsKey)});
          if (!stored) return;
          var data = JSON.parse(stored);
          if (!data || !data.text) return;
          window.dispatchEvent(new CustomEvent('learnpulse:inject', {
            detail: { text: data.text }
          }));
          console.log('[LearnPulse] Content script (main world): dispatched learnpulse:inject');
        } catch(e) {
          console.warn('[LearnPulse] Content script (main world): event dispatch failed', e);
        }
      })();
    `;
      document.head.appendChild(script);
      script.remove();
    } catch (e) {
      console.warn("[LearnPulse] Content script: could not dispatch CustomEvent:", e);
    }
  })();
})();
//# sourceMappingURL=content-learnpulse.js.map
