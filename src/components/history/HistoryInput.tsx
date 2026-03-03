// ══════════════════════════════════════════════════════════════════════
// HistoryInput — The Primary Input Component
// src/components/history/HistoryInput.tsx
//
// PURPOSE:
//   The main input area where users paste their browsing/search history.
//   Supports both direct text paste and file upload (.txt, .csv, .json).
//
// WHAT THIS COMPONENT RENDERS:
//   1. A large textarea for pasting history
//   2. An "or upload a file" button that opens a file picker
//   3. Format hints showing what kind of input is accepted
//   4. A character count and detected format indicator
//   5. An error message if file upload fails
//
// PROPS:
//   - rawInput: current textarea value (from useHistory hook)
//   - onChange: called when textarea content changes
//   - onFileUpload: called when user uploads a file (reads it as text)
//   - charCount: character count for display
//   - fileError: error message from file read failure
//
// USER INTERACTION FLOW:
//   1. User pastes text → onChange fires → rawInput updates → Analyze button enables
//   2. User clicks "Upload file" → file picker opens → file selected → onFileUpload fires
//   3. User clicks "Analyze My Learning" (on parent) → pipeline starts
//
// AFFECT ON THE SYSTEM:
//   - Used by: src/app/page.tsx
//   - Reads from: useHistory hook (via props)
//   - Does NOT trigger analysis itself — that's the parent page's responsibility
// ══════════════════════════════════════════════════════════════════════

'use client';

import { useRef } from 'react';

interface HistoryInputProps {
  rawInput: string;
  onChange: (value: string) => void;
  onFileUpload: (file: File) => Promise<void>;
  charCount: number;
  fileError: string | null;
}

/**
 * The primary history input component.
 * Textarea + file upload + format guidance.
 */
export function HistoryInput({
  rawInput,
  onChange,
  onFileUpload,
  charCount,
  fileError,
}: HistoryInputProps) {
  // Hidden file input — triggered by clicking the "Upload file" button
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await onFileUpload(file);
    // Reset the file input so the same file can be re-uploaded if needed
    e.target.value = '';
  };

  return (
    <div className="space-y-3">
      {/* Textarea */}
      <div className="relative">
        <textarea
          value={rawInput}
          onChange={(e) => onChange(e.target.value)}
          placeholder={PLACEHOLDER_TEXT}
          rows={10}
          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y font-mono"
          spellCheck={false}
        />

        {/* Character count — shown in bottom-right of textarea */}
        {charCount > 0 && (
          <div className="absolute bottom-3 right-3 text-xs text-gray-400 bg-white px-1">
            {charCount.toLocaleString()} chars
          </div>
        )}
      </div>

      {/* File upload + format hints row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.json"
            onChange={handleFileChange}
            className="hidden"
            aria-label="Upload history file"
          />

          {/* Visible upload button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium underline underline-offset-2"
          >
            or upload a file
          </button>

          <span className="text-gray-300">|</span>

          {/* Format hints */}
          <span className="text-xs text-gray-500">
            Accepts: .txt, .csv, .json
          </span>
        </div>

        {/* Format guide link */}
        <details className="text-xs text-gray-500 cursor-pointer">
          <summary className="hover:text-gray-700 select-none">What format?</summary>
          <div className="absolute right-0 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-10 text-left">
            <p className="font-medium text-gray-800 mb-2">Accepted formats:</p>
            <ul className="space-y-1.5 text-gray-600">
              <li><strong>Freeform</strong> — One query or URL per line</li>
              <li><strong>CSV</strong> — Google Takeout export</li>
              <li><strong>JSON</strong> — Custom history exports</li>
            </ul>
            <p className="mt-3 text-gray-500">
              Tip: In Google Chrome, go to takeout.google.com to export your search history as CSV.
            </p>
          </div>
        </details>
      </div>

      {/* File error message */}
      {fileError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fileError}
        </div>
      )}
    </div>
  );
}

// ─── Placeholder Text ─────────────────────────────────────────────────────────

// Multi-line placeholder showing the user exactly what kind of input to paste.
// We show real-looking examples for each format.
const PLACEHOLDER_TEXT = `Paste your search history or URLs here (one per line)...

Examples:
how does TCP handshake work
python asyncio event loop explained
https://docs.python.org/3/library/asyncio.html
fastapi connection pool settings
why is my database query slow

Or paste a CSV from Google Takeout, or upload a JSON export.`;
