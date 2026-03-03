// ══════════════════════════════════════════════════════════════════════
// Main Dashboard Page
// src/app/page.tsx
//
// PURPOSE:
//   The single page of the LearnPulse MVP. It supports two entry modes:
//
//   MODE 1 — EXTENSION MODE (automatic):
//     The Chrome extension opens this page and fires a 'learnpulse:inject'
//     CustomEvent carrying today's captured searches/URLs as freeform text.
//     The page responds by:
//       1. Parsing the text into HistoryEntry[] (client-side, instant)
//       2. Showing a LEFT PANEL with the parsed entries
//       3. Letting the user DELETE individual entries they don't want
//       4. Showing an "Analyze" CTA — user clicks it when satisfied
//     This gives the user control over which entries go into the AI pipeline
//     before spending API credits.
//
//   MODE 2 — MANUAL MODE (paste/upload):
//     Classic single-column layout where the user pastes or uploads history.
//     Used for testing or for users without the extension.
//
// LAYOUT:
//
//   EXTENSION MODE (two-panel):
//   ┌────────────────┬───────────────────────────────────────────┐
//   │ CAPTURED       │  PIPELINE STATUS + CLUSTERS + POSTS       │
//   │ ENTRIES (left) │                                           │
//   │                │  Shown here after the user clicks         │
//   │  🔍 query 1 ×  │  "Analyze" in the left panel.            │
//   │  🔗 url 1    × │                                           │
//   │  🔍 query 2 ×  │                                           │
//   │                │                                           │
//   │  [Analyze N]   │                                           │
//   └────────────────┴───────────────────────────────────────────┘
//
//   MANUAL MODE (single-column):
//   ┌──────────────────────────────────────────────────────────┐
//   │  HistoryInput (textarea + file upload)                   │
//   │  [Analyze My Learning]  [Reset]                          │
//   │  PipelineStatus                                          │
//   │  ClusterGrid                                             │
//   │  PostPreview                                             │
//   └──────────────────────────────────────────────────────────┘
//
// HOOKS USED:
//   usePipeline() — manages the AI pipeline state machine
//   useHistory()  — manages textarea input state
//
// KEY EVENT:
//   'learnpulse:inject' (CustomEvent) — dispatched by the Chrome extension
//   via chrome.scripting.executeScript(). Carries { text: string } in detail.
// ══════════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePipeline } from '@/hooks/usePipeline';
import { useHistory } from '@/hooks/useHistory';
import { Button } from '@/components/ui';
import { HistoryInput } from '@/components/history';
import { PipelineStatus, ClusterGrid } from '@/components/dashboard';
import { PostPreview } from '@/components/posts';
import { parseInput } from '@/lib/parsers';
import type { HistoryEntry } from '@/lib/types';

/**
 * Main Dashboard Page.
 *
 * 'use client' is required because we use React hooks (useState, useCallback, useEffect)
 * and event handlers (onClick, onChange). This entire page is client-side rendered.
 */
export default function DashboardPage() {
  // ── Hooks ─────────────────────────────────────────────────────────────────────
  const { state, runPipeline, reset } = usePipeline();
  const { rawInput, setRawInput, handleFileUpload, isEmpty, fileError } = useHistory();

  // ── Extension Mode State ──────────────────────────────────────────────────────
  //
  // When the Chrome extension injects history data, we switch to "extension mode":
  //   - isExtensionMode: true → show the two-panel layout
  //   - capturedEntries: the parsed HistoryEntry[] from the extension
  //
  // The user can delete individual entries from capturedEntries before
  // clicking "Analyze" — this lets them curate their learning signal.
  const [isExtensionMode, setIsExtensionMode] = useState(false);
  const [capturedEntries, setCapturedEntries] = useState<HistoryEntry[]>([]);

  // ── Chrome Extension Event Listener ──────────────────────────────────────────
  //
  // HOW THE EXTENSION COMMUNICATES WITH THIS PAGE:
  //   1. User clicks "Open LearnPulse" in the extension popup
  //   2. Popup uses chrome.scripting.executeScript() to inject a function
  //      into this tab's context
  //   3. The injected function dispatches:
  //      window.dispatchEvent(new CustomEvent('learnpulse:inject', { detail: { text } }))
  //   4. This useEffect catches that event
  //   5. We parse the text into HistoryEntry[] and show the left panel
  //
  // WHY PARSE HERE (not in the popup)?
  //   The popup lives in the extension's isolated JS context. The web app
  //   has access to parseInput() (which runs client-side). By passing raw
  //   text across the boundary and parsing in the web app, we keep all
  //   parsing logic in one place (src/lib/parsers/) and avoid duplicating it.
  //
  // WHY NO AUTO-ANALYZE?
  //   Previously, receiving this event auto-started the AI pipeline.
  //   Now we show the entries for review first — the user decides when
  //   to analyze and can remove entries (noise, private browsing) before
  //   spending API credits.
  useEffect(() => {
    const handleExtensionInject = (e: Event) => {
      const customEvent = e as CustomEvent<{ text: string }>;
      const text = customEvent.detail?.text;
      if (!text || typeof text !== 'string') return;

      // Parse the injected freeform text into structured HistoryEntry[].
      // Lines starting with "http" → { source: 'visit', url: ... }
      // Everything else         → { source: 'search', query: ... }
      const { entries } = parseInput(text);

      // Switch to extension mode and populate the left panel
      setCapturedEntries(entries);
      setIsExtensionMode(true);

      // Also populate rawInput so the user can see the raw data if they
      // switch back to manual mode
      setRawInput(text);
    };

    window.addEventListener('learnpulse:inject', handleExtensionInject);

    // Cleanup: remove listener when component unmounts (prevents memory leaks)
    return () => {
      window.removeEventListener('learnpulse:inject', handleExtensionInject);
    };
  }, [setRawInput]);

  // ── Derived State ─────────────────────────────────────────────────────────────

  // Is the pipeline currently running? (used to disable buttons during analysis)
  const isRunning = ['ingesting', 'classifying', 'clustering', 'generating'].includes(state.stage);

  // Count how many classified entries were flagged as learning (for stats display)
  const learningEntryCount = state.classified.filter((e) => e.isLearning).length;

  // ── Handlers — Extension Mode ─────────────────────────────────────────────────

  /**
   * Removes a single entry from the left panel by its ID.
   *
   * This is the key UX for the extension mode: the user can prune
   * noise entries (e.g., weather searches, YouTube browsing) before
   * they reach the AI classifier.
   *
   * WHY THIS MATTERS:
   *   - Fewer entries = faster API calls + lower cost
   *   - Removing noise improves cluster quality (AI has cleaner signal)
   *   - User feels in control of what gets published as their "learning"
   */
  const deleteEntry = useCallback((id: string) => {
    setCapturedEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  /**
   * Runs the AI pipeline with the curated capturedEntries list.
   *
   * HOW IT WORKS:
   *   1. Convert capturedEntries back to freeform text
   *      (searches first, then URLs — same format the parser expects)
   *   2. Pass that text to runPipeline() which re-parses + classifies
   *
   * WHY RE-FORMAT TO TEXT instead of passing HistoryEntry[] directly?
   *   usePipeline() accepts a raw string and calls parseInput() internally.
   *   Keeping that interface unchanged avoids modifying the hook and ensures
   *   the pipeline always starts from the same entry point.
   *   The round-trip (HistoryEntry → text → HistoryEntry) is harmless here
   *   since parseInput is deterministic and runs in < 1ms.
   */
  const handleAnalyzeExtension = useCallback(async () => {
    if (capturedEntries.length === 0 || isRunning) return;

    // Rebuild freeform text from the curated entries
    // Searches (primary learning signal) come first, then URLs (depth signal)
    const searches = capturedEntries
      .filter((e) => e.source === 'search')
      .map((e) => e.query || e.raw);
    const urls = capturedEntries
      .filter((e) => e.source === 'visit')
      .map((e) => e.url || e.raw);
    const text = [...searches, ...urls].filter(Boolean).join('\n');

    await runPipeline(text);
  }, [capturedEntries, isRunning, runPipeline]);

  /**
   * Resets both the pipeline and the extension mode state.
   * Used when the user wants to start fresh (e.g., re-open from the extension).
   */
  const handleResetExtension = useCallback(() => {
    reset();
    setCapturedEntries([]);
    setIsExtensionMode(false);
  }, [reset]);

  // ── Handlers — Manual Mode ────────────────────────────────────────────────────

  const handleAnalyze = async () => {
    if (isEmpty || isRunning) return;
    await runPipeline(rawInput);
  };

  const handleReset = () => {
    reset();
    // Intentionally keep rawInput — the user might want to tweak and re-run
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">

      {isExtensionMode ? (
        // ── EXTENSION MODE: Two-panel layout ─────────────────────────────────
        // Left panel: captured entries list (review + delete)
        // Right panel: pipeline status + clusters + generated posts
        //
        // We use max-w-6xl (wider than manual mode) to fit both panels
        // comfortably side by side.
        <div className="max-w-6xl mx-auto px-4 py-8 sm:px-6">

          {/* Header (shared across both modes) */}
          <header className="mb-8 text-center">
            <div className="inline-flex items-center gap-2 mb-2">
              <span className="text-3xl">🧠</span>
              <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
                LearnPulse
              </h1>
            </div>
            <p className="text-sm text-gray-500">
              Review your captures, remove anything irrelevant, then analyze.
            </p>
          </header>

          {/* Two-panel body */}
          <div className="flex gap-6 items-start">

            {/* ── LEFT PANEL: Captured Entries ─────────────────────────────── */}
            {/*
              This panel is the heart of the extension mode UX.
              The user sees their raw captures and can delete entries before
              the AI pipeline touches them.
              'sticky top-4' keeps it visible while scrolling the right panel.
            */}
            <div className="w-72 flex-shrink-0">
              <CapturedEntriesPanel
                entries={capturedEntries}
                onDelete={deleteEntry}
                onAnalyze={handleAnalyzeExtension}
                onReset={handleResetExtension}
                isRunning={isRunning}
                pipelineComplete={state.stage === 'complete'}
              />
            </div>

            {/* ── RIGHT PANEL: Analysis Results ────────────────────────────── */}
            {/*
              Starts empty ("waiting for analysis" placeholder).
              Fills in progressively as the pipeline stages complete:
                - PipelineStatus: visible from 'ingesting' through 'complete'
                - ClusterGrid:    visible once clustering finishes
                - PostPreview:    visible only when stage === 'complete'
            */}
            <div className="flex-1 min-w-0">

              {/* Idle state: prompt the user to click Analyze */}
              {state.stage === 'idle' && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
                  <p className="text-4xl mb-3">✨</p>
                  <p className="text-sm font-medium text-gray-600 mb-1">
                    Ready when you are
                  </p>
                  <p className="text-xs text-gray-400">
                    Review your entries on the left, remove noise, then click{' '}
                    <span className="font-medium">Analyze</span>.
                  </p>
                </div>
              )}

              {/* Pipeline progress indicator */}
              {state.stage !== 'idle' && (
                <div className="mb-6">
                  <PipelineStatus
                    stage={state.stage}
                    error={state.error}
                    entryCount={state.entries.length}
                    learningCount={learningEntryCount}
                  />
                </div>
              )}

              {/* Learning clusters (appear after clustering stage) */}
              {state.clusters.length > 0 && (
                <div className="mb-6">
                  <ClusterGrid
                    clusters={state.clusters}
                    learningEntryCount={learningEntryCount}
                  />
                </div>
              )}

              {/* Generated posts (appear only when pipeline is fully complete) */}
              {state.stage === 'complete' && state.posts && (
                <div className="mb-6">
                  <PostPreview posts={state.posts} />
                </div>
              )}
            </div>
          </div>
        </div>

      ) : (
        // ── MANUAL MODE: Original single-column layout ────────────────────────
        // Used for paste/upload input (no extension, or extension had no entries).
        <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6 lg:px-8">

          {/* Header */}
          <header className="mb-10 text-center">
            <div className="inline-flex items-center gap-2 mb-3">
              <span className="text-3xl">🧠</span>
              <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
                LearnPulse
              </h1>
            </div>
            <p className="text-base text-gray-500 max-w-xl mx-auto">
              Paste your daily search history. Get reflective{' '}
              <span className="text-indigo-600 font-medium">LinkedIn</span> and{' '}
              <span className="font-medium">𝕏</span> posts about what you actually learned.
            </p>

            {/* How it works — compact inline step indicators */}
            <div className="flex items-center justify-center gap-2 mt-4 text-xs text-gray-400 flex-wrap">
              <Step label="Paste history" />
              <Arrow />
              <Step label="AI classifies intent" />
              <Arrow />
              <Step label="Groups into journeys" />
              <Arrow />
              <Step label="Generates posts" />
            </div>
          </header>

          {/* Input Section */}
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
              Your History
            </h2>

            <HistoryInput
              rawInput={rawInput}
              onChange={setRawInput}
              onFileUpload={handleFileUpload}
              charCount={rawInput.length}
              fileError={fileError}
            />

            {/* Action buttons */}
            <div className="flex items-center gap-3 mt-4 flex-wrap">
              <Button
                onClick={handleAnalyze}
                isLoading={isRunning}
                disabled={isEmpty || isRunning}
                size="lg"
                className="flex-shrink-0"
              >
                {isRunning ? 'Analyzing...' : 'Analyze My Learning'}
              </Button>

              {/* Reset button — only shown when there's something to reset */}
              {(state.stage !== 'idle' || !isEmpty) && (
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={handleReset}
                  disabled={isRunning}
                >
                  Start over
                </Button>
              )}

              {/* Entry count hint — shown after parsing */}
              {state.entries.length > 0 && !isRunning && (
                <span className="text-sm text-gray-500">
                  {state.entries.length} entries parsed
                  {learningEntryCount > 0 && ` · ${learningEntryCount} learning signals`}
                </span>
              )}
            </div>
          </section>

          {/* Pipeline Status */}
          {state.stage !== 'idle' && (
            <div className="mb-6">
              <PipelineStatus
                stage={state.stage}
                error={state.error}
                entryCount={state.entries.length}
                learningCount={learningEntryCount}
              />
            </div>
          )}

          {/* Learning Clusters */}
          {state.clusters.length > 0 && (
            <div className="mb-6">
              <ClusterGrid
                clusters={state.clusters}
                learningEntryCount={learningEntryCount}
              />
            </div>
          )}

          {/* Generated Posts */}
          {state.stage === 'complete' && state.posts && (
            <div className="mb-6">
              <PostPreview posts={state.posts} />
            </div>
          )}

          {/* Footer */}
          <footer className="text-center text-xs text-gray-400 mt-10 pb-4">
            <p>Your history is processed in memory and never stored.</p>
            <p className="mt-1">LearnPulse MVP · Powered by DeepSeek AI</p>
          </footer>
        </div>
      )}
    </div>
  );
}

// ─── Left Panel Component ─────────────────────────────────────────────────────
//
// This component renders the left panel in extension mode.
// It's defined here (same file) because it's only used on this page and
// is tightly coupled to the extension-mode state logic above.
//
// WHAT IT SHOWS:
//   - Header: entry count + search/URL breakdown
//   - Scrollable list: each entry with icon + text + delete button (×)
//   - Footer: "Analyze N entries" primary button + "Start over" link
//
// INTERACTION MODEL:
//   - Hover over an entry → reveals the × button
//   - Click × → removes that entry from capturedEntries (client-side, instant)
//   - Click "Analyze N entries" → triggers the AI pipeline with remaining entries
//   - Click "Start over" → clears everything and returns to manual mode

interface CapturedEntriesPanelProps {
  entries: HistoryEntry[];
  onDelete: (id: string) => void;
  onAnalyze: () => void;
  onReset: () => void;
  isRunning: boolean;
  pipelineComplete: boolean;
}

function CapturedEntriesPanel({
  entries,
  onDelete,
  onAnalyze,
  onReset,
  isRunning,
  pipelineComplete,
}: CapturedEntriesPanelProps) {
  const searchCount = entries.filter((e) => e.source === 'search').length;
  const urlCount = entries.filter((e) => e.source === 'visit').length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm sticky top-4">

      {/* ── Panel Header ─────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-700">Captured Today</h2>
          <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
            {entries.length}
          </span>
        </div>
        {/* Stat breakdown */}
        <p className="text-xs text-gray-400">
          {searchCount} {searchCount === 1 ? 'search' : 'searches'} · {urlCount} {urlCount === 1 ? 'URL' : 'URLs'}
        </p>
      </div>

      {/* ── Entry List ───────────────────────────────────────────────────── */}
      {/*
        max-h limits height so the panel doesn't overflow the viewport.
        overflow-y-auto adds a scrollbar when needed.
        Each entry row uses 'group' to show the × button only on hover —
        this keeps the list readable while still making delete accessible.
      */}
      <div className="max-h-[calc(100vh-300px)] overflow-y-auto divide-y divide-gray-50">
        {entries.length === 0 ? (
          // Empty state: user deleted everything
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-gray-400">All entries removed</p>
            <p className="text-xs text-gray-300 mt-1">Nothing left to analyze</p>
          </div>
        ) : (
          entries.map((entry) => {
            // Choose icon and display text based on entry type
            const icon = entry.source === 'search' ? '🔍' : '🔗';
            // For URL visits, prefer the page title if available (more readable).
            // Fall back to the URL itself, then the raw string.
            const displayText = entry.title || entry.query || entry.url || entry.raw;

            return (
              <div
                key={entry.id}
                className="flex items-start gap-2 px-4 py-2.5 hover:bg-gray-50 group"
              >
                {/* Entry type icon */}
                <span className="text-xs mt-0.5 flex-shrink-0 select-none">
                  {icon}
                </span>

                {/* Entry text — truncated with ellipsis, full text on hover (title attr) */}
                <span
                  className="flex-1 text-xs text-gray-600 leading-relaxed min-w-0 truncate"
                  title={entry.query || entry.url || entry.raw}
                >
                  {displayText}
                </span>

                {/* Delete button — hidden by default, shown on row hover */}
                {/*
                  opacity-0 group-hover:opacity-100 creates the reveal effect.
                  aria-label makes it accessible for screen readers.
                */}
                <button
                  onClick={() => onDelete(entry.id)}
                  className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity rounded"
                  aria-label={`Remove: ${displayText}`}
                  title="Remove this entry"
                >
                  ×
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* ── Panel Footer ─────────────────────────────────────────────────── */}
      {/*
        Primary: "Analyze N entries" button — triggers the AI pipeline.
        Disabled when: no entries left, pipeline is running, or pipeline is complete.

        Secondary: "Start over" link — clears everything and returns to manual mode.
        Useful if the user wants to paste different history instead.
      */}
      <div className="p-3 border-t border-gray-100 flex flex-col gap-2">
        <Button
          onClick={onAnalyze}
          isLoading={isRunning}
          disabled={entries.length === 0 || isRunning || pipelineComplete}
          size="md"
          className="w-full"
        >
          {isRunning
            ? 'Analyzing...'
            : pipelineComplete
              ? 'Analysis complete'
              : `Analyze ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}
        </Button>

        <button
          onClick={onReset}
          disabled={isRunning}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors text-center py-0.5 disabled:opacity-50"
        >
          Start over
        </button>
      </div>
    </div>
  );
}

// ─── Small Helper Components ──────────────────────────────────────────────────
// Tiny presentational components for the manual-mode header "how it works" steps.
// Too small to warrant their own files.

function Step({ label }: { label: string }) {
  return (
    <span className="px-2 py-1 bg-white border border-gray-200 rounded-full text-gray-500">
      {label}
    </span>
  );
}

function Arrow() {
  return <span className="text-gray-300">→</span>;
}
