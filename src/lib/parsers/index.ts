// ══════════════════════════════════════════════════════════════════════
// Parser Barrel — Format Detection + Public API
// src/lib/parsers/index.ts
//
// PURPOSE:
//   This is the PUBLIC API of the parsers module. Instead of importing
//   from individual parser files, all other code imports from here:
//
//     import { parseInput } from '@/lib/parsers';
//
// THE MAIN FUNCTION: parseInput()
//   Takes raw text (pasted or file contents) and automatically detects
//   the format, routes to the correct parser, and returns HistoryEntry[].
//
// FORMAT DETECTION LOGIC:
//   1. If the raw string starts with '[' or '{' → JSON
//   2. If the first line contains commas AND looks like a header row → CSV
//   3. Otherwise → Freeform text
//
// WHY AUTO-DETECT?
//   Users shouldn't have to tell us what format they're pasting.
//   The format signals are clear enough to detect reliably. This makes
//   the UI simpler — just one textarea, paste anything.
//
// SYSTEM IMPACT:
//   - Called by the usePipeline hook during the 'ingesting' stage
//   - Called by useHistory hook when user pastes content or uploads a file
//   - Output (HistoryEntry[]) is immediately sent to /api/classify
// ══════════════════════════════════════════════════════════════════════

import type { HistoryEntry } from '@/lib/types';
import { parseFreeform } from './freeform-parser';
import { parseCsv } from './csv-parser';
import { parseJson } from './json-parser';

// Re-export individual parsers for direct use (e.g., in tests)
export { parseFreeform } from './freeform-parser';
export { parseCsv } from './csv-parser';
export { parseJson } from './json-parser';

/**
 * The three input formats LearnPulse supports.
 * Detected automatically by detectFormat().
 */
export type InputFormat = 'freeform' | 'csv' | 'json';

/**
 * AUTO-DETECTS the format of raw input text and parses it into HistoryEntry[].
 *
 * This is the PRIMARY function used throughout the app.
 * The usePipeline hook calls this during the 'ingesting' stage.
 *
 * @param raw - Raw text: pasted content or file contents as a string
 * @returns { entries: HistoryEntry[], format: InputFormat }
 *          - entries: Parsed and deduplicated history entries
 *          - format: Which format was detected (useful for UI feedback)
 */
export function parseInput(raw: string): { entries: HistoryEntry[]; format: InputFormat } {
  const trimmed = raw.trim();

  if (!trimmed) {
    return { entries: [], format: 'freeform' };
  }

  const format = detectFormat(trimmed);

  let entries: HistoryEntry[];

  switch (format) {
    case 'json':
      entries = parseJson(trimmed);
      break;
    case 'csv':
      entries = parseCsv(trimmed);
      break;
    case 'freeform':
    default:
      entries = parseFreeform(trimmed);
      break;
  }

  return { entries, format };
}

/**
 * Detects the format of the raw input string.
 *
 * Detection rules (applied in order):
 *
 * 1. JSON: String starts with '[' or '{' after trimming whitespace.
 *    This covers both JSON arrays and JSON objects (either is valid).
 *    We also verify it's actually parseable JSON, not just a line
 *    that happens to start with '['.
 *
 * 2. CSV: The first line contains at least 2 commas AND resembles
 *    a header row (contains letters, not just numbers).
 *    We check for at least 2 commas to avoid triggering on a single
 *    URL that contains commas.
 *
 * 3. Freeform: Fallback for everything else (most common case).
 *    This includes plain text, one-per-line queries, and single URLs.
 *
 * @param raw - The trimmed input string
 * @returns The detected InputFormat
 */
export function detectFormat(raw: string): InputFormat {
  // Check for JSON first (most definitive signal)
  if (raw.startsWith('[') || raw.startsWith('{')) {
    // Verify it's actually valid JSON by attempting to parse a snippet
    // We only check the first 500 chars for performance
    try {
      JSON.parse(raw.length > 500 ? raw.substring(0, 499) + '...' : raw);
      return 'json';
    } catch {
      // Starts with [ or { but isn't valid JSON — treat as freeform
      // (e.g., a URL starting with nothing, some weird pasted content)
    }
  }

  // Check for CSV (first line has multiple comma-separated header-looking fields)
  const firstLine = raw.split('\n')[0];
  const commaCount = (firstLine.match(/,/g) || []).length;
  const hasLetters = /[a-zA-Z]/.test(firstLine);

  if (commaCount >= 2 && hasLetters) {
    return 'csv';
  }

  // Default: freeform text
  return 'freeform';
}
