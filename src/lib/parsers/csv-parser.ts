// ══════════════════════════════════════════════════════════════════════
// CSV Parser — Google Takeout Format
// src/lib/parsers/csv-parser.ts
//
// PURPOSE:
//   Parses CSV files exported from Google Takeout (My Activity).
//   When users download their Google search/browse history from
//   takeout.google.com, they get a CSV with columns like:
//     date, time, query, url, title
//
// SUPPORTED CSV FORMATS:
//   1. Google Takeout CSV:
//      date,time,query,url,title
//      2024-01-15,10:32:00,"how does TCP work",,
//      2024-01-15,10:35:00,,https://developer.mozilla.org/...,"HTTP - MDN"
//
//   2. Generic CSV (auto-detected by column names):
//      Flexible — we look for columns named 'query', 'url', 'title', 'date', 'time'
//      Matching is case-insensitive.
//
// HOW IT WORKS:
//   1. Parse the CSV header row to identify column positions
//   2. For each data row:
//      a. Extract query/url/title/timestamp fields by column index
//      b. If query field has content → 'search' entry
//      c. If url field has content → 'visit' entry
//      d. Both can be present in one row (user searched AND visited)
//   3. Parse timestamps from date+time columns (ISO format)
//   4. Deduplicate entries
//
// AFFECT ON THE SYSTEM:
//   - Called by parseInput() in index.ts when format detection returns 'csv'
//   - Produces HistoryEntry[] with timestamps (more metadata than freeform)
// ══════════════════════════════════════════════════════════════════════

import type { HistoryEntry } from '@/lib/types';
import { generateId, isUrl, deduplicateEntries } from './utils';

/**
 * Parses a CSV string into HistoryEntry[].
 * Handles Google Takeout format and generic CSV with recognized column names.
 *
 * @param raw - Raw CSV text content
 * @returns Array of HistoryEntry objects with timestamps when available
 */
export function parseCsv(raw: string): HistoryEntry[] {
  const lines = raw.trim().split('\n');

  // Need at least a header row and one data row
  if (lines.length < 2) {
    return [];
  }

  // Parse the header row to get column name → index mapping
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const columnMap = buildColumnMap(headers);

  // If we couldn't find any recognizable columns, bail out
  if (!columnMap.query && !columnMap.url) {
    console.warn('[csv-parser] Could not identify query or url columns in CSV headers:', headers);
    return [];
  }

  const entries: HistoryEntry[] = [];

  // Process each data row (skip the header at index 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCsvLine(line);

    // Extract field values using the column map
    const query = columnMap.query !== undefined ? fields[columnMap.query]?.trim() : undefined;
    const url = columnMap.url !== undefined ? fields[columnMap.url]?.trim() : undefined;
    const title = columnMap.title !== undefined ? fields[columnMap.title]?.trim() : undefined;
    const dateStr = columnMap.date !== undefined ? fields[columnMap.date]?.trim() : undefined;
    const timeStr = columnMap.time !== undefined ? fields[columnMap.time]?.trim() : undefined;

    // Parse the timestamp from date + time fields
    const timestamp = parseTimestamp(dateStr, timeStr);

    // If there's a non-empty query field, create a 'search' entry
    if (query && query.length > 0 && query !== '""') {
      entries.push({
        id: generateId(),
        source: 'search',
        query,
        timestamp,
        raw: line,
      });
    }

    // If there's a non-empty URL field, create a 'visit' entry
    if (url && url.length > 0 && isUrl(url)) {
      entries.push({
        id: generateId(),
        source: 'visit',
        url,
        title: title || undefined,
        timestamp,
        raw: line,
      });
    }
  }

  return deduplicateEntries(entries);
}

// ─── Column Detection ──────────────────────────────────────────────────────

/**
 * Maps column names to their positions in the CSV.
 * Supports flexible naming conventions (e.g., "Query", "QUERY", "search_query").
 */
interface ColumnMap {
  query?: number;
  url?: number;
  title?: number;
  date?: number;
  time?: number;
}

/**
 * Builds a ColumnMap from parsed CSV headers.
 * Case-insensitive matching allows for variations in exported formats.
 *
 * The matching logic looks for any header that CONTAINS the keyword
 * (e.g., "search_query" matches for 'query', "visited_url" matches for 'url').
 */
function buildColumnMap(headers: string[]): ColumnMap {
  const map: ColumnMap = {};

  headers.forEach((header, index) => {
    if (header.includes('query') || header.includes('search') || header.includes('term')) {
      map.query = index;
    } else if (header.includes('url') || header.includes('link') || header.includes('address')) {
      map.url = index;
    } else if (header.includes('title') || header.includes('page')) {
      map.title = index;
    } else if (header.includes('date') || header.includes('day')) {
      map.date = index;
    } else if (header.includes('time') || header.includes('hour')) {
      map.time = index;
    }
  });

  return map;
}

// ─── CSV Parsing ───────────────────────────────────────────────────────────

/**
 * Parses a single CSV line into an array of field values.
 *
 * Handles:
 * - Quoted fields: "hello, world" → "hello, world" (preserves commas inside quotes)
 * - Escaped quotes inside quoted fields: "He said ""hello""" → He said "hello"
 * - Empty fields: ,, → ['', '', '']
 *
 * This is a minimal RFC 4180-compliant CSV parser.
 * We implement this manually because we don't want to add a CSV library dependency
 * for what is a straightforward operation.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped double quote inside a quoted field
        current += '"';
        i++; // skip the next quote
      } else {
        // Toggle quoted mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator — save current field and start new one
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  // Don't forget the last field (no trailing comma)
  fields.push(current);

  return fields;
}

// ─── Timestamp Parsing ─────────────────────────────────────────────────────

/**
 * Parses date and time strings into a JavaScript Date object.
 *
 * Supported formats:
 * - ISO date: "2024-01-15"
 * - ISO datetime: "2024-01-15T10:32:00"
 * - Date + time separate: date="2024-01-15", time="10:32:00"
 * - US format: "01/15/2024"
 *
 * Returns undefined if parsing fails (timestamp is always optional).
 */
function parseTimestamp(dateStr?: string, timeStr?: string): Date | undefined {
  if (!dateStr) return undefined;

  try {
    // Combine date + time if both are present
    const combined = timeStr ? `${dateStr}T${timeStr}` : dateStr;

    // Handle US date format (MM/DD/YYYY) → convert to ISO
    const normalized = combined.includes('/')
      ? convertUsDateToIso(combined)
      : combined;

    const date = new Date(normalized);

    // Validate that the parsed date is actually valid
    return isNaN(date.getTime()) ? undefined : date;
  } catch {
    return undefined;
  }
}

/**
 * Converts US date format (MM/DD/YYYY or MM/DD/YYYY HH:MM:SS)
 * to ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS).
 */
function convertUsDateToIso(usDate: string): string {
  // Handle "MM/DD/YYYY HH:MM:SS" format
  const parts = usDate.split(' ');
  const datePart = parts[0];
  const timePart = parts[1] || '';

  const [month, day, year] = datePart.split('/');
  const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

  return timePart ? `${isoDate}T${timePart}` : isoDate;
}
