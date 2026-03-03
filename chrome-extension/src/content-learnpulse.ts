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
//   Step 1: Write to localStorage (shared with the page) — this is the
//           reliable bridge. page.tsx reads it in useEffect on every mount.
//
//   Step 2: Dispatch CustomEvent in the MAIN world — this handles the case
//           where React has already hydrated and is waiting for new data.
//           Since content scripts run in ISOLATED world, we inject a small
//           inline <script> that runs in MAIN world and dispatches the event.
//           The inline script reads from localStorage (already written in Step 1)
//           rather than embedding the text content — safe and XSS-free.
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

import { readStorage, formatEntriesAsText, WEB_APP_LS_KEY } from './types';

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

  // ── Step 2: Dispatch CustomEvent in the MAIN world ────────────────────────
  //
  // Content scripts run in Chrome's ISOLATED world — a separate JavaScript
  // context from the page's MAIN world. This means:
  //   - window in isolated world ≠ window in main world
  //   - window.dispatchEvent() in isolated world only reaches isolated listeners
  //   - React's event listeners (registered via useEffect) are in MAIN world
  //
  // To dispatch an event that React can catch, we inject a tiny <script> tag.
  // Script tags always run in the MAIN world.
  //
  // The inline script reads from localStorage (just written in Step 1) rather
  // than embedding the raw text content. This avoids any XSS risk — the script
  // source only contains the key name, not user data.
  try {
    const script = document.createElement('script');

    // The injected script:
    //   1. Reads text from localStorage (same data we just wrote)
    //   2. Dispatches 'learnpulse:inject' event that React is listening for
    //
    // JSON.stringify(lsKey) safely encodes the key name as a string literal.
    // No user data (URLs, queries) is embedded in the script source.
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

    // Injecting into <head> runs the script immediately.
    // We remove it after execution to keep the DOM clean.
    document.head.appendChild(script);
    script.remove();

  } catch (e) {
    // If the CustomEvent dispatch fails, that's OK — localStorage is the
    // reliable bridge. The useEffect in page.tsx will read it on mount.
    console.warn('[LearnPulse] Content script: could not dispatch CustomEvent:', e);
  }
})();
