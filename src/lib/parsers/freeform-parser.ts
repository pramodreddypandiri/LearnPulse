// ══════════════════════════════════════════════════════════════════════
// Freeform Text Parser
// src/lib/parsers/freeform-parser.ts
//
// PURPOSE:
//   Parses text that the user directly types or pastes into the input box.
//   This is the most forgiving format — no strict structure is required.
//   Users can paste a mix of search queries and URLs, one per line.
//
// INPUT EXAMPLES:
//   "how does TCP handshake work"          → search entry
//   "https://developer.mozilla.org/..."   → visit entry
//   "python asyncio gather documentation" → search entry
//   "www.stackoverflow.com/questions/..." → visit entry
//
// HOW IT WORKS:
//   1. Split the input by newlines
//   2. Trim each line and skip empty ones
//   3. Detect if the line looks like a URL (starts with http/https/www)
//   4. If URL → create a 'visit' HistoryEntry
//   5. If text → create a 'search' HistoryEntry
//   6. Assign a unique ID to each entry
//   7. Deduplicate entries that appear multiple times
//
// AFFECT ON THE SYSTEM:
//   - Called by parseInput() in index.ts when format detection returns 'freeform'
//   - Produces HistoryEntry[] which flows into the /api/classify API route
// ══════════════════════════════════════════════════════════════════════

import type { HistoryEntry } from '@/lib/types';
import { generateId, isUrl, deduplicateEntries } from './utils';

/**
 * Parses freeform text (one search query or URL per line) into HistoryEntry[].
 *
 * @param raw - The raw text pasted by the user
 * @returns Array of HistoryEntry objects, deduplicated
 */
export function parseFreeform(raw: string): HistoryEntry[] {
  // Split the input into individual lines
  const lines = raw.split('\n');

  const entries: HistoryEntry[] = [];

  for (const line of lines) {
    // Trim whitespace and skip empty lines or lines that are just dashes/headers
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      continue;
    }

    // Check if this line looks like a URL
    if (isUrl(trimmed)) {
      // It's a URL visit — create a 'visit' entry
      entries.push({
        id: generateId(),
        source: 'visit',
        url: normalizeUrl(trimmed),
        // No title available from freeform text (no metadata)
        title: undefined,
        // No timestamp available from freeform text
        timestamp: undefined,
        raw: trimmed,
      });
    } else {
      // It's a search query — create a 'search' entry
      entries.push({
        id: generateId(),
        source: 'search',
        query: trimmed,
        timestamp: undefined,
        raw: trimmed,
      });
    }
  }

  // Deduplicate: remove identical queries/URLs that appear more than once
  // (Users sometimes paste history that includes repeated searches)
  return deduplicateEntries(entries);
}

/**
 * Normalizes a URL string by:
 * - Adding https:// prefix if it starts with www.
 * - Trimming trailing slashes (optional — keeps URLs consistent)
 *
 * This ensures URLs are valid for later processing and display.
 */
function normalizeUrl(rawUrl: string): string {
  // If it starts with www. but not http/https, add the protocol
  if (rawUrl.startsWith('www.')) {
    return `https://${rawUrl}`;
  }
  return rawUrl;
}
