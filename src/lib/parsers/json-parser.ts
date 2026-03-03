// ══════════════════════════════════════════════════════════════════════
// JSON Parser — Generic JSON History Export
// src/lib/parsers/json-parser.ts
//
// PURPOSE:
//   Parses JSON-formatted history exports. This handles:
//   1. Google Takeout JSON: { "Browser History": [...] }
//   2. Generic JSON arrays: [{ query?, url?, title?, time? }, ...]
//   3. Nested JSON: { history: [...] } or { data: { entries: [...] } }
//
// WHY FLEXIBLE?
//   Different browser extensions, export tools, and history managers
//   produce JSON in different shapes. Rather than requiring a specific
//   schema, we detect what fields exist and extract what we can.
//
// HOW IT WORKS:
//   1. JSON.parse() the raw string
//   2. Find the array of entries (may be nested under a key)
//   3. For each entry object:
//      a. Look for known field names (query, url, title, time, etc.)
//      b. Create HistoryEntry based on what's available
//   4. Deduplicate the result
//
// AFFECT ON THE SYSTEM:
//   - Called by parseInput() in index.ts when format detection returns 'json'
//   - Produces HistoryEntry[] with the most metadata of all parsers
//     (JSON exports often include timestamps, titles, and visit counts)
// ══════════════════════════════════════════════════════════════════════

import type { HistoryEntry } from '@/lib/types';
import { generateId, isUrl, deduplicateEntries } from './utils';

/**
 * Parses a JSON string into HistoryEntry[].
 * Handles multiple JSON shapes from different export sources.
 *
 * @param raw - Raw JSON text content
 * @returns Array of HistoryEntry objects
 */
export function parseJson(raw: string): HistoryEntry[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('[json-parser] Failed to parse JSON:', error);
    return [];
  }

  // Find the array of entries within the parsed structure
  const entriesArray = extractEntriesArray(parsed);

  if (!entriesArray || entriesArray.length === 0) {
    return [];
  }

  const entries: HistoryEntry[] = [];

  for (const item of entriesArray) {
    // Each item should be an object with some combination of known fields
    if (typeof item !== 'object' || item === null) continue;

    const entry = item as Record<string, unknown>;

    // Extract known fields using flexible field name matching
    const query = extractStringField(entry, ['query', 'search', 'searchQuery', 'term', 'q']);
    const url = extractStringField(entry, ['url', 'link', 'address', 'page_url', 'pageUrl']);
    const title = extractStringField(entry, ['title', 'pageTitle', 'page_title', 'name']);
    const timestamp = extractTimestamp(entry);

    // Create a 'search' entry if we found a query-like field
    if (query && query.trim().length > 0 && !isUrl(query.trim())) {
      entries.push({
        id: generateId(),
        source: 'search',
        query: query.trim(),
        timestamp,
        raw: JSON.stringify(item),
      });
    }

    // Create a 'visit' entry if we found a URL field
    if (url && isUrl(url.trim())) {
      entries.push({
        id: generateId(),
        source: 'visit',
        url: url.trim(),
        title: title?.trim() || undefined,
        timestamp,
        raw: JSON.stringify(item),
      });
    }

    // Edge case: if 'url' field contains a search query (some exporters do this)
    if (url && !isUrl(url.trim()) && !query) {
      entries.push({
        id: generateId(),
        source: 'search',
        query: url.trim(),
        timestamp,
        raw: JSON.stringify(item),
      });
    }
  }

  return deduplicateEntries(entries);
}

// ─── Array Detection ───────────────────────────────────────────────────────

/**
 * Finds the array of history entries within a parsed JSON structure.
 *
 * Handles these shapes:
 * - Direct array: [{ ... }, { ... }]
 * - Google Takeout: { "Browser History": [{ ... }] }
 * - Generic wrapper: { history: [...] } | { data: [...] } | { entries: [...] }
 * - Deeply nested: { data: { entries: [...] } }
 */
function extractEntriesArray(parsed: unknown): Record<string, unknown>[] | null {
  // Case 1: The root is already an array
  if (Array.isArray(parsed)) {
    return parsed as Record<string, unknown>[];
  }

  // Case 2: The root is an object — search for an array-valued key
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;

    // Try known wrapper key names in priority order
    const ARRAY_KEYS = [
      'Browser History',  // Google Takeout
      'history',
      'entries',
      'data',
      'items',
      'results',
      'records',
      'searches',
      'visits',
    ];

    for (const key of ARRAY_KEYS) {
      if (Array.isArray(obj[key])) {
        return obj[key] as Record<string, unknown>[];
      }

      // Check one level deeper (e.g., { data: { entries: [...] } })
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        const nested = obj[key] as Record<string, unknown>;
        for (const nestedKey of ARRAY_KEYS) {
          if (Array.isArray(nested[nestedKey])) {
            return nested[nestedKey] as Record<string, unknown>[];
          }
        }
      }
    }

    // Fallback: find the first array-valued key
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) {
        return obj[key] as Record<string, unknown>[];
      }
    }
  }

  return null;
}

// ─── Field Extraction ──────────────────────────────────────────────────────

/**
 * Extracts a string value from an entry object by trying multiple field names.
 * Returns the first matching field value, or undefined if none found.
 *
 * This flexible approach means we don't need a rigid schema — we adapt to
 * whatever field names the exporter used.
 */
function extractStringField(
  entry: Record<string, unknown>,
  fieldNames: string[]
): string | undefined {
  for (const name of fieldNames) {
    const value = entry[name];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Extracts a timestamp from various time-related fields in the entry.
 *
 * Handles:
 * - Unix timestamps (seconds or milliseconds)
 * - ISO strings ("2024-01-15T10:32:00Z")
 * - Human-readable dates ("January 15, 2024")
 * - Chrome's internal timestamp format (microseconds since Jan 1, 1601)
 */
function extractTimestamp(entry: Record<string, unknown>): Date | undefined {
  const timeField = entry['time'] ?? entry['timestamp'] ?? entry['date']
    ?? entry['visited_at'] ?? entry['created_at'] ?? entry['datetime'];

  if (timeField === undefined || timeField === null) return undefined;

  // Handle numeric timestamps
  if (typeof timeField === 'number') {
    // Chrome stores history timestamps as microseconds since 1601-01-01
    // We detect this by checking if the value is suspiciously large
    const CHROME_EPOCH_OFFSET_MS = 11644473600000; // ms between 1601-01-01 and 1970-01-01
    const MICROSECONDS_PER_MS = 1000;

    if (timeField > 1e15) {
      // Likely Chrome microseconds since 1601
      const unixMs = timeField / MICROSECONDS_PER_MS - CHROME_EPOCH_OFFSET_MS;
      return new Date(unixMs);
    } else if (timeField > 1e12) {
      // Unix milliseconds
      return new Date(timeField);
    } else if (timeField > 1e9) {
      // Unix seconds
      return new Date(timeField * 1000);
    }
    return undefined;
  }

  // Handle string timestamps
  if (typeof timeField === 'string') {
    try {
      const date = new Date(timeField);
      return isNaN(date.getTime()) ? undefined : date;
    } catch {
      return undefined;
    }
  }

  return undefined;
}
