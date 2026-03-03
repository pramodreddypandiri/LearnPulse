// ══════════════════════════════════════════════════════════════════════
// Parser Utilities
// src/lib/parsers/utils.ts
//
// PURPOSE:
//   Shared helper functions used by all three parsers (freeform, CSV, JSON).
//   Centralizing these prevents code duplication and ensures consistent
//   behavior across all input formats.
//
// FUNCTIONS:
//   - generateId()         → Creates unique IDs for HistoryEntry objects
//   - isUrl()              → Detects if a string is a URL vs. a search query
//   - deduplicateEntries() → Removes duplicate entries from the parsed list
//
// WHY DEDUPLICATION MATTERS:
//   Users often search the same thing multiple times in quick succession.
//   Without deduplication, the AI classifier would see 5 identical entries
//   for "python list comprehension" and waste tokens classifying duplicates.
//   We deduplicate within a 30-minute window — same query/URL = same entry.
// ══════════════════════════════════════════════════════════════════════

import type { HistoryEntry } from '@/lib/types';

// URL detection patterns
// We recognize URLs that start with common protocol/domain prefixes.
// We intentionally keep this simple — we're not validating URLs, just
// distinguishing "looks like a URL" from "looks like a search query".
const URL_PREFIXES = ['http://', 'https://', 'www.', 'ftp://'];

/**
 * Generates a unique ID for a HistoryEntry.
 *
 * We use crypto.randomUUID() which is available in:
 * - Modern browsers (Chrome 92+, Firefox 95+, Safari 15.4+)
 * - Node.js 14.17+
 * - Next.js server environment
 *
 * This is better than Date.now() because randomUUID() is cryptographically
 * random and guaranteed to be unique even for entries created in the same
 * millisecond (which happens when parsing arrays of entries in a loop).
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Determines if a string is a URL rather than a search query.
 *
 * Examples:
 *   "https://developer.mozilla.org" → true
 *   "www.stackoverflow.com"          → true
 *   "python list comprehension"      → false
 *   "http://localhost:3000"          → true
 *
 * @param text - The string to check
 * @returns true if the string appears to be a URL
 */
export function isUrl(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return URL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Removes duplicate HistoryEntry objects from an array.
 *
 * TWO entries are considered duplicates if:
 * - They have the same source type ('search' or 'visit')
 * - AND the same key content (query text or URL)
 * - AND they occurred within 30 minutes of each other (if timestamps available)
 *
 * WHY THE 30-MINUTE WINDOW?
 *   A user might legitimately search the same thing twice in different
 *   learning sessions (morning and evening). But if they searched it twice
 *   within 30 minutes, it's almost certainly the same browsing session and
 *   represents one learning moment, not two.
 *
 * If no timestamps are available (freeform input), we deduplicate by
 * content alone (same query or URL = duplicate regardless of time).
 *
 * @param entries - Array of HistoryEntry objects (may contain duplicates)
 * @returns Deduplicated array (first occurrence of each unique entry is kept)
 */
export function deduplicateEntries(entries: HistoryEntry[]): HistoryEntry[] {
  // Use a Map keyed by a "dedup signature" — if we've seen this signature,
  // we skip the entry. The Map preserves insertion order, so the first
  // occurrence of each unique entry is kept.
  const seen = new Map<string, Date | undefined>();
  const result: HistoryEntry[] = [];

  // 30 minutes in milliseconds — our deduplication time window
  const DEDUP_WINDOW_MS = 30 * 60 * 1000;

  for (const entry of entries) {
    // Build the content key for this entry
    const contentKey = entry.source === 'search'
      ? `search:${entry.query?.toLowerCase().trim()}`
      : `visit:${normalizeUrlForDedup(entry.url ?? '')}`;

    if (seen.has(contentKey)) {
      // We've seen this content before — check if it's within the time window
      const firstTimestamp = seen.get(contentKey);

      if (firstTimestamp && entry.timestamp) {
        // Both entries have timestamps — check the time difference
        const timeDiff = Math.abs(
          entry.timestamp.getTime() - firstTimestamp.getTime()
        );

        if (timeDiff < DEDUP_WINDOW_MS) {
          // Same content within 30 minutes → duplicate, skip this entry
          continue;
        }
        // Same content but more than 30 minutes apart → different session, keep it
        // Update the seen timestamp to this newer occurrence
        seen.set(contentKey, entry.timestamp);
      } else {
        // No timestamps available → deduplicate by content alone, skip
        continue;
      }
    } else {
      // First time we're seeing this content — mark it as seen
      seen.set(contentKey, entry.timestamp);
    }

    result.push(entry);
  }

  return result;
}

/**
 * Normalizes a URL for deduplication purposes.
 *
 * We strip:
 * - The protocol (http vs https shouldn't matter)
 * - The trailing slash (example.com/ === example.com)
 * - UTM parameters (same page with different tracking params = same page)
 *
 * Example:
 *   "https://example.com/page/?utm_source=google&utm_medium=cpc"
 *   → "example.com/page"
 */
function normalizeUrlForDedup(url: string): string {
  try {
    const parsed = new URL(url);

    // Remove UTM parameters and other tracking params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
      'utm_content', 'ref', 'referrer', 'source', 'fbclid', 'gclid'];

    trackingParams.forEach((param) => parsed.searchParams.delete(param));

    // Return just hostname + pathname (normalized), removing trailing slashes
    const path = parsed.pathname.replace(/\/+$/, '');
    const search = parsed.searchParams.toString();

    return `${parsed.hostname}${path}${search ? `?${search}` : ''}`.toLowerCase();
  } catch {
    // If URL parsing fails, just lowercase the original
    return url.toLowerCase().replace(/\/+$/, '');
  }
}
