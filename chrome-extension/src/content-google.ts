// ══════════════════════════════════════════════════════════════════════
// Content Script — Google Search Capture
// chrome-extension/src/content-google.ts
//
// PURPOSE:
//   Runs on every Google search results page (google.com/search?q=...).
//   Extracts the search query from the URL and saves it to
//   chrome.storage.local via appendEntry().
//
// HOW CHROME CONTENT SCRIPTS WORK:
//   Content scripts are JavaScript files injected by Chrome into web pages.
//   They have access to the page's DOM but run in an isolated JavaScript
//   context (they CANNOT access the page's global variables or functions).
//   They CAN access Chrome APIs like chrome.storage.
//
//   In manifest.json, we declared:
//     "matches": ["https://www.google.com/search*"]
//   Chrome automatically injects this script on every URL matching that pattern.
//
// CHALLENGE: GOOGLE IS A SPA (Single Page Application)
//   When you search on Google and click a result, then press Back,
//   or when you refine your search, Google doesn't reload the page —
//   it updates the URL and content dynamically using pushState.
//   This means our "on page load" capture would miss these subsequent searches.
//
//   We handle this with TWO mechanisms:
//   1. Initial capture: Extract query when the script first loads
//   2. Navigation capture: Use PerformanceObserver (or MutationObserver) to
//      detect URL changes and capture again
//
// WHAT WE EXTRACT:
//   From URL: https://www.google.com/search?q=how+does+TCP+work&sca=...
//   We extract: "how does TCP work" (decoded from URL params)
//
// AFFECT ON THE SYSTEM:
//   - This script runs silently in the background whenever the user searches on Google
//   - The captured query is stored in chrome.storage.local
//   - background.ts updates the badge counter
//   - popup.ts shows the captured queries to the user
// ══════════════════════════════════════════════════════════════════════

import { appendEntry, CapturedEntry } from './types';

// ─── Query Extraction ────────────────────────────────────────────────────────

/**
 * Extracts the search query from the current Google search URL.
 *
 * Google uses different URL parameters depending on the search type:
 * - Regular search: ?q=your+query
 * - Image search:   ?q=cats (same param, different path)
 * - News search:    ?q=news+topic (same param)
 *
 * We use URLSearchParams which handles:
 * - Plus signs (+) decoded as spaces
 * - Percent-encoded characters (%20, %27, etc.)
 * - Multi-value parameters (we take the first 'q' value)
 *
 * @returns The decoded search query, or null if not a search page
 */
function extractGoogleQuery(): string | null {
  const params = new URLSearchParams(window.location.search);
  const query = params.get('q');

  if (!query || query.trim().length === 0) return null;

  // Trim and normalize whitespace
  return query.trim().replace(/\s+/g, ' ');
}

// ─── Capture & Save ───────────────────────────────────────────────────────────

/**
 * Captures the current Google search query and saves it to storage.
 *
 * This function is called:
 * 1. When the content script first loads (initial page load)
 * 2. When a URL change is detected (SPA navigation)
 *
 * It's a no-op if there's no valid query (e.g., on a Google homepage URL
 * that somehow matches our pattern but isn't a search).
 */
async function captureCurrentSearch(): Promise<void> {
  const query = extractGoogleQuery();
  if (!query) return;

  // Ignore very short queries (1-2 chars) — these are usually autocomplete
  // artifacts or accidental keypresses, not real searches
  if (query.length < 3) return;

  const entry: CapturedEntry = {
    type: 'search',
    content: query,
    source: 'google',
    timestamp: Date.now(),
  };

  await appendEntry(entry);

  // Log to extension's service worker console (visible in chrome://extensions → background page)
  console.log(`[LearnPulse] Captured Google search: "${query}"`);
}

// ─── SPA Navigation Detection ─────────────────────────────────────────────────
//
// Google is a SPA — it changes the URL without a full page reload.
// Standard "page load" events don't fire on SPA navigation.
//
// APPROACH: Monitor the URL for changes by polling.
// While polling isn't elegant, it's reliable and simple for this use case.
// The poll interval (1 second) is fast enough to capture queries but not
// so frequent that it impacts performance.
//
// Alternative approaches (and why we don't use them):
// - History API monkey-patching: fragile, can break other scripts
// - MutationObserver on search input: complex, Google changes DOM frequently
// - chrome.webNavigation events: would need to be in background.ts, not content script

let lastCapturedUrl = '';

/**
 * Starts watching for URL changes due to SPA navigation.
 * On each URL change, triggers a new capture attempt.
 */
function watchForNavigation(): void {
  setInterval(() => {
    const currentUrl = window.location.href;

    if (currentUrl !== lastCapturedUrl && currentUrl.includes('google.com/search')) {
      lastCapturedUrl = currentUrl;
      captureCurrentSearch();
    }
  }, 1500); // Check every 1.5 seconds — light enough not to impact performance
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

// Capture immediately when the script loads (for direct page loads and refreshes)
lastCapturedUrl = window.location.href;
captureCurrentSearch();

// Start watching for URL changes (for SPA navigation within Google)
watchForNavigation();
