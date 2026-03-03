// ══════════════════════════════════════════════════════════════════════
// Shared Types — Chrome Extension
// chrome-extension/src/types.ts
//
// PURPOSE:
//   Defines the data structures used across ALL extension scripts:
//   - content-google.ts  (captures search queries from Google)
//   - content-perplexity.ts (captures from Perplexity)
//   - background.ts      (reads history, manages storage)
//   - popup.ts           (reads storage, displays to user)
//
// WHY NOT IMPORT FROM THE WEB APP'S TYPES?
//   The extension is a completely separate runtime environment from the
//   Next.js app. Extension scripts cannot import from src/lib/types
//   because:
//   1. They run in Chrome's extension sandbox, not a Node.js/browser module system
//   2. They're compiled separately by esbuild
//   3. The import paths wouldn't resolve
//
//   So we define extension-specific types here. The data format is
//   similar to HistoryEntry in the web app, but simpler.
//
// STORAGE DESIGN:
//   We store all captured entries under a single key 'learnpulse_daily'
//   in chrome.storage.local. The DailyStorage object includes the date
//   so background.ts can detect when a new day starts and reset entries.
//
//   chrome.storage.local has a 10MB limit — far more than we'll ever use.
//   A full day of searches is typically 5-50KB of JSON.
// ══════════════════════════════════════════════════════════════════════

/**
 * A single captured history entry — either a search query or a URL visit.
 *
 * This is the atomic unit stored in chrome.storage.local.
 * When the user clicks "Analyze Now", all today's CapturedEntry[] get
 * formatted as freeform text and sent to the LearnPulse web app.
 */
export interface CapturedEntry {
  /**
   * Was this a search query or a URL visit?
   * - 'search' → A query the user typed into a search engine
   * - 'visit'  → A URL visit retrieved from chrome.history API
   */
  type: 'search' | 'visit';

  /**
   * The actual content:
   * - For 'search': the query text (e.g., "how does TCP work")
   * - For 'visit':  the URL (e.g., "https://developer.mozilla.org/...")
   */
  content: string;

  /**
   * Which service captured this entry?
   * - 'google'     → content-google.ts captured from google.com/search
   * - 'perplexity' → content-perplexity.ts captured from perplexity.ai
   * - 'history'    → background.ts pulled from chrome.history API
   */
  source: 'google' | 'perplexity' | 'history';

  /**
   * When this was captured, as Unix milliseconds.
   * Used for:
   * 1. Deduplication: skip identical entries within 1 hour
   * 2. Sorting: display chronologically in popup
   * 3. Daily reset: filter out entries from previous days
   */
  timestamp: number;

  /**
   * Optional page title — available for URL visits from chrome.history.
   * Shown in the popup preview to make URL entries human-readable.
   * Example: "HTTP - MDN Web Docs" instead of "https://developer.mozilla.org/..."
   */
  title?: string;
}

/**
 * The complete daily storage object — stored as one key in chrome.storage.local.
 *
 * STORAGE KEY: 'learnpulse_daily'
 *
 * The `date` field is used for day-boundary detection:
 * - If stored date !== today → reset entries (new day started)
 * - If stored date === today → append to existing entries
 *
 * This is simpler and more reliable than using alarms for reset,
 * since service workers can be killed and restarted by Chrome.
 */
export interface DailyStorage {
  /** ISO date string for the current day: "2025-03-03" */
  date: string;

  /**
   * All entries captured today, in chronological order.
   * Reset to [] when the date changes.
   */
  entries: CapturedEntry[];
}

/**
 * The chrome.storage.local key we use for all extension data.
 * Centralizing this as a constant prevents typos across files.
 */
export const STORAGE_KEY = 'learnpulse_daily';

/**
 * Returns today's date as "YYYY-MM-DD" in the user's local timezone.
 * Used to detect when a new day has started and entries should reset.
 */
export function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Reads the current DailyStorage from chrome.storage.local.
 * If no data exists yet, or if the date has changed, returns a fresh empty state.
 *
 * WHY HANDLE DATE CHANGE HERE?
 *   Rather than relying solely on alarms (which can miss if Chrome was closed),
 *   we check the date every time we read storage. This guarantees stale data
 *   from yesterday is never shown or included in analysis.
 */
export async function readStorage(): Promise<DailyStorage> {
  const today = getTodayString();
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as DailyStorage | undefined;

  // If no stored data, or stored date is not today → return fresh state
  if (!stored || stored.date !== today) {
    return { date: today, entries: [] };
  }

  return stored;
}

// ─── localStorage Bridge Key ──────────────────────────────────────────────────

/**
 * The key used to persist formatted entry text in the LearnPulse tab's
 * localStorage. This is the bridge that makes the two-panel view persist
 * across page refreshes.
 *
 * HOW THE BRIDGE WORKS:
 *   1. Extension popup / background script runs executeScript() with world:'MAIN'
 *   2. The injected function writes localStorage.setItem(WEB_APP_LS_KEY, ...)
 *      into the LearnPulse tab's own localStorage
 *   3. On every page load, page.tsx reads this key in its useEffect
 *   4. If data is found and from today, entries are parsed and shown immediately
 *
 * This decouples the refresh cycle from the extension: even if the extension
 * is not actively injecting (user just refreshed), the data is already there.
 */
export const WEB_APP_LS_KEY = 'learnpulse_entries';

// ─── Formatter (shared between popup + background) ────────────────────────────

/**
 * Formats CapturedEntry[] as freeform text for the LearnPulse web app.
 *
 * The web app's freeform parser (src/lib/parsers/freeform-parser.ts) reads
 * this format: lines starting with "http" become 'visit' entries, everything
 * else becomes 'search' entries. This creates a clean round-trip:
 *   CapturedEntry[] → formatEntriesAsText → string → parseInput → HistoryEntry[]
 *
 * Searches come first (primary learning signal), URLs second (depth signal).
 * Within each group, entries are sorted chronologically (oldest first).
 *
 * Previously this function lived only in popup.ts. Moving it here means
 * background.ts can also use it for the tab onUpdated auto-inject flow.
 */
export function formatEntriesAsText(entries: CapturedEntry[]): string {
  const searches = entries
    .filter((e) => e.type === 'search')
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => e.content);

  const urls = entries
    .filter((e) => e.type === 'visit')
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => e.content);

  return [...searches, ...urls].filter(Boolean).join('\n');
}

/**
 * Appends a new entry to today's storage.
 * Handles date-change detection and deduplication automatically.
 *
 * DEDUPLICATION: skips the entry if an identical entry (same content)
 * was captured within the last 60 minutes. This handles:
 * - Reloading the same search page
 * - Google's auto-search as you type (fires multiple times)
 * - Back-navigation to the same search results page
 */
export async function appendEntry(entry: CapturedEntry): Promise<void> {
  const storage = await readStorage();
  const ONE_HOUR_MS = 60 * 60 * 1000;

  // Check for recent duplicate
  const isDuplicate = storage.entries.some(
    (existing) =>
      existing.content === entry.content &&
      Math.abs(existing.timestamp - entry.timestamp) < ONE_HOUR_MS
  );

  if (isDuplicate) return;

  storage.entries.push(entry);

  await chrome.storage.local.set({ [STORAGE_KEY]: storage });
}
