// ══════════════════════════════════════════════════════════════════════
// Background Service Worker
// chrome-extension/src/background.ts
//
// PURPOSE:
//   The "brain" of the extension that runs in Chrome's background.
//   It handles operations that no content script or popup can do:
//
//   1. HISTORY BACKFILL — On startup, reads today's visited URLs from
//      chrome.history API and saves them to storage as 'visit' entries.
//      This catches any browsing that happened before the extension was
//      installed, or before the content scripts loaded.
//
//   2. BADGE UPDATE — Keeps the extension icon badge showing the count
//      of today's captured entries. This gives the user a at-a-glance
//      indicator ("47") that learning is being tracked.
//
//   3. DAILY ALARMS — Sets up two alarms:
//      a. Midnight reset: clear yesterday's entries
//      b. 9pm reminder: "Ready to generate your learning post?"
//
//   4. NOTIFICATIONS — Shows the 9pm browser notification that links
//      the user back to the extension popup.
//
// WHY A SERVICE WORKER (not a background page)?
//   Manifest V3 replaced persistent background pages with service workers.
//   Service workers start when needed (event received) and stop when idle.
//   This is more battery and memory efficient, but it means:
//   - NO in-memory state — everything must be in chrome.storage
//   - We can't rely on setInterval — use chrome.alarms instead
//   - The service worker might not be running when content scripts fire
//     (content scripts talk to storage directly, not via message passing)
//
// HOW TO DEBUG THE SERVICE WORKER:
//   Open chrome://extensions → find LearnPulse → click "Service Worker"
//   This opens the DevTools console for the background script.
// ══════════════════════════════════════════════════════════════════════

import { readStorage, appendEntry, getTodayString, STORAGE_KEY, DailyStorage, CapturedEntry, formatEntriesAsText, WEB_APP_LS_KEY } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * The LearnPulse web app URL.
 * The onUpdated listener watches for this URL to auto-inject entries
 * whenever the tab loads or refreshes. Change this for production deploys.
 */
const LEARNPULSE_URL = 'http://localhost:3000';

/** How many days back to include in the history backfill */
const HISTORY_DAYS_BACK = 1; // Just today

/** Maximum number of URLs to fetch from chrome.history per backfill */
const HISTORY_MAX_RESULTS = 300;

/** Alarm name for midnight reset */
const ALARM_MIDNIGHT_RESET = 'learnpulse_midnight_reset';

/** Alarm name for the 9pm reminder notification */
const ALARM_EVENING_REMINDER = 'learnpulse_evening_reminder';

// ─── Extension Install / Update ───────────────────────────────────────────────

/**
 * Fires when the extension is first installed OR updated.
 *
 * This is the best place to:
 * 1. Backfill today's history (new install = no history captured yet)
 * 2. Set up recurring alarms (they persist even when SW is idle)
 * 3. Initialize storage with today's empty state
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[LearnPulse] Extension installed/updated:', details.reason);

  // Initialize storage for today if not already done
  const storage = await readStorage();
  await chrome.storage.local.set({ [STORAGE_KEY]: storage });

  // Backfill today's history from chrome.history API
  await backfillHistory();

  // Set up daily alarms
  await setupAlarms();

  // Update the badge immediately
  await updateBadge();
});

// ─── Startup ─────────────────────────────────────────────────────────────────

/**
 * Fires each time Chrome starts (or the extension is re-enabled after being disabled).
 *
 * The service worker doesn't persist between Chrome sessions, so alarms
 * need to be re-checked and re-created on startup.
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('[LearnPulse] Extension started');

  // Re-check and update today's storage (handles day change during Chrome restart)
  await readStorage(); // This also handles the daily reset via date comparison

  // Re-create alarms if they were cleared (Chrome sometimes clears alarms on update)
  await setupAlarms();

  // Update badge with today's count
  await updateBadge();

  // Backfill any history from the current browser session
  await backfillHistory();
});

// ─── History Backfill ─────────────────────────────────────────────────────────

/**
 * Reads today's visited URLs from chrome.history and saves them to storage.
 *
 * WHY BACKFILL?
 * Content scripts only capture searches from Google/Perplexity. But the
 * user also visits many educational URLs directly (documentation, GitHub repos,
 * Stack Overflow). The chrome.history API gives us all visited URLs.
 *
 * We only take URLs from today (not past days) to keep the learning signal
 * relevant and focused on the current day's activity.
 *
 * HOW chrome.history.search() WORKS:
 * - Returns HistoryItem[] for URLs visited within the time range
 * - Each HistoryItem has: id, url, title, lastVisitTime, visitCount
 * - 'text' parameter filters by URL/title matching — empty string = all URLs
 * - We request MAX_RESULTS URLs and sort by most recent first
 */
async function backfillHistory(): Promise<void> {
  const todayStart = getTodayStartTimestamp();

  let historyItems: chrome.history.HistoryItem[];
  try {
    historyItems = await chrome.history.search({
      text: '',                          // No text filter — get everything
      startTime: todayStart,             // From midnight today
      maxResults: HISTORY_MAX_RESULTS,   // Cap to avoid overwhelming storage
    });
  } catch (error) {
    console.error('[LearnPulse] Failed to read history:', error);
    return;
  }

  console.log(`[LearnPulse] History backfill: found ${historyItems.length} items`);

  let addedCount = 0;
  for (const item of historyItems) {
    if (!item.url) continue;

    // Skip non-http URLs (chrome://, file://, data:, etc.)
    if (!item.url.startsWith('http')) continue;

    // Skip search result pages from Google/Bing — we capture those as 'search' entries
    // via content scripts. Including them here would create duplicates.
    if (isSearchResultPage(item.url)) continue;

    const entry: CapturedEntry = {
      type: 'visit',
      content: item.url,
      source: 'history',
      timestamp: item.lastVisitTime ?? Date.now(),
      title: item.title || undefined,
    };

    await appendEntry(entry);
    addedCount++;
  }

  console.log(`[LearnPulse] Added ${addedCount} history entries to storage`);
  await updateBadge();
}

/**
 * Returns the Unix timestamp (ms) for the start of today (midnight local time).
 * Used as the startTime for chrome.history.search().
 */
function getTodayStartTimestamp(): number {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return midnight.getTime();
}

/**
 * Returns true if a URL is a search results page (should be captured as 'search' not 'visit').
 * We skip these in history backfill to avoid duplicating content-script captures.
 */
function isSearchResultPage(url: string): boolean {
  const SEARCH_PATTERNS = [
    'google.com/search',
    'bing.com/search',
    'duckduckgo.com/?q=',
    'perplexity.ai/search',
    'search.yahoo.com/search',
  ];
  return SEARCH_PATTERNS.some((pattern) => url.includes(pattern));
}

// ─── Badge Management ─────────────────────────────────────────────────────────

/**
 * Updates the extension icon badge to show today's entry count.
 *
 * The badge is the small number shown on the extension icon in the toolbar.
 * It gives the user an at-a-glance "47 things captured today" indicator
 * without needing to open the popup.
 *
 * Badge appearance:
 * - 0 entries:  no badge (empty — indicates nothing captured yet today)
 * - 1-99:       shows the exact count
 * - 100+:       shows "99+" (badge has limited space)
 */
async function updateBadge(): Promise<void> {
  const storage = await readStorage();
  const count = storage.entries.length;

  if (count === 0) {
    // Clear the badge when there are no entries
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  const badgeText = count > 99 ? '99+' : String(count);

  await chrome.action.setBadgeText({ text: badgeText });

  // Indigo background to match the LearnPulse brand
  await chrome.action.setBadgeBackgroundColor({ color: '#4F46E5' });
}

// ─── Alarm Setup ─────────────────────────────────────────────────────────────

/**
 * Sets up the two daily alarms:
 * 1. Midnight reset alarm — fires at 12:00:00 AM to clear yesterday's entries
 * 2. Evening reminder alarm — fires at 9:00 PM to prompt the user
 *
 * WHY ALARMS INSTEAD OF setTimeout?
 * - Service workers are killed when idle (typically 30 seconds after last event)
 * - setTimeout would be lost when the SW is killed
 * - chrome.alarms survive the SW being killed — Chrome wakes up the SW when the alarm fires
 * - Alarms also survive Chrome restart (if Chrome is restarted, alarms re-fire at the next scheduled time)
 */
async function setupAlarms(): Promise<void> {
  // Check if alarms already exist to avoid re-creating them
  const existingAlarms = await chrome.alarms.getAll();
  const alarmNames = existingAlarms.map((a) => a.name);

  // Midnight reset alarm
  if (!alarmNames.includes(ALARM_MIDNIGHT_RESET)) {
    const nextMidnight = getNextMidnight();
    chrome.alarms.create(ALARM_MIDNIGHT_RESET, {
      when: nextMidnight,
      periodInMinutes: 24 * 60, // Repeat every 24 hours
    });
    console.log('[LearnPulse] Midnight reset alarm scheduled');
  }

  // Evening reminder alarm (9:00 PM)
  if (!alarmNames.includes(ALARM_EVENING_REMINDER)) {
    const next9pm = getNext9pm();
    chrome.alarms.create(ALARM_EVENING_REMINDER, {
      when: next9pm,
      periodInMinutes: 24 * 60, // Repeat every 24 hours
    });
    console.log('[LearnPulse] Evening reminder alarm scheduled');
  }
}

/**
 * Returns the Unix timestamp for the next midnight (12:00 AM).
 */
function getNextMidnight(): number {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return midnight.getTime();
}

/**
 * Returns the Unix timestamp for the next 9:00 PM.
 * If it's already past 9pm today, returns 9pm tomorrow.
 */
function getNext9pm(): number {
  const now = new Date();
  const ninepm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0, 0);

  // If 9pm today has already passed, schedule for tomorrow
  if (ninepm.getTime() <= Date.now()) {
    ninepm.setDate(ninepm.getDate() + 1);
  }

  return ninepm.getTime();
}

// ─── Alarm Handler ────────────────────────────────────────────────────────────

/**
 * Handles alarm events when they fire.
 *
 * Chrome wakes up the service worker specifically to fire this event.
 * After handling, the SW may go back to sleep.
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log('[LearnPulse] Alarm fired:', alarm.name);

  if (alarm.name === ALARM_MIDNIGHT_RESET) {
    await handleMidnightReset();
  } else if (alarm.name === ALARM_EVENING_REMINDER) {
    await handleEveningReminder();
  }
});

/**
 * Midnight reset: archive yesterday's data, initialize today's fresh storage.
 *
 * We don't actually delete old data — we just set the date to today so
 * readStorage() will return a fresh empty state. This means yesterday's data
 * is effectively gone (overwritten on next write). This is intentional:
 * LearnPulse is privacy-first — we don't accumulate history over time.
 */
async function handleMidnightReset(): Promise<void> {
  const freshStorage: DailyStorage = {
    date: getTodayString(),
    entries: [],
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: freshStorage });
  await updateBadge(); // Clear the badge
  console.log('[LearnPulse] Daily reset complete');
}

/**
 * Evening reminder: shows a browser notification to prompt the user
 * to open LearnPulse and generate today's learning post.
 */
async function handleEveningReminder(): Promise<void> {
  const storage = await readStorage();
  const count = storage.entries.length;

  // Only show notification if there's something to analyze
  if (count === 0) return;

  chrome.notifications.create('learnpulse_reminder', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'LearnPulse 🧠',
    message: `You captured ${count} learning signals today. Ready to generate your post?`,
    buttons: [{ title: 'Analyze Now' }],
    priority: 1,
  });
}

// ─── Notification Click Handler ───────────────────────────────────────────────

/**
 * When the user clicks the notification (or its "Analyze Now" button),
 * open the LearnPulse web app tab.
 */
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'learnpulse_reminder') {
    chrome.tabs.create({ url: 'http://localhost:3000' });
    chrome.notifications.clear(notificationId);
  }
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId === 'learnpulse_reminder' && buttonIndex === 0) {
    chrome.tabs.create({ url: 'http://localhost:3000' });
    chrome.notifications.clear(notificationId);
  }
});

// ─── LearnPulse Tab Auto-Inject ───────────────────────────────────────────────

/**
 * Watches for the LearnPulse tab to load or refresh.
 * When detected, injects today's entries directly into the tab so the
 * two-panel view auto-populates without the user needing to open the popup.
 *
 * WHY THIS IS NEEDED:
 *   Without this listener, the left panel only populates when the user
 *   explicitly clicks "Open LearnPulse" in the popup. If the user:
 *     - Opens the web app directly (bookmark, typing the URL)
 *     - Refreshes the page
 *     - Navigates back to the tab
 *   ...the panel would be empty unless the popup re-injects the data.
 *
 * HOW IT WORKS:
 *   1. chrome.tabs.onUpdated fires whenever any tab's status changes
 *   2. We filter for the LearnPulse URL with status === 'complete'
 *      (status goes loading → complete as the page finishes loading)
 *   3. We read today's entries from chrome.storage.local
 *   4. We inject a small script (world: 'MAIN') into the tab that:
 *      a. Writes entries to localStorage (so future refreshes also work)
 *      b. Dispatches 'learnpulse:inject' event (for immediate pickup by React)
 *
 * THE localStorage BRIDGE:
 *   The injected script writes to the tab's own localStorage. On every page
 *   load, page.tsx reads this localStorage key in its useEffect. This means:
 *   - First load: background injects → localStorage written → React reads it
 *   - Second load (refresh): background injects again → same thing
 *   Even if the background script's executeScript fails (permissions, timing),
 *   the localStorage from the previous injection is still there as a fallback.
 *
 * TIMING:
 *   status === 'complete' fires when the HTML is loaded but React may still
 *   be hydrating. The injected script writes to localStorage immediately
 *   (so useEffect can read it on mount) and also dispatches an event
 *   (caught by useEffect's listener if React hydrated in time).
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act when the tab fully finishes loading
  if (changeInfo.status !== 'complete') return;

  // Only act on the LearnPulse web app tab
  if (!tab.url?.startsWith(LEARNPULSE_URL)) return;

  // Read today's captured entries
  const storage = await readStorage();
  if (!storage.entries.length) return; // Nothing to inject — leave the tab alone

  // Format entries as the freeform text the web app parser expects
  const text = formatEntriesAsText(storage.entries);

  try {
    // Inject into the LearnPulse tab's MAIN world so localStorage and
    // window are the same objects that React/Next.js uses.
    await chrome.scripting.executeScript({
      target: { tabId },
      // This inline function runs INSIDE the LearnPulse page's JS context.
      // It receives the text and lsKey as serialized arguments from background.
      // It cannot import anything — it must be self-contained.
      func: (textToInject: string, lsKey: string) => {
        // Write to localStorage first — this is the reliable bridge.
        // Even if the CustomEvent is missed (React not hydrated yet),
        // the web app's useEffect will read localStorage on mount.
        try {
          localStorage.setItem(lsKey, JSON.stringify({ text: textToInject, savedAt: Date.now() }));
        } catch (e) {
          // Ignore — localStorage should always be available on localhost
        }

        // Also dispatch the real-time event for pages that are already loaded.
        // (Covers the case where the user has the tab open and navigates away
        // and back, triggering onUpdated for an already-hydrated page.)
        window.dispatchEvent(new CustomEvent('learnpulse:inject', {
          detail: { text: textToInject },
        }));
      },
      args: [text, WEB_APP_LS_KEY],
      world: 'MAIN',
    });

    console.log('[LearnPulse] Auto-injected', storage.entries.length, 'entries into LearnPulse tab on load');
  } catch (error) {
    // This can happen if:
    // - The page navigated away between onUpdated firing and executeScript running
    // - Scripting permissions aren't granted for this tab
    // - The tab was closed
    // All are transient — not worth retrying. The localStorage from a previous
    // successful injection will still be available as a fallback.
    console.log('[LearnPulse] Could not auto-inject into tab (may be normal):', error);
  }
});

// ─── Storage Change Listener ─────────────────────────────────────────────────

/**
 * Listens for changes to chrome.storage.local.
 * When entries are added by content scripts, update the badge count.
 *
 * WHY LISTEN HERE INSTEAD OF IN CONTENT SCRIPTS?
 * Content scripts run in page contexts (potentially many tabs open at once).
 * Updating the badge should be centralized in the service worker — it's
 * the single authority for the badge value.
 */
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) {
    await updateBadge();
  }
});

// ─── Real-time URL Capture ────────────────────────────────────────────────────

/**
 * Captures URL visits in REAL TIME as the user navigates the web.
 *
 * WHY THIS IS NEEDED:
 *   The backfillHistory() function only runs on install/startup.
 *   Without this listener, URLs visited during the current session are
 *   not saved until Chrome restarts — meaning the extension effectively
 *   only captures searches (via content scripts) in real time.
 *   URL visits would only appear after the next Chrome startup backfill.
 *
 * HOW webNavigation.onCompleted WORKS:
 *   This event fires whenever a navigation completes (page finishes loading).
 *   It includes the URL, tab ID, and frame ID. We only care about:
 *   - frameId === 0: the main frame (not iframes, subresources)
 *   - http/https URLs (not chrome://, file://, etc.)
 *   - Not search result pages (those are already captured as 'search' by content scripts)
 *   - Not the LearnPulse app itself (that's our UI, not a learning signal)
 *
 * WHY NOT USE chrome.tabs.onUpdated INSTEAD?
 *   tabs.onUpdated fires for many non-navigation events (tab title change, loading state, etc.)
 *   and requires host_permissions matching the tab URL to read tab.url.
 *   webNavigation is cleaner — it fires specifically for navigations and the URL
 *   is always available with just the webNavigation permission.
 *
 * DEDUPLICATION:
 *   appendEntry() already deduplicates: it skips entries with the same URL
 *   within the last 60 minutes. So refreshing a page won't create duplicates.
 *
 * HOW THIS AFFECTS THE SYSTEM:
 *   - URL visits now appear in storage immediately (same session, no restart needed)
 *   - The badge count updates in real time for both searches AND page visits
 *   - When the user clicks "Analyze Now", URL visits from the current session
 *     are included alongside searches — giving the AI richer context about
 *     which topics the user explored in depth (not just searched for)
 */
chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Only capture main-frame navigations.
  // frameId 0 = the top-level page. Other frame IDs are iframes, embedded content, etc.
  // We don't want to capture every resource loaded inside a page — just the pages themselves.
  if (details.frameId !== 0) return;

  const url = details.url;

  // Skip non-http URLs: chrome://, chrome-extension://, file://, data:, about:, etc.
  // We only care about real web pages.
  if (!url.startsWith('http')) return;

  // Skip the LearnPulse web app itself — it's our UI, not a learning signal.
  if (url.startsWith(LEARNPULSE_URL)) return;

  // Skip search result pages — those are captured as 'search' type by content scripts.
  // Including them here as 'visit' would cause duplication in the analysis.
  if (isSearchResultPage(url)) return;

  // Save as a 'visit' entry — same type used by the history backfill.
  // The appendEntry() function handles deduplication (same URL within 60 min = skip).
  const entry: CapturedEntry = {
    type: 'visit',
    content: url,
    source: 'history',  // 'history' means "browsed URL" as opposed to 'google'/'perplexity'
    timestamp: details.timeStamp,
  };

  await appendEntry(entry);
  console.log(`[LearnPulse] Captured URL visit: ${url}`);
});
