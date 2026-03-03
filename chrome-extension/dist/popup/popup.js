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

  // src/popup/popup.ts
  var LEARNPULSE_URL = "http://localhost:3000";
  document.addEventListener("DOMContentLoaded", async () => {
    const headerDate = document.getElementById("header-date");
    if (headerDate) {
      headerDate.textContent = formatDate(/* @__PURE__ */ new Date());
    }
    await renderEntries();
    attachEventListeners();
  });
  async function renderEntries() {
    const storage = await readStorage();
    const entries = storage.entries;
    const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
    const searchCount = entries.filter((e) => e.type === "search").length;
    const urlCount = entries.filter((e) => e.type === "visit").length;
    if (entries.length === 0) {
      show("empty-state");
      hide("stats-bar");
      hide("entries-section");
      hide("actions");
      return;
    }
    hide("empty-state");
    show("stats-bar");
    show("entries-section");
    show("actions");
    setText("stat-searches", String(searchCount));
    setText("stat-urls", String(urlCount));
    setText("stat-total", String(entries.length));
    const listEl = document.getElementById("entries-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    const preview = sorted.slice(0, 10);
    for (const entry of preview) {
      listEl.appendChild(createEntryElement(entry));
    }
    if (entries.length > 10) {
      const moreEl = document.createElement("div");
      moreEl.style.cssText = "padding: 6px 4px; color: #9ca3af; font-size: 11px; text-align: center;";
      moreEl.textContent = `+${entries.length - 10} more entries`;
      listEl.appendChild(moreEl);
    }
  }
  function createEntryElement(entry) {
    const item = document.createElement("div");
    item.className = "entry-item";
    const icon = entry.type === "search" ? "\u{1F50D}" : "\u{1F517}";
    const sourceClass = `source-${entry.source}`;
    const sourceLabel = entry.source === "perplexity" ? "Perplx" : entry.source;
    const displayContent = entry.type === "visit" && entry.title ? entry.title : entry.content;
    const timeAgo = formatRelativeTime(entry.timestamp);
    item.innerHTML = `
    <span class="entry-icon">${icon}</span>
    <span class="entry-source">
      <span class="source-badge ${sourceClass}">${sourceLabel}</span>
    </span>
    <span class="entry-content" title="${escapeHtml(entry.content)}">${escapeHtml(truncate(displayContent, 50))}</span>
    <span class="entry-time">${timeAgo}</span>
  `;
    return item;
  }
  function attachEventListeners() {
    document.getElementById("btn-open-app")?.addEventListener("click", handleOpenLearnPulse);
    document.getElementById("btn-clear")?.addEventListener("click", handleClear);
  }
  async function handleOpenLearnPulse() {
    const openBtn = document.getElementById("btn-open-app");
    const openLabel = document.getElementById("btn-open-app-label");
    if (openBtn) openBtn.disabled = true;
    if (openLabel) openLabel.textContent = "Opening...";
    showStatus("Opening LearnPulse...", "default");
    const storage = await readStorage();
    if (storage.entries.length === 0) {
      await openOrFocusLearnPulseTab();
      window.close();
      return;
    }
    const formattedText = formatEntriesAsText(storage.entries);
    try {
      const tab = await openOrFocusLearnPulseTab();
      if (!tab.id) {
        throw new Error("Could not open LearnPulse tab");
      }
      showStatus("Waiting for LearnPulse to load...", "default");
      await waitForTabLoad(tab.id);
      showStatus("Sending your captures...", "default");
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: injectHistoryIntoWebApp,
        args: [formattedText, WEB_APP_LS_KEY],
        world: "MAIN"
      });
      setTimeout(() => window.close(), 800);
    } catch (error) {
      console.error("[LearnPulse Popup] Failed to inject data:", error);
      showStatus(
        "Failed to open LearnPulse. Make sure it's running at localhost:3000",
        "error"
      );
      if (openBtn) openBtn.disabled = false;
      if (openLabel) openLabel.textContent = "Open LearnPulse";
    }
  }
  async function openOrFocusLearnPulseTab() {
    const existingTabs = await chrome.tabs.query({ url: `${LEARNPULSE_URL}/*` });
    if (existingTabs.length > 0 && existingTabs[0].id) {
      await chrome.tabs.update(existingTabs[0].id, { active: true });
      if (existingTabs[0].windowId) {
        await chrome.windows.update(existingTabs[0].windowId, { focused: true });
      }
      return existingTabs[0];
    }
    const tab = await chrome.tabs.create({ url: LEARNPULSE_URL });
    return tab;
  }
  async function waitForTabLoad(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Tab load timeout"));
      }, 1e4);
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 1500);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
  function injectHistoryIntoWebApp(text, lsKey) {
    const DATA_KEY = "__learnpulseInjectData";
    const EVENT_NAME = "learnpulse:inject";
    try {
      localStorage.setItem(lsKey, JSON.stringify({ text, savedAt: Date.now() }));
    } catch (e) {
    }
    window[DATA_KEY] = { text };
    function tryDispatch() {
      if (!(DATA_KEY in window)) return;
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { text } }));
    }
    tryDispatch();
    setTimeout(tryDispatch, 800);
    setTimeout(tryDispatch, 2e3);
    setTimeout(tryDispatch, 4e3);
    console.log("[LearnPulse Extension] Injected history data into web app (world: MAIN)");
  }
  async function handleClear() {
    const confirmed = confirm(
      "Clear all of today's captured history?\nThis can't be undone."
    );
    if (!confirmed) return;
    await chrome.storage.local.set({
      [STORAGE_KEY]: { date: getTodayString(), entries: [] }
    });
    await renderEntries();
    showStatus("Today's history cleared.", "default");
  }
  function show(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = "";
  }
  function hide(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function showStatus(message, type) {
    const el = document.getElementById("status-message");
    if (!el) return;
    el.textContent = message;
    el.className = `status-message visible ${type === "default" ? "" : type}`;
  }
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function truncate(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 1) + "\u2026";
  }
  function formatDate(date) {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric"
    });
  }
  function formatRelativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 6e4);
    const hours = Math.floor(diff / 36e5);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
})();
//# sourceMappingURL=popup.js.map
