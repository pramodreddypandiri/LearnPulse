// ══════════════════════════════════════════════════════════════════════
// Main Dashboard Page
// src/app/page.tsx
//
// PURPOSE:
//   The single page of LearnPulse. Always renders a two-panel layout:
//
//   ┌──────────── LEFT PANEL (w-72, sticky) ─────────────────────────────┐
//   │  Captured Entries                                                   │
//   │  ─────────────────────────────────────────────────────────         │
//   │  Today's searches and URL visits from the Chrome extension.        │
//   │  The user can delete individual entries before analyzing.          │
//   │                                                                    │
//   │  Empty state: shows a manual paste textarea as a fallback.        │
//   └─────────────────────────────────────────────────────────────────── ┘
//   ┌──────────── RIGHT PANEL (flex-1) ──────────────────────────────────┐
//   │  IDLE:     Post instructions textarea                              │
//   │  RUNNING:  PipelineStatus progress bar                             │
//   │  DONE:     ClusterGrid + PostPreview                               │
//   └─────────────────────────────────────────────────────────────────── ┘
//
// HOW ENTRIES GET INTO THE LEFT PANEL:
//
//   Path A — Extension popup ("Open LearnPulse"):
//     Popup calls executeScript(world:'MAIN') which:
//     1. Writes text to localStorage['learnpulse_entries']
//     2. Dispatches window CustomEvent 'learnpulse:inject'
//     This useEffect catches the event and parses entries immediately.
//
//   Path B — Page load/refresh (background script auto-inject):
//     background.ts listens for chrome.tabs.onUpdated for localhost:3000.
//     When detected, it runs executeScript that writes to localStorage
//     and dispatches the same CustomEvent.
//     If React hasn't hydrated when the event fires, Path C handles it.
//
//   Path C — localStorage on mount (refresh fallback):
//     On every mount this useEffect reads localStorage['learnpulse_entries'].
//     If data exists and was saved today, it's parsed into entries.
//     This is the most reliable path — works even if Paths A/B were missed.
//
//   Path D — Manual paste:
//     If no extension data exists, the left panel shows an empty state
//     with a textarea where the user can paste history manually.
//
// KEY CHANGE from previous design:
//   Previously, two-panel was only shown when isExtensionMode === true,
//   which required the popup to actively inject data each time. Now the
//   two-panel is always the layout, and localStorage makes entries persist
//   across refreshes without any popup interaction.
// ══════════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePipeline } from '@/hooks/usePipeline';
import { Button } from '@/components/ui';
import { PipelineStatus, ClusterGrid } from '@/components/dashboard';
import { PostPreview } from '@/components/posts';
import { parseInput } from '@/lib/parsers';
import type { HistoryEntry } from '@/lib/types';

/**
 * The localStorage key written by the Chrome extension (popup + background).
 * Must match WEB_APP_LS_KEY in chrome-extension/src/types.ts.
 *
 * We duplicate this constant here rather than importing from the extension
 * because the extension and web app are separate build targets — there's no
 * shared module system between them.
 */
const LS_KEY = 'learnpulse_entries';

/**
 * Main Dashboard Page — always renders two-panel layout.
 *
 * 'use client' is required because we use React hooks (useState, useCallback,
 * useEffect), event handlers, and browser APIs (localStorage, CustomEvent).
 */
export default function DashboardPage() {
  // ── Core pipeline hook ────────────────────────────────────────────────────
  const { state, runPipeline, reset } = usePipeline();

  // ── Left panel state ──────────────────────────────────────────────────────
  //
  // capturedEntries: the entries shown in the left panel.
  //   Populated from: localStorage (on mount), CustomEvent (real-time inject),
  //   or manual paste textarea.
  //
  // manualInput: the raw text in the manual paste textarea.
  //   Shown only when capturedEntries is empty (empty state fallback).
  const [capturedEntries, setCapturedEntries] = useState<HistoryEntry[]>([]);
  const [manualInput, setManualInput] = useState('');

  // ── Right panel state ─────────────────────────────────────────────────────
  //
  // instructions: free-form text the user writes to guide post generation.
  //   Passed to /api/generate as preferences.customInstructions.
  //   Optional — if blank, the AI uses its default writing style.
  const [instructions, setInstructions] = useState('');

  // ── Entry injection / localStorage bridge ────────────────────────────────
  //
  // This useEffect handles all three paths for getting entries into the left panel:
  //   - Path C (localStorage): runs first on mount, instant
  //   - Path A/B (CustomEvent): registers listener for real-time updates
  //   - Path B (window variable): checks for race-condition fallback variable
  //
  // WHY useEffect and not useState initial value?
  //   localStorage is not available during SSR (Next.js renders on the server
  //   first). Reading it in useEffect guarantees we're in the browser.
  //
  // WHY NO DEPENDENCY ARRAY ITEMS?
  //   All state setters (setCapturedEntries) are stable references from useState.
  //   The effect only needs to run once on mount — adding deps would cause
  //   re-registration of the event listener on every render.
  useEffect(() => {
    // ── Shared text → entries processor ──────────────────────────────────
    //
    // Called by all three paths. Parses freeform text into HistoryEntry[],
    // then populates the left panel.
    //
    // Also deletes window.__learnpulseInjectData to signal to the extension's
    // retry loop (in injectHistoryIntoWebApp) that the data was consumed —
    // preventing the left panel from being reset if a retry fires after the
    // user has started deleting entries.
    const processInjectedText = (text: string) => {
      if (!text || typeof text !== 'string') return;

      // Signal to the injected script's retry loop that data has been consumed
      const win = window as unknown as Record<string, unknown>;
      delete win['__learnpulseInjectData'];

      // Parse freeform text into HistoryEntry[]:
      //   Lines starting with "http" → { source: 'visit', url }
      //   Everything else            → { source: 'search', query }
      const { entries } = parseInput(text);
      setCapturedEntries(entries);
    };

    // ── Path C: Read from localStorage on mount (handles refresh) ─────────
    //
    // The extension writes to localStorage every time it injects data.
    // On every page load/refresh, we read it here.
    //
    // { text: string, savedAt: number } format.
    // savedAt is checked against today's date — stale data from yesterday
    // is ignored (extension resets its storage at midnight anyway).
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { text: string; savedAt: number };
        const isToday = new Date(parsed.savedAt).toDateString() === new Date().toDateString();
        if (isToday && parsed.text) {
          processInjectedText(parsed.text);
        }
      }
    } catch {
      // Ignore JSON parse errors from corrupted/mismatched localStorage data
    }

    // ── Path B: Check window variable (race condition fallback) ───────────
    //
    // If the extension fired executeScript before localStorage was read above
    // (unlikely but possible on very fast machines), the window variable may
    // have been set. Process it if still present and not yet consumed.
    const win = window as unknown as Record<string, { text: string } | undefined>;
    const preloaded = win['__learnpulseInjectData'];
    if (preloaded?.text) {
      processInjectedText(preloaded.text);
    }

    // ── Path A: Register real-time event listener ─────────────────────────
    //
    // The extension's injectHistoryIntoWebApp dispatches this CustomEvent.
    // Listening here catches updates that happen after React has hydrated
    // (e.g., the user opens the popup while the web app is already open).
    const handleExtensionInject = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      processInjectedText(text);
    };

    window.addEventListener('learnpulse:inject', handleExtensionInject);

    // Cleanup: remove listener when component unmounts (prevents memory leaks)
    return () => {
      window.removeEventListener('learnpulse:inject', handleExtensionInject);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived state ─────────────────────────────────────────────────────────

  // Is the pipeline running? Used to disable buttons during analysis.
  const isRunning = ['ingesting', 'classifying', 'clustering', 'generating'].includes(state.stage);

  // Learning entry count for display in ClusterGrid
  const learningEntryCount = state.classified.filter((e) => e.isLearning).length;

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * Removes a single entry from the left panel by its ID.
   *
   * Pure client-side state update — no API call. The user prunes noise
   * (weather searches, YouTube rabbit holes) before the AI sees the data.
   * Fewer, cleaner entries → better clusters → better posts.
   */
  const deleteEntry = useCallback((id: string) => {
    setCapturedEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  /**
   * Runs the AI pipeline with the curated capturedEntries list.
   *
   * Converts entries back to freeform text (the format parseInput expects),
   * then passes it to runPipeline which runs: ingest → classify → cluster → generate.
   *
   * User instructions are passed as preferences.customInstructions — the
   * post-generator injects them as a high-priority directive in the prompts.
   */
  const handleAnalyze = useCallback(async () => {
    if (capturedEntries.length === 0 || isRunning) return;

    // Rebuild freeform text from curated entries.
    // Searches (primary signal) first, then URLs (depth signal).
    const searches = capturedEntries
      .filter((e) => e.source === 'search')
      .map((e) => e.query || e.raw);
    const urls = capturedEntries
      .filter((e) => e.source === 'visit')
      .map((e) => e.url || e.raw);
    const text = [...searches, ...urls].filter(Boolean).join('\n');

    const preferences = instructions.trim()
      ? { customInstructions: instructions.trim() }
      : undefined;

    await runPipeline(text, preferences);
  }, [capturedEntries, isRunning, runPipeline, instructions]);

  /**
   * Loads entries from the manual paste textarea into the left panel.
   * Used when the extension is not available or has no captures.
   */
  const handleManualLoad = useCallback(() => {
    if (!manualInput.trim()) return;
    const { entries } = parseInput(manualInput);
    setCapturedEntries(entries);
    setManualInput('');
  }, [manualInput]);

  /**
   * Resets everything: pipeline, entries, instructions, manual input.
   * Returns the left panel to its initial empty/pre-analyze state.
   */
  const handleReset = useCallback(() => {
    reset();
    setCapturedEntries([]);
    setInstructions('');
    setManualInput('');
  }, [reset]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8 sm:px-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
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

        {/* ── Two-panel body (always rendered) ────────────────────────────── */}
        <div className="flex gap-6 items-start">

          {/* ── LEFT PANEL: Captured Entries ─────────────────────────────── */}
          {/*
            w-72: fixed width so the right panel gets the majority of space.
            flex-shrink-0: prevents the left panel from collapsing when the
            right panel content grows.
            sticky top-4: keeps the panel visible while scrolling results.
          */}
          <div className="w-72 flex-shrink-0">
            <CapturedEntriesPanel
              entries={capturedEntries}
              manualInput={manualInput}
              onManualInputChange={setManualInput}
              onManualLoad={handleManualLoad}
              onDelete={deleteEntry}
              onAnalyze={handleAnalyze}
              onReset={handleReset}
              isRunning={isRunning}
              pipelineComplete={state.stage === 'complete'}
            />
          </div>

          {/* ── RIGHT PANEL: Instructions + Pipeline Output ───────────────── */}
          {/*
            flex-1: takes all remaining horizontal space.
            min-w-0: prevents flex overflow when content is wide (e.g., long posts).

            Content progression:
              stage === 'idle'     → instructions textarea + hint
              stage !== 'idle'     → PipelineStatus (progress)
              clusters available   → ClusterGrid
              stage === 'complete' → PostPreview
          */}
          <div className="flex-1 min-w-0">

            {/* Instructions panel — shown only while idle */}
            {/*
              The instructions textarea lets the user steer the AI before
              clicking Analyze. If left blank, the AI uses its default style.
              These instructions become a PRIORITY directive in the generation
              prompt — the model treats them as a hard constraint, not a hint.
            */}
            {state.stage === 'idle' && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">
                    Post instructions
                    <span className="ml-2 text-xs font-normal text-gray-400">optional</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Tell the AI how to write your post — topic focus, audience, tone, or specific things to include.
                  </p>
                </div>

                {/*
                  resize-none: prevents user resizing (keeps layout stable).
                  rows={5}: enough space for a sentence or two.
                  focus ring uses indigo to match the brand accent color.
                */}
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder={
                    'Examples:\n' +
                    '• "Focus on the debugging journey, not the solution"\n' +
                    '• "Write for a React developer audience"\n' +
                    '• "Emphasize the production impact and what I learned about async I/O"'
                  }
                  rows={5}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 placeholder-gray-300 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-shadow"
                />

                <p className="text-xs text-gray-300 mt-2 text-center">
                  When ready, click <span className="font-medium text-gray-400">Analyze</span> in the left panel
                </p>
              </div>
            )}

            {/* Pipeline progress — shown from 'ingesting' through 'complete' */}
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

            {/* Learning clusters — appear after the clustering stage */}
            {state.clusters.length > 0 && (
              <div className="mb-6">
                <ClusterGrid
                  clusters={state.clusters}
                  learningEntryCount={learningEntryCount}
                />
              </div>
            )}

            {/* Generated posts — appear only when pipeline is fully complete */}
            {state.stage === 'complete' && state.posts && (
              <div className="mb-6">
                <PostPreview posts={state.posts} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Left Panel Component ─────────────────────────────────────────────────────
//
// Renders the sticky left panel with the entry list (or empty state).
// Defined in the same file because it's tightly coupled to this page's state.
//
// STATES:
//   Has entries → shows entry list with delete buttons + Analyze button
//   No entries  → shows empty state with:
//     - Hint to use the extension
//     - Manual paste textarea (fallback for users without the extension)

interface CapturedEntriesPanelProps {
  entries: HistoryEntry[];
  manualInput: string;
  onManualInputChange: (value: string) => void;
  onManualLoad: () => void;
  onDelete: (id: string) => void;
  onAnalyze: () => void;
  onReset: () => void;
  isRunning: boolean;
  pipelineComplete: boolean;
}

function CapturedEntriesPanel({
  entries,
  manualInput,
  onManualInputChange,
  onManualLoad,
  onDelete,
  onAnalyze,
  onReset,
  isRunning,
  pipelineComplete,
}: CapturedEntriesPanelProps) {
  const searchCount = entries.filter((e) => e.source === 'search').length;
  const urlCount = entries.filter((e) => e.source === 'visit').length;
  const hasEntries = entries.length > 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm sticky top-4">

      {/* ── Panel Header ─────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-700">Captured Today</h2>
          {hasEntries && (
            <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
              {entries.length}
            </span>
          )}
        </div>
        {hasEntries && (
          <p className="text-xs text-gray-400">
            {searchCount} {searchCount === 1 ? 'search' : 'searches'} · {urlCount} {urlCount === 1 ? 'URL' : 'URLs'}
          </p>
        )}
      </div>

      {/* ── Entry List or Empty State ─────────────────────────────────────── */}
      <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
        {hasEntries ? (
          // Entry list: each row shows icon + text + hover-to-reveal × button
          <div className="divide-y divide-gray-50">
            {entries.map((entry) => {
              const icon = entry.source === 'search' ? '🔍' : '🔗';
              // Prefer page title (more readable), fall back to query/URL/raw
              const displayText = entry.title || entry.query || entry.url || entry.raw;

              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 px-4 py-2.5 hover:bg-gray-50 group"
                >
                  <span className="text-xs mt-0.5 flex-shrink-0 select-none">
                    {icon}
                  </span>

                  {/*
                    truncate + title: shows truncated text in the row,
                    full text in a native tooltip on hover.
                  */}
                  <span
                    className="flex-1 text-xs text-gray-600 leading-relaxed min-w-0 truncate"
                    title={entry.query || entry.url || entry.raw}
                  >
                    {displayText}
                  </span>

                  {/*
                    Delete button: hidden by default (opacity-0), revealed on
                    row hover via group-hover:opacity-100 transition.
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
            })}
          </div>
        ) : (
          // Empty state: extension not installed or no captures today.
          // Shows a minimal manual paste fallback so the user can still use the app.
          <div className="px-4 py-4">
            <p className="text-xs text-gray-400 mb-1 font-medium">No captures yet</p>
            <p className="text-xs text-gray-300 mb-4 leading-relaxed">
              Open the extension popup and click <span className="text-gray-400">Open LearnPulse</span> to load today&apos;s captures automatically.
            </p>

            {/* Manual paste fallback */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-400 mb-2">Or paste manually:</p>
              <textarea
                value={manualInput}
                onChange={(e) => onManualInputChange(e.target.value)}
                placeholder={"how does TCP work\nhttps://stackoverflow.com/...\npython async await"}
                rows={5}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs text-gray-600 placeholder-gray-300 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-transparent"
              />
              {manualInput.trim() && (
                <Button
                  size="sm"
                  onClick={onManualLoad}
                  className="w-full mt-2"
                >
                  Load entries
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Panel Footer: Analyze + Reset ────────────────────────────────── */}
      {/*
        Only shown when there are entries to analyze.
        "Analyze N entries" is disabled while running or after completion.
        "Start over" clears everything and returns to the empty state.
      */}
      {hasEntries && (
        <div className="p-3 border-t border-gray-100 flex flex-col gap-2">
          <Button
            onClick={onAnalyze}
            isLoading={isRunning}
            disabled={isRunning || pipelineComplete}
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
      )}
    </div>
  );
}
