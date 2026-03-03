// ══════════════════════════════════════════════════════════════════════
// Content Script — Perplexity AI Search Capture
// chrome-extension/src/content-perplexity.ts
//
// PURPOSE:
//   Runs on every Perplexity.ai page. Captures:
//   1. The initial search query from the URL
//   2. Follow-up questions typed in the same session
//
// WHY PERPLEXITY IS A SPECIAL CASE:
//   Perplexity is an AI-native search engine — it's designed for questions
//   and exploration, not just lookup. Every query on Perplexity represents
//   higher learning intent than a typical Google search.
//
//   Unlike Google (which puts the query in the URL at ?q=...),
//   Perplexity URLs look like:
//     https://www.perplexity.ai/search/how-does-tcp-work-xyz123
//     https://www.perplexity.ai/search?q=how+does+TCP+work
//
//   Perplexity uses BOTH URL styles depending on version/feature.
//   We handle both.
//
// FOLLOW-UP QUESTIONS:
//   When users ask follow-up questions in the same Perplexity session,
//   the URL doesn't change — only new content appears in the DOM.
//   We use MutationObserver to watch for new "user message" elements
//   appearing in the conversation, and capture those as well.
//
//   This means if a user asks:
//   1. "how does TCP work" → captured (initial)
//   2. "what's the difference between TCP and UDP" → captured (follow-up)
//   3. "why does TCP need a 3-way handshake" → captured (follow-up)
//
//   All three show up in LearnPulse as a rich learning signal for networking.
//
// AFFECT ON THE SYSTEM:
//   - Source is 'perplexity' so the classifier can weight these higher
//   - Each captured query goes to appendEntry() → chrome.storage.local
// ══════════════════════════════════════════════════════════════════════

import { appendEntry, CapturedEntry } from './types';

// ─── URL-based Query Extraction ───────────────────────────────────────────────

/**
 * Extracts the search query from a Perplexity URL.
 *
 * Handles two URL formats:
 *
 * Format 1 (query param): perplexity.ai/search?q=how+does+TCP+work
 *   → extract ?q= parameter
 *
 * Format 2 (slug): perplexity.ai/search/how-does-tcp-work-xyz123abc
 *   → extract the slug, remove the trailing hash ID, un-slugify
 *   → "how does tcp work" (note: lowercase — we preserve original case when possible)
 *
 * @returns Decoded query string, or null if extraction fails
 */
function extractPerplexityQueryFromUrl(): string | null {
  const url = new URL(window.location.href);

  // Format 1: explicit ?q= parameter
  const qParam = url.searchParams.get('q');
  if (qParam && qParam.trim().length > 0) {
    return qParam.trim();
  }

  // Format 2: slug-style URL path
  // Example: /search/how-does-tcp-handshake-work-abc123def
  const pathParts = url.pathname.split('/');
  const searchIndex = pathParts.indexOf('search');

  if (searchIndex !== -1 && pathParts[searchIndex + 1]) {
    const slug = pathParts[searchIndex + 1];

    // The slug ends with a hash ID (random alphanumeric, ~10-20 chars)
    // We need to remove it to get the actual query
    // Pattern: "how-does-tcp-work-AbCdEfGhIj" → "how does tcp work"
    const slugParts = slug.split('-');

    // Find where the hash ID starts — it's the suffix that looks like a random hash
    // (contains numbers and mixed case, unlike the query words which are all lowercase)
    let queryEndIndex = slugParts.length;
    for (let i = slugParts.length - 1; i >= 0; i--) {
      const part = slugParts[i];
      // If part contains numbers or uppercase letters, it's likely part of the hash
      if (/[0-9A-Z]/.test(part) && part.length > 4) {
        queryEndIndex = i;
        break;
      }
    }

    const queryWords = slugParts.slice(0, queryEndIndex);
    if (queryWords.length === 0) return null;

    return queryWords.join(' ');
  }

  return null;
}

// ─── Capture & Save ───────────────────────────────────────────────────────────

/**
 * Captures a query (from URL or from DOM element) and saves it to storage.
 *
 * @param query - The search query text to capture
 * @param context - Where this came from (for logging)
 */
async function captureQuery(query: string, context: 'url' | 'followup'): Promise<void> {
  const cleaned = query.trim();
  if (!cleaned || cleaned.length < 3) return;

  const entry: CapturedEntry = {
    type: 'search',
    content: cleaned,
    source: 'perplexity',
    timestamp: Date.now(),
  };

  await appendEntry(entry);
  console.log(`[LearnPulse] Captured Perplexity ${context}: "${cleaned}"`);
}

// ─── Follow-up Question Detection ────────────────────────────────────────────
//
// When a user asks follow-up questions in Perplexity, new message bubbles
// appear in the DOM. We use MutationObserver to watch for these.
//
// HOW MUTATIONOBSERVER WORKS:
//   MutationObserver fires a callback whenever the DOM changes.
//   We watch the document body and look for new elements that match
//   the CSS patterns for Perplexity's "user query" message bubbles.
//
// CSS SELECTORS:
//   Perplexity's DOM structure changes occasionally with app updates.
//   We use multiple selectors to stay resilient:
//   - [data-testid="user-query"] — Perplexity's own test attribute
//   - .query-text — common class in older versions
//   - The input textarea when submitted

// Text content we've already captured (prevents re-capturing on re-renders)
const capturedFollowUps = new Set<string>();

/**
 * Reads all current user query elements from the DOM.
 * Called both on initial load and whenever the DOM changes.
 */
function scanForUserQueries(): void {
  // Multiple selectors to handle different Perplexity DOM versions
  const QUERY_SELECTORS = [
    '[data-testid="user-query"]',        // Current version
    '.query-text',                         // Older version
    '[data-cke-widget-wrapper] .text',     // CKEditor-based version
    'p.break-words.font-display',          // Another known selector
  ];

  for (const selector of QUERY_SELECTORS) {
    const elements = document.querySelectorAll(selector);

    elements.forEach((el) => {
      const text = el.textContent?.trim();
      if (text && text.length >= 3 && !capturedFollowUps.has(text)) {
        capturedFollowUps.add(text);
        captureQuery(text, 'followup');
      }
    });
  }
}

/**
 * Sets up a MutationObserver to detect when new user messages appear.
 *
 * We observe the entire document body with subtree:true to catch deeply
 * nested DOM changes. The callback throttles processing to avoid
 * capturing the same element multiple times during rapid re-renders.
 */
function watchForFollowUpQuestions(): void {
  let scanTimeout: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    // Debounce: wait 500ms after DOM changes before scanning
    // This prevents triggering 50 scans during a single React render cycle
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(scanForUserQueries, 500);
  });

  observer.observe(document.body, {
    childList: true,   // Watch for elements being added/removed
    subtree: true,     // Watch all descendants (not just direct children)
  });
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

// 1. Capture the initial search from the URL (handles direct page loads)
const initialQuery = extractPerplexityQueryFromUrl();
if (initialQuery) {
  captureQuery(initialQuery, 'url');
}

// 2. Scan the DOM immediately for any user messages already rendered
//    (handles the case where the page loaded before this script ran)
scanForUserQueries();

// 3. Watch for follow-up questions in the current session
watchForFollowUpQuestions();
