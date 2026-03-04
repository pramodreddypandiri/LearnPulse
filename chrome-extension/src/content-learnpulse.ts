// ══════════════════════════════════════════════════════════════════════
// LearnPulse Content Script — Web App Bridge
// chrome-extension/src/content-learnpulse.ts
// PROMPT_V1 — 2025-03-03
//
// PURPOSE:
//   Injected by Chrome into every http://localhost:3000/* page load.
//   Bridges the gap between the Chrome extension's captured entries
//   (in chrome.storage.local) and the LearnPulse web app's left panel.
//
// WHY A CONTENT SCRIPT INSTEAD OF ONLY THE background onUpdated LISTENER?
//
//   The background.ts onUpdated approach has a reliability problem:
//     1. The service worker must be awake when the tab loads
//     2. onUpdated fires, then the background ASYNC reads storage,
//        ASYNC calls executeScript — all while the page is loading
//     3. If the page hydrates before executeScript runs, localStorage
//        is still empty when useEffect first reads it
//
//   A content script is MUCH more reliable because:
//     1. Chrome injects content scripts automatically at document_idle —
//        no service worker needed, no async chain to wait for
//     2. document_idle fires AFTER the DOM is ready but typically BEFORE
//        React finishes hydrating (React bundles are async/deferred)
//     3. Content scripts can access chrome.storage directly
//     4. Content scripts share localStorage with the host page (same origin)
//
// TWO-STEP APPROACH:
//   Step 1: Write to localStorage (shared with the page) — the primary bridge.
//           page.tsx reads it in useEffect on every mount. Works even if
//           Step 2 is blocked or races with React hydration.
//
//   Step 2: Send a window.postMessage() to the page — for real-time updates
//           when React is already hydrated. postMessage() crosses the
//           isolated/MAIN world boundary safely. Previously this used an
//           inline <script> tag, but that was blocked by Next.js's CSP.
//
// HOW IT FITS IN THE OVERALL INJECTION CHAIN:
//
//   Page load / refresh:
//     Chrome injects this script (document_idle)
//       → reads chrome.storage
//       → writes localStorage
//       → React hydrates → useEffect reads localStorage → left panel fills
//
//   Popup "Open LearnPulse":
//     handleOpenLearnPulse() in popup.ts runs executeScript (world: MAIN)
//       → writes localStorage + dispatches CustomEvent with retry loop
//       → React catches it immediately (if hydrated) or reads localStorage (on mount)
//
//   New entry captured (content-google / content-perplexity):
//     appendEntry() updates chrome.storage
//       → but the web app is NOT refreshed automatically
//       → user must either refresh (→ this content script re-runs) or
//         re-open via popup (→ popup executeScript re-injects)
//
// WHAT THIS SCRIPT CANNOT DO:
//   - Push live updates while the page is already open (for that, popup inject is used)
//   - Access page globals directly (content scripts are in isolated world)
// ══════════════════════════════════════════════════════════════════════

import { readStorage, formatEntriesAsText, WEB_APP_LS_KEY, STORAGE_KEY, getTodayString } from './types';

(async () => {
  // ── Read today's captured entries from chrome.storage.local ──────────────
  //
  // readStorage() handles:
  //   - Returning empty state if today's date doesn't match stored date
  //   - Chrome storage key namespacing (STORAGE_KEY = 'learnpulse_daily')
  const storage = await readStorage();

  if (!storage.entries.length) {
    // Nothing captured today — leave the web app as-is (empty left panel)
    console.log('[LearnPulse] Content script: no entries for today, skipping inject');
    return;
  }

  // ── Format entries as freeform text ──────────────────────────────────────
  //
  // The web app's freeform parser expects:
  //   - Lines starting with "http" → { source: 'visit', url }
  //   - Other lines                → { source: 'search', query }
  //
  // formatEntriesAsText() puts searches first (primary signal), then URLs.
  const text = formatEntriesAsText(storage.entries);
  const lsKey = WEB_APP_LS_KEY; // 'learnpulse_entries'

  // ── Step 1: Write to localStorage ────────────────────────────────────────
  //
  // Content scripts share localStorage with the page (same origin = same storage).
  // The format is { text: string, savedAt: number } — page.tsx checks that
  // savedAt is from today before using the data (stale data guard).
  //
  // This write happens at document_idle — typically before React finishes
  // hydrating. By the time useEffect runs, the data is already in localStorage.
  try {
    localStorage.setItem(lsKey, JSON.stringify({ text, savedAt: Date.now() }));
    console.log(`[LearnPulse] Content script: wrote ${storage.entries.length} entries to localStorage['${lsKey}']`);
  } catch (e) {
    console.error('[LearnPulse] Content script: failed to write localStorage:', e);
    return; // If localStorage write fails, the dispatch won't help either
  }

  // ── Step 2: Notify the page via window.postMessage ───────────────────────
  //
  // Content scripts run in Chrome's ISOLATED world — a separate JavaScript
  // context from the page's MAIN world. This means:
  //   - window.dispatchEvent() in isolated world reaches only isolated listeners
  //   - React's useEffect listeners are in MAIN world and can't see those events
  //
  // PREVIOUS APPROACH (broken): injecting an inline <script> tag.
  //   This was blocked by Next.js's Content Security Policy (CSP), which
  //   disallows 'unsafe-inline' scripts. CSP error in the browser console:
  //   "Executing inline script violates the following Content Security Policy directive..."
  //
  // CURRENT APPROACH: window.postMessage()
  //   Even though content scripts are isolated, window.postMessage() crosses
  //   the world boundary — messages are dispatched to the page's MAIN world
  //   and received via window.addEventListener('message', ...) in React.
  //   This works without any CSP exceptions because postMessage is a standard
  //   browser communication channel, not inline script execution.
  //
  // page.tsx listens for messages with type 'learnpulse:inject' in its useEffect.
  // It validates the origin (same as current page) before processing.
  try {
    window.postMessage(
      { type: 'learnpulse:inject', text },
      window.location.origin // only the same-origin page receives this
    );
    console.log('[LearnPulse] Content script: sent postMessage to page');
  } catch (e) {
    // If postMessage fails, that's OK — localStorage is the reliable bridge.
    // The useEffect in page.tsx reads it on mount (before React finishes hydrating).
    console.warn('[LearnPulse] Content script: postMessage failed:', e);
  }
})();

// ─── Clear History Listener ───────────────────────────────────────────────────
//
// PURPOSE:
//   Listens for 'learnpulse:clear' messages sent from page.tsx when the
//   user clicks "Clear History". When received, empties chrome.storage.local
//   entries for today so that a page refresh does NOT re-populate the left panel.
//
// WHY THIS IS NEEDED:
//   page.tsx can only clear the web app's own localStorage (the bridge key).
//   But chrome.storage.local is owned by the extension — the web page cannot
//   access it directly (different origin / different API).
//   Content scripts CAN access chrome.storage, so we relay the clear request
//   through a postMessage from the page to this content script.
//
// SIDE EFFECT — BADGE RESET:
//   After we write an empty entries array to chrome.storage.local, the
//   background service worker's chrome.storage.onChanged listener fires
//   automatically and calls updateBadge(). Since count === 0, updateBadge()
//   clears the badge text → the extension icon shows no number.
//
// SECURITY:
//   We check e.origin === window.location.origin to ensure the message
//   comes from the LearnPulse page itself, not from any other origin.
window.addEventListener('message', async (e: MessageEvent<{ type?: string }>) => {
  // Guard 1: only accept messages from the same origin (localhost:3000)
  if (e.origin !== window.location.origin) return;

  // Guard 2: only handle the clear command
  if (e.data?.type !== 'learnpulse:clear') return;

  try {
    // Write an empty entries array while keeping today's date intact.
    // Keeping the date field means readStorage() won't mistake this for
    // a stale previous-day record — it will correctly return { entries: [] }.
    const clearedStorage = { date: getTodayString(), entries: [] };
    await chrome.storage.local.set({ [STORAGE_KEY]: clearedStorage });

    // Also clear the localStorage bridge key so the next page load doesn't
    // find any stale text written by a previous inject cycle.
    try {
      localStorage.removeItem(WEB_APP_LS_KEY);
    } catch { /* ignore — belt-and-suspenders, localStorage already cleared by page.tsx */ }

    console.log('[LearnPulse] Content script: cleared chrome.storage entries on user request');
  } catch (err) {
    console.error('[LearnPulse] Content script: failed to clear chrome.storage:', err);
  }
});
