// ══════════════════════════════════════════════════════════════════════
// useHistory — Input Management Hook
// src/hooks/useHistory.ts
//
// PURPOSE:
//   Manages the raw text input state for the history textarea.
//   Also handles file uploads by reading file contents as text,
//   then forwarding to the same parser that handles pasted input.
//
// WHY A SEPARATE HOOK?
//   While usePipeline handles the AI pipeline, useHistory handles
//   the INPUT LAYER — managing what the user types/pastes/uploads.
//   Separating concerns keeps each hook focused:
//
//   useHistory    → "What raw text does the user want to analyze?"
//   usePipeline   → "How do we run the AI pipeline on that text?"
//
// WHAT THIS HOOK PROVIDES:
//   - rawInput: the current text in the textarea
//   - setRawInput: update the textarea value
//   - handleFileUpload: reads a File object and sets rawInput to its contents
//   - charCount: character count for the textarea (useful for UI feedback)
//   - isEmpty: whether the input is empty (disables the Analyze button)
//
// AFFECT ON THE SYSTEM:
//   - Used by: src/components/history/HistoryInput.tsx
//   - The rawInput value is passed to usePipeline.runPipeline() when the
//     user clicks "Analyze My Learning"
// ══════════════════════════════════════════════════════════════════════

'use client';

import { useState, useCallback } from 'react';

// ─── Hook Return Type ────────────────────────────────────────────────────────

export interface UseHistoryReturn {
  /** Current value of the history textarea */
  rawInput: string;

  /** Updates the textarea value (called by textarea onChange) */
  setRawInput: (value: string) => void;

  /**
   * Reads a File object (from <input type="file">) and sets rawInput
   * to the file's text content.
   *
   * Supports: .txt, .csv, .json (any text file, really)
   * Rejects: Files larger than MAX_FILE_SIZE_BYTES
   *
   * @returns Promise that resolves when the file is read
   */
  handleFileUpload: (file: File) => Promise<void>;

  /** Number of characters in the current input */
  charCount: number;

  /** True if the input is empty or only whitespace */
  isEmpty: boolean;

  /** Error message from file upload (null if no error) */
  fileError: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Maximum file size we'll accept for upload.
 * 5MB covers virtually all real browsing history exports.
 * Larger files are likely not history files (or would be too slow to process).
 */
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * useHistory — Manages raw history input state.
 *
 * Used by the HistoryInput component to let users paste text
 * or upload a file, then hands off to usePipeline for processing.
 */
export function useHistory(): UseHistoryReturn {
  const [rawInput, setRawInput] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);

  /**
   * Handles file upload by reading the file as text.
   *
   * HOW IT WORKS:
   * 1. Validate file size (reject too-large files)
   * 2. Use FileReader API (browser built-in) to read as text
   * 3. Set rawInput to the file contents
   * 4. The HistoryInput component then shows the text in the textarea
   *
   * WHY NOT SEND THE FILE DIRECTLY TO THE API?
   * We always go through the parser (client-side) first. This means:
   * - The user sees their parsed data before sending to AI
   * - We can show entry count, format detection, etc.
   * - File contents are treated exactly like pasted text
   */
  const handleFileUpload = useCallback(async (file: File): Promise<void> => {
    // Clear any previous file error
    setFileError(null);

    // Validate file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      setFileError(
        `File is too large (${sizeMB}MB). Maximum size is 5MB. ` +
        `Try exporting a shorter date range from your browser history.`
      );
      return;
    }

    // Read the file as text using the FileReader API
    // FileReader is callback-based, so we wrap it in a Promise
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (event) => {
        const text = event.target?.result;
        if (typeof text === 'string') {
          setRawInput(text);
          resolve();
        } else {
          setFileError('Failed to read file. Please try copying and pasting the content instead.');
          reject(new Error('File read returned non-string result'));
        }
      };

      reader.onerror = () => {
        setFileError('Failed to read file. Please try copying and pasting the content instead.');
        reject(new Error('FileReader error'));
      };

      // readAsText uses UTF-8 by default — covers all common history export formats
      reader.readAsText(file, 'UTF-8');
    });
  }, []);

  return {
    rawInput,
    setRawInput,
    handleFileUpload,
    charCount: rawInput.length,
    isEmpty: rawInput.trim().length === 0,
    fileError,
  };
}
