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

// src/background.ts
var LEARNPULSE_URL = "http://localhost:3000";
var HISTORY_MAX_RESULTS = 300;
var ALARM_MIDNIGHT_RESET = "learnpulse_midnight_reset";
var ALARM_EVENING_REMINDER = "learnpulse_evening_reminder";
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("[LearnPulse] Extension installed/updated:", details.reason);
  const storage = await readStorage();
  await chrome.storage.local.set({ [STORAGE_KEY]: storage });
  await backfillHistory();
  await setupAlarms();
  await updateBadge();
});
chrome.runtime.onStartup.addListener(async () => {
  console.log("[LearnPulse] Extension started");
  await readStorage();
  await setupAlarms();
  await updateBadge();
  await backfillHistory();
});
async function backfillHistory() {
  const todayStart = getTodayStartTimestamp();
  let historyItems;
  try {
    historyItems = await chrome.history.search({
      text: "",
      // No text filter — get everything
      startTime: todayStart,
      // From midnight today
      maxResults: HISTORY_MAX_RESULTS
      // Cap to avoid overwhelming storage
    });
  } catch (error) {
    console.error("[LearnPulse] Failed to read history:", error);
    return;
  }
  console.log(`[LearnPulse] History backfill: found ${historyItems.length} items`);
  let addedCount = 0;
  for (const item of historyItems) {
    if (!item.url) continue;
    if (!item.url.startsWith("http")) continue;
    if (isSearchResultPage(item.url)) continue;
    const entry = {
      type: "visit",
      content: item.url,
      source: "history",
      timestamp: item.lastVisitTime ?? Date.now(),
      title: item.title || void 0
    };
    await appendEntry(entry);
    addedCount++;
  }
  console.log(`[LearnPulse] Added ${addedCount} history entries to storage`);
  await updateBadge();
}
function getTodayStartTimestamp() {
  const now = /* @__PURE__ */ new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return midnight.getTime();
}
function isSearchResultPage(url) {
  const SEARCH_PATTERNS = [
    "google.com/search",
    "bing.com/search",
    "duckduckgo.com/?q=",
    "perplexity.ai/search",
    "search.yahoo.com/search"
  ];
  return SEARCH_PATTERNS.some((pattern) => url.includes(pattern));
}
async function updateBadge() {
  const storage = await readStorage();
  const count = storage.entries.length;
  if (count === 0) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  const badgeText = count > 99 ? "99+" : String(count);
  await chrome.action.setBadgeText({ text: badgeText });
  await chrome.action.setBadgeBackgroundColor({ color: "#4F46E5" });
}
async function setupAlarms() {
  const existingAlarms = await chrome.alarms.getAll();
  const alarmNames = existingAlarms.map((a) => a.name);
  if (!alarmNames.includes(ALARM_MIDNIGHT_RESET)) {
    const nextMidnight = getNextMidnight();
    chrome.alarms.create(ALARM_MIDNIGHT_RESET, {
      when: nextMidnight,
      periodInMinutes: 24 * 60
      // Repeat every 24 hours
    });
    console.log("[LearnPulse] Midnight reset alarm scheduled");
  }
  if (!alarmNames.includes(ALARM_EVENING_REMINDER)) {
    const next9pm = getNext9pm();
    chrome.alarms.create(ALARM_EVENING_REMINDER, {
      when: next9pm,
      periodInMinutes: 24 * 60
      // Repeat every 24 hours
    });
    console.log("[LearnPulse] Evening reminder alarm scheduled");
  }
}
function getNextMidnight() {
  const now = /* @__PURE__ */ new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return midnight.getTime();
}
function getNext9pm() {
  const now = /* @__PURE__ */ new Date();
  const ninepm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0, 0);
  if (ninepm.getTime() <= Date.now()) {
    ninepm.setDate(ninepm.getDate() + 1);
  }
  return ninepm.getTime();
}
chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log("[LearnPulse] Alarm fired:", alarm.name);
  if (alarm.name === ALARM_MIDNIGHT_RESET) {
    await handleMidnightReset();
  } else if (alarm.name === ALARM_EVENING_REMINDER) {
    await handleEveningReminder();
  }
});
async function handleMidnightReset() {
  const freshStorage = {
    date: getTodayString(),
    entries: []
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: freshStorage });
  await updateBadge();
  console.log("[LearnPulse] Daily reset complete");
}
async function handleEveningReminder() {
  const storage = await readStorage();
  const count = storage.entries.length;
  if (count === 0) return;
  chrome.notifications.create("learnpulse_reminder", {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "LearnPulse \u{1F9E0}",
    message: `You captured ${count} learning signals today. Ready to generate your post?`,
    buttons: [{ title: "Analyze Now" }],
    priority: 1
  });
}
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === "learnpulse_reminder") {
    chrome.tabs.create({ url: "http://localhost:3000" });
    chrome.notifications.clear(notificationId);
  }
});
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId === "learnpulse_reminder" && buttonIndex === 0) {
    chrome.tabs.create({ url: "http://localhost:3000" });
    chrome.notifications.clear(notificationId);
  }
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url?.startsWith(LEARNPULSE_URL)) return;
  const storage = await readStorage();
  if (!storage.entries.length) return;
  const text = formatEntriesAsText(storage.entries);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      // This inline function runs INSIDE the LearnPulse page's JS context.
      // It receives the text and lsKey as serialized arguments from background.
      // It cannot import anything — it must be self-contained.
      func: (textToInject, lsKey) => {
        try {
          localStorage.setItem(lsKey, JSON.stringify({ text: textToInject, savedAt: Date.now() }));
        } catch (e) {
        }
        window.dispatchEvent(new CustomEvent("learnpulse:inject", {
          detail: { text: textToInject }
        }));
      },
      args: [text, WEB_APP_LS_KEY],
      world: "MAIN"
    });
    console.log("[LearnPulse] Auto-injected", storage.entries.length, "entries into LearnPulse tab on load");
  } catch (error) {
    console.log("[LearnPulse] Could not auto-inject into tab (may be normal):", error);
  }
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    await updateBadge();
  }
});
//# sourceMappingURL=background.js.map
