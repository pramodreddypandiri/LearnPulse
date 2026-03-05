// ══════════════════════════════════════════════════════════════════════
// Main Dashboard Page
// src/app/page.tsx
//
// LAYOUT (3-column, always rendered):
//
//  ┌── LEFT (w-60) ──┬────── CENTER (flex-1) ──────────┬── RIGHT (w-72) ──┐
//  │ Search/         │  Post Instructions  [optional]   │ EDIT AREA        │
//  │ Browsing        │  ┌──────────────────────────┐   │ FOR POSTS        │
//  │ History  [^]    │  │  textarea                │   │                  │
//  │ 16s · 23 URLs   │  └──────────────────────────┘   │ (placeholder     │
//  │                 │  [Analyze & Generate] [StartOver]│  until EDIT      │
//  │ (entry list)    │                                  │  is clicked)     │
//  │                 │  Your Learnings                  │                  │
//  │                 │  [cluster] [cluster]             │ ── when editing──│
//  │ [Clear History] │                                  │ Editing: LinkedIn│
//  │                 │  Your Posts                      │ [textarea]       │
//  │                 │  [LinkedIn ][X tweet ]           │ #hashtags        │
//  │                 │  [  EDIT   ][  EDIT  ]           │ [Copy] [Add link]│
//  └─────────────────┴──────────────────────────────────┴──────────────────┘
//
// COLUMN RESPONSIBILITIES:
//   Left:   Entry list (from extension or manual paste), collapse toggle,
//           "Clear History" to remove all entries
//   Center: Instructions textarea + action buttons + pipeline output
//           (clusters + read-only post cards with EDIT button)
//   Right:  Post edit panel — placeholder when idle, full editor when active
//
// EDIT FLOW:
//   1. Pipeline generates posts → center shows read-only post cards
//   2. User clicks EDIT on a card → that card highlights, right panel activates
//   3. User edits text / hashtags in the right panel
//   4. Copy from right panel when done
//
// DATA FLOW (extension → left panel):
//   content-learnpulse.ts writes to localStorage on every page load.
//   useEffect reads localStorage on mount → populates left panel.
//   learnpulse:inject CustomEvent updates entries in real time.
// ══════════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePipeline } from '@/hooks/usePipeline';
import { Button } from '@/components/ui';
import { PipelineStatus, ClusterGrid } from '@/components/dashboard';
import { CopyButton } from '@/components/posts/CopyButton';
import { parseInput } from '@/lib/parsers';
import type { HistoryEntry, GeneratedPosts, LearningCluster, LinkedInPost } from '@/lib/types';

// localStorage key — must match WEB_APP_LS_KEY in chrome-extension/src/types.ts
const LS_KEY = 'learnpulse_entries';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Which post is currently loaded in the right edit panel.
 *
 * For LinkedIn, we track the array index so the correct post is loaded
 * into the editor when the user clicks "Edit" on one of the 3-4 cards.
 * For X there's only one post so no index is needed.
 */
type EditingPost = { type: 'linkedin'; index: number } | { type: 'x' } | null;

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { state, runPipeline, reset } = usePipeline();

  // ── Left panel ─────────────────────────────────────────────────────────────
  const [capturedEntries, setCapturedEntries] = useState<HistoryEntry[]>([]);
  const [manualInput, setManualInput]         = useState('');
  const [leftCollapsed, setLeftCollapsed]     = useState(false);

  // ── Center panel ───────────────────────────────────────────────────────────
  const [instructions, setInstructions] = useState('');

  // ── Right edit panel ───────────────────────────────────────────────────────
  const [editingPost, setEditingPost] = useState<EditingPost>(null);

  // Single state for user edits to the generated posts.
  //
  // WHY ONE STATE OBJECT INSTEAD OF 4 SEPARATE STATES:
  //   The previous approach used 4 useState variables (editedLinkedIn, etc.)
  //   synced from state.posts via a useEffect. That pattern causes "cascading
  //   renders" (effect fires → 4 setStates → re-render) and is flagged by the
  //   react-hooks/set-state-in-effect linter rule.
  //
  // THE NEW PATTERN — "derive, don't sync":
  //   - editedPosts = null   → no user edits yet; display values from state.posts
  //   - editedPosts = {...}  → user has edited; display values from editedPosts
  //   - The 4 display variables below are DERIVED (not state), so they always
  //     show the right thing without any synchronization effect.
  //   - Clearing editedPosts (setting to null) is done in handleAnalyze and
  //     handleStartOver so a fresh pipeline run always shows fresh output.
  const [editedPosts, setEditedPosts] = useState<GeneratedPosts | null>(null);

  // ── Derived display values for the edit panel ──────────────────────────────
  //
  // When the user hasn't made any manual edits (editedPosts is null), we fall
  // back to the pipeline's output (state.posts). Once the user edits or
  // regenerates, editedPosts holds the active values.
  //
  // For LinkedIn, we now have an ARRAY of posts (one per cluster). The edit
  // panel shows one post at a time, indexed by editingPost.index. We derive
  // `activeLinkedInPost` for the currently-open editor and `linkedinPosts`
  // for the PostsSection to render all cards.
  const currentPosts = editedPosts ?? state.posts;

  // Full LinkedIn post array — rendered as individual cards in PostsSection
  const linkedinPosts: LinkedInPost[] = currentPosts?.linkedinPosts ?? [];

  // Index of the LinkedIn post currently open in the right edit panel
  const editingLinkedInIndex = editingPost?.type === 'linkedin' ? editingPost.index : 0;

  // The active LinkedIn post data (body + hashtags) fed into the editor
  const activeLinkedInPost = linkedinPosts[editingLinkedInIndex];
  const editedLinkedIn     = activeLinkedInPost?.body     ?? '';
  const editedLinkedInTags = activeLinkedInPost?.hashtags ?? [];

  // X post is always a single entry
  const editedX    = currentPosts?.x.tweets  ?? [];
  const editedXTags = currentPosts?.x.hashtags ?? [];

  // ── Field-level setters — update one field, preserve the rest ─────────────
  //
  // LinkedIn setters are index-based: only the post at `index` is replaced,
  // all other posts in the array are preserved via map().
  // The index is bound at the call site (EditPanel call in JSX) so EditPanel
  // itself stays index-unaware and its interface doesn't change.
  const setEditedLinkedInBody = (index: number, body: string) => {
    if (!currentPosts) return;
    const updated = currentPosts.linkedinPosts.map((p, i) =>
      i === index ? { ...p, body } : p
    );
    setEditedPosts({ ...currentPosts, linkedinPosts: updated });
  };
  const setEditedLinkedInHashtags = (index: number, hashtags: string[]) => {
    if (!currentPosts) return;
    const updated = currentPosts.linkedinPosts.map((p, i) =>
      i === index ? { ...p, hashtags } : p
    );
    setEditedPosts({ ...currentPosts, linkedinPosts: updated });
  };
  const setEditedX = (tweets: string[]) => {
    if (!currentPosts) return;
    setEditedPosts({ ...currentPosts, x: { ...currentPosts.x, tweets } });
  };
  const setEditedXTags = (hashtags: string[]) => {
    if (!currentPosts) return;
    setEditedPosts({ ...currentPosts, x: { ...currentPosts.x, hashtags } });
  };

  // ── Extension data injection ───────────────────────────────────────────────
  // Three paths for getting entries into the left panel:
  //   C — localStorage (read on mount, written by content-learnpulse.ts)
  //   B — window.__learnpulseInjectData (race-condition fallback)
  //   A — learnpulse:inject CustomEvent (real-time, from popup executeScript)
  useEffect(() => {
    const processInjectedText = (text: string) => {
      if (!text || typeof text !== 'string') return;
      const win = window as unknown as Record<string, unknown>;
      delete win['__learnpulseInjectData'];
      const { entries } = parseInput(text);
      setCapturedEntries(entries);
    };

    // Path C: localStorage on mount (most reliable — set before React hydrates)
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const { text, savedAt } = JSON.parse(stored) as { text: string; savedAt: number };
        const isToday = new Date(savedAt).toDateString() === new Date().toDateString();
        if (isToday && text) processInjectedText(text);
      }
    } catch { /* ignore corrupted data */ }

    // Path B: window variable fallback
    const win = window as unknown as Record<string, { text: string } | undefined>;
    if (win['__learnpulseInjectData']?.text) {
      processInjectedText(win['__learnpulseInjectData']!.text);
    }

    // Path A: CustomEvent listener — fired by popup.ts executeScript (world: MAIN)
    const onInject = (e: Event) => {
      processInjectedText((e as CustomEvent<{ text: string }>).detail?.text);
    };
    window.addEventListener('learnpulse:inject', onInject);

    // Path D: postMessage listener — fired by content-learnpulse.ts
    //
    // Why a separate path? The content script runs in Chrome's isolated world
    // and cannot dispatch CustomEvents that reach React (MAIN world). Instead,
    // it uses window.postMessage(), which crosses the world boundary.
    //
    // Previously the content script injected an inline <script> tag to dispatch
    // the CustomEvent — that was blocked by Next.js's CSP (no 'unsafe-inline').
    // postMessage requires no CSP changes and is the standard cross-world channel.
    const onMessage = (e: MessageEvent<{ type?: string; text?: string }>) => {
      if (e.data?.type === 'learnpulse:inject' && typeof e.data?.text === 'string') {
        processInjectedText(e.data.text);
      }
    };
    window.addEventListener('message', onMessage);

    return () => {
      window.removeEventListener('learnpulse:inject', onInject);
      window.removeEventListener('message', onMessage);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ────────────────────────────────────────────────────────────────
  const isRunning          = ['ingesting', 'classifying', 'clustering', 'generating'].includes(state.stage);
  const learningEntryCount = state.classified.filter((e) => e.isLearning).length;
  const searchCount        = capturedEntries.filter((e) => e.source === 'search').length;
  const urlCount           = capturedEntries.filter((e) => e.source === 'visit').length;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const deleteEntry = useCallback((id: string) => {
    setCapturedEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  /** Runs the AI pipeline with the curated entry list + user instructions */
  const handleAnalyze = useCallback(async () => {
    if (capturedEntries.length === 0 || isRunning) return;
    // Clear any previous manual edits so the new pipeline output shows through.
    // (editedPosts=null means display values fall back to state.posts)
    setEditedPosts(null);
    const searches = capturedEntries.filter((e) => e.source === 'search').map((e) => e.query || e.raw);
    const urls     = capturedEntries.filter((e) => e.source === 'visit').map((e) => e.url || e.raw);
    const text     = [...searches, ...urls].filter(Boolean).join('\n');
    const prefs    = instructions.trim() ? { customInstructions: instructions.trim() } : undefined;
    await runPipeline(text, prefs);
  }, [capturedEntries, isRunning, runPipeline, instructions]);

  /** Loads entries typed/pasted into the manual textarea */
  const handleManualLoad = useCallback(() => {
    if (!manualInput.trim()) return;
    setCapturedEntries(parseInput(manualInput).entries);
    setManualInput('');
  }, [manualInput]);

  /**
   * "Clear History" — removes captured entries from the left panel.
   *
   * THREE-STEP CLEAR:
   *   1. Clear React state immediately (left panel empties now)
   *   2. Remove the localStorage key so a page refresh doesn't repopulate
   *      from the web app's localStorage bridge
   *   3. Send a postMessage to the content script (content-learnpulse.ts)
   *      so it empties chrome.storage.local — otherwise the content script
   *      would re-write the entries back to localStorage on the next refresh,
   *      and the background service worker's chrome.storage.onChanged listener
   *      will automatically reset the extension badge to 0 as a side effect.
   *
   * Does NOT reset the pipeline (posts stay visible after clearing history).
   */
  const handleClearHistory = useCallback(() => {
    // Step 1: clear React state
    setCapturedEntries([]);
    setManualInput('');

    // Step 2: remove the localStorage bridge so refresh doesn't repopulate
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }

    // Step 3: notify the content script to clear chrome.storage.local
    // The content script (content-learnpulse.ts) listens for this message
    // and empties today's entries from chrome.storage.local. This prevents
    // the content script from re-writing entries to localStorage on the next
    // page refresh. The background's chrome.storage.onChanged listener will
    // then fire and call updateBadge(), which resets the extension badge to 0.
    try {
      window.postMessage({ type: 'learnpulse:clear' }, window.location.origin);
    } catch { /* ignore — postMessage is always available on localhost */ }
  }, []);

  /**
   * "Start Over" — resets the pipeline (clears learnings + posts + stage).
   * Keeps captured entries so the user can re-analyze without re-injecting.
   */
  const handleStartOver = useCallback(() => {
    reset();
    setInstructions('');
    setEditingPost(null);
    setEditedPosts(null);
  }, [reset]);

  /**
   * Called by EditPanel when the user regenerates posts from the right panel.
   *
   * Sets editedPosts to the newly generated posts so both the center PostCards
   * and the right editor immediately reflect the new content.
   * setEditedPosts is a stable useState setter — safe to use in useCallback([]).
   */
  const handlePostsRegenerated = useCallback((posts: GeneratedPosts) => {
    setEditedPosts(posts);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-screen-xl mx-auto px-4 py-6 sm:px-6">

        {/* Header */}
        <header className="mb-6 text-center">
          <div className="inline-flex items-center gap-2">
            <span className="text-2xl">🧠</span>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">LearnPulse</h1>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            Get reflective{' '}
            <a href="https://www.linkedin.com" target="_blank" rel="noopener noreferrer" className="font-bold hover:underline rounded px-1 py-0.5" style={{ color: '#0A66C2', backgroundColor: '#e8f0fb' }}>LinkedIn</a>
            {' '}and{' '}
            <a href="https://x.com" target="_blank" rel="noopener noreferrer" className="font-bold hover:underline rounded px-1 py-0.5" style={{ color: '#000000', backgroundColor: '#e5e7eb' }}>X</a>
            {' '}posts about what you actually learned
          </p>
        </header>

        {/* 3-column body */}
        <div className="flex gap-4 items-start">

          {/* ── LEFT COLUMN: Search/Browsing History ─────────────────────── */}
          <div className={`flex-shrink-0 transition-all duration-200 ${leftCollapsed ? 'w-10' : 'w-52'}`}>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm sticky top-4">

              {/* Panel header */}
              <div className="flex items-center justify-between px-3 py-3 border-b border-gray-100">
                {!leftCollapsed && (
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-gray-700 truncate">Search/Browsing History</h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {capturedEntries.length > 0
                        ? `${searchCount} searches · ${urlCount} URLs`
                        : 'No captures yet'}
                    </p>
                  </div>
                )}
                {/* Collapse / expand toggle */}
                <button
                  onClick={() => setLeftCollapsed((v) => !v)}
                  className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors ml-auto"
                  title={leftCollapsed ? 'Expand panel' : 'Collapse panel'}
                >
                  {leftCollapsed ? '→' : '←'}
                </button>
              </div>

              {/* Entry list — hidden when collapsed */}
              {!leftCollapsed && (
                <>
                  <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
                    {capturedEntries.length > 0 ? (
                      <div className="divide-y divide-gray-50">
                        {capturedEntries.map((entry) => {
                          const icon        = entry.source === 'search' ? '🔍' : '🔗';
                          const displayText = entry.title || entry.query || entry.url || entry.raw;
                          return (
                            <div
                              key={entry.id}
                              className="flex items-start gap-2 px-3 py-2 hover:bg-gray-50 group"
                            >
                              <span className="text-xs mt-0.5 flex-shrink-0 select-none">{icon}</span>
                              <span
                                className="flex-1 text-xs text-gray-600 leading-snug min-w-0 truncate"
                                title={entry.query || entry.url || entry.raw}
                              >
                                {displayText}
                              </span>
                              <button
                                onClick={() => deleteEntry(entry.id)}
                                className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label={`Remove: ${displayText}`}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      // Empty state with manual paste fallback
                      <div className="px-3 py-4">
                        <p className="text-xs text-gray-400 mb-1 font-medium">No captures yet</p>
                        <p className="text-xs text-gray-300 mb-3 leading-relaxed">
                          Open the extension popup → click <span className="text-gray-400">Open LearnPulse</span> to load today&apos;s browsing.
                        </p>
                        <div className="border-t border-gray-100 pt-3">
                          <p className="text-xs text-gray-400 mb-1.5">Or paste manually:</p>
                          <textarea
                            value={manualInput}
                            onChange={(e) => setManualInput(e.target.value)}
                            placeholder={"how does TCP work\nhttps://stackoverflow.com/..."}
                            rows={4}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 placeholder-gray-300 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          />
                          {manualInput.trim() && (
                            <Button size="sm" onClick={handleManualLoad} className="w-full mt-1.5">
                              Load entries
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Clear History button */}
                  {capturedEntries.length > 0 && (
                    <div className="p-3 border-t border-gray-100">
                      <button
                        onClick={handleClearHistory}
                        className="w-full text-xs text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-200 rounded-lg py-2 transition-colors"
                      >
                        Clear History
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── CENTER COLUMN: Instructions + Output ─────────────────────── */}
          <div className="flex-1 min-w-0 space-y-6">

            {/* Instructions card + action buttons */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-gray-700">
                  Post Instructions
                  <span className="ml-2 text-xs font-normal text-gray-400">optional</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Tell the AI how to write your post — topic focus, audience, tone, or specific things to include.
                </p>
              </div>

              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={
                  'Examples:\n' +
                  '• "Focus on the debugging journey, not the solution"\n' +
                  '• "Write for a React developer audience"\n' +
                  '• "Emphasize the production impact and what I learned about async I/O"'
                }
                rows={4}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 placeholder-gray-300 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
              />

              {/* Action buttons */}
              <div className="flex items-center gap-3 mt-4 flex-wrap">
                <Button
                  onClick={handleAnalyze}
                  isLoading={isRunning}
                  disabled={capturedEntries.length === 0 || isRunning}
                  size="md"
                >
                  {isRunning ? 'Analyzing...' : 'Analyze and Generate posts'}
                </Button>

                {(state.stage !== 'idle' || capturedEntries.length > 0) && (
                  <Button variant="secondary" size="md" onClick={handleStartOver} disabled={isRunning}>
                    Start Over
                  </Button>
                )}

                {capturedEntries.length > 0 && !isRunning && (
                  <span className="text-xs text-gray-400">
                    {capturedEntries.length} {capturedEntries.length === 1 ? 'entry' : 'entries'} ready
                  </span>
                )}
              </div>
            </div>

            {/* Pipeline progress */}
            {state.stage !== 'idle' && (
              <PipelineStatus
                stage={state.stage}
                error={state.error}
                entryCount={state.entries.length}
                learningCount={learningEntryCount}
              />
            )}

            {/* Your Learnings */}
            {state.clusters.length > 0 && (
              <section>
                <h2 className="text-base font-semibold text-gray-900 mb-3">Your Learnings</h2>
                <ClusterGrid clusters={state.clusters} learningEntryCount={learningEntryCount} />
              </section>
            )}

            {/* Your Posts */}
            {state.stage === 'complete' && state.posts && (
              <PostsSection
                linkedinPosts={linkedinPosts}
                editedX={editedX}
                editedXTags={editedXTags}
                editingPost={editingPost}
                basedOnCount={state.posts.basedOn.length}
                onEditLinkedIn={(index) => {
                  // Toggle: clicking the same card again closes the edit panel
                  setEditingPost((p) =>
                    p?.type === 'linkedin' && p.index === index
                      ? null
                      : { type: 'linkedin', index }
                  );
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onEditX={() => {
                  setEditingPost((p) => p?.type === 'x' ? null : { type: 'x' });
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            )}
          </div>

          {/* ── RIGHT COLUMN: Edit Panel ──────────────────────────────────── */}
          <div className="w-96 flex-shrink-0">
            <EditPanel
              editingPost={editingPost}
              linkedIn={{ body: editedLinkedIn, hashtags: editedLinkedInTags }}
              x={{ tweets: editedX, hashtags: editedXTags }}
              clusters={state.clusters}
              onLinkedInChange={(body) => setEditedLinkedInBody(editingLinkedInIndex, body)}
              onLinkedInTagsChange={(tags) => setEditedLinkedInHashtags(editingLinkedInIndex, tags)}
              onXChange={setEditedX}
              onXTagsChange={setEditedXTags}
              onClose={() => setEditingPost(null)}
              onPostsRegenerated={handlePostsRegenerated}
            />
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Posts Section ────────────────────────────────────────────────────────────
//
// Tab-based layout: [ LinkedIn ] [ X ]
// User switches between platforms via tabs at the top.
// LinkedIn tab: one card per cluster, stacked vertically, styled like a real
//               LinkedIn post (profile header, body, reactions, action bar).
// X tab:        single card styled like a real tweet.
//
// The "Edit" button on each card opens the right-side EditPanel for full editing.
// The active card is highlighted with the platform's brand color when editing.

interface PostsSectionProps {
  /**
   * LinkedIn posts array — one per cluster (3-4 posts), depth-ordered.
   * Already contains any user edits (merged from editedPosts state in the page).
   */
  linkedinPosts:   LinkedInPost[];
  /** Tweets for the X post (1 or more for a thread) */
  editedX:         string[];
  /** Hashtags for the X post */
  editedXTags:     string[];
  editingPost:     EditingPost;
  /** How many learning clusters were used — shown in the subtitle */
  basedOnCount:    number;
  /** Called with the 0-based index of the LinkedIn post the user clicked Edit on */
  onEditLinkedIn:  (index: number) => void;
  onEditX:         () => void;
}

function PostsSection({
  linkedinPosts,
  editedX,
  editedXTags,
  editingPost,
  basedOnCount,
  onEditLinkedIn,
  onEditX,
}: PostsSectionProps) {
  // Which platform tab is active — LinkedIn or X.
  // Defaults to LinkedIn since those posts are the primary output.
  const [activeTab, setActiveTab] = useState<'linkedin' | 'x'>('linkedin');

  return (
    <section>
      {/* Section header */}
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">Your Posts</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          From {basedOnCount} learning {basedOnCount === 1 ? 'journey' : 'journeys'} ·{' '}
          Click <span className="font-medium text-gray-500">Edit</span> to customise before copying
        </p>
      </div>

      {/* ── Platform tabs ────────────────────────────────────────────────── */}
      {/*
        Tab indicator uses the platform's brand color for the active underline
        and badge. The inactive tab sits grey and gains color on hover.
      */}
      <div className="flex border-b border-gray-200 mb-5">
        <button
          onClick={() => setActiveTab('linkedin')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'linkedin'
              ? 'border-[#0A66C2] text-[#0A66C2]'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <span className="w-4 h-4 rounded bg-[#0A66C2] flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">in</span>
          LinkedIn
          {/* Badge showing post count */}
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-normal ${
            activeTab === 'linkedin' ? 'bg-[#e8f0fb] text-[#0A66C2]' : 'bg-gray-100 text-gray-500'
          }`}>
            {linkedinPosts.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('x')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'x'
              ? 'border-black text-black'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <span className="w-4 h-4 rounded bg-black flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">𝕏</span>
          X / Twitter
        </button>
      </div>

      {/* ── LinkedIn posts ───────────────────────────────────────────────── */}
      {/*
        One card per cluster, stacked vertically. Each card looks like a real
        LinkedIn post so the user can visualise how it will appear once posted.
        Cluster name shows under the profile name so the user knows which
        learning journey each post is about.
      */}
      {activeTab === 'linkedin' && (
        <div className="space-y-5">
          {linkedinPosts.map((post, index) => (
            <LinkedInPostCard
              key={`${post.clusterId}-${index}`}
              post={post}
              isEditing={editingPost?.type === 'linkedin' && editingPost.index === index}
              onEdit={() => onEditLinkedIn(index)}
            />
          ))}
        </div>
      )}

      {/* ── X post ───────────────────────────────────────────────────────── */}
      {activeTab === 'x' && (
        <div className="max-w-lg">
          <XPostCard
            tweets={editedX}
            hashtags={editedXTags}
            isEditing={editingPost?.type === 'x'}
            onEdit={onEditX}
          />
        </div>
      )}
    </section>
  );
}

// ─── LinkedIn Post Card ───────────────────────────────────────────────────────
//
// Styled to look like a real LinkedIn post so the user can see how it will
// appear once posted. Shows a placeholder profile, the full post body, hashtags,
// mock engagement stats, and a row of action buttons — all decorative except
// the "Edit" button which opens the right-side EditPanel.
//
// The card is highlighted with LinkedIn blue when it's being edited.

function LinkedInPostCard({
  post,
  isEditing,
  onEdit,
}: {
  post:      LinkedInPost;
  isEditing: boolean;
  onEdit:    () => void;
}) {
  // Track clipboard copy state — shows "Copied!" for 2 seconds then resets
  const [copied, setCopied] = useState(false);

  // Full text that gets copied: post body + hashtags as "#tag #tag" on a new line
  const fullText = [
    post.body,
    post.hashtags.map((h) => `#${h}`).join(' '),
  ].filter(Boolean).join('\n\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — fail silently
    }
  };

  return (
    <div
      className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all duration-200 ${
        isEditing
          ? 'border-[#0A66C2] ring-2 ring-[#0A66C2]/10'
          : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      {/* ── Post header ───────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-3">
          {/* Profile picture placeholder — checkerboard pattern matching the mockup */}
          <div
            className="w-12 h-12 rounded-full flex-shrink-0 border border-gray-200"
            style={{
              backgroundImage:
                'repeating-conic-gradient(#d1d5db 0% 25%, #e5e7eb 0% 50%)',
              backgroundSize: '8px 8px',
            }}
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {/* Cluster name as the post "author role" — tells the user which
                    learning journey this post is about */}
                <p className="text-sm font-semibold text-gray-900 leading-tight truncate">
                  Your Name
                </p>
                <p className="text-xs text-gray-500 mt-0.5 truncate" title={post.clusterName}>
                  {post.clusterName}
                </p>
                <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                  <span>1w</span>
                  <span>•</span>
                  <span>Edited</span>
                  <span>•</span>
                  {/* Globe icon = public visibility */}
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor" aria-label="Public">
                    <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm5.85 5h-2.11a9.4 9.4 0 0 0-.83-2.38A6.02 6.02 0 0 1 13.85 5zM8 1.04c.75 1.02 1.32 2.15 1.66 3.46H6.34C6.68 3.19 7.25 2.06 8 1.04zM2.15 5a6.02 6.02 0 0 1 2.94-2.38A9.4 9.4 0 0 0 4.26 5H2.15zm-.11 1h2.2c-.06.65-.1 1.32-.1 2s.04 1.35.1 2h-2.2A6.01 6.01 0 0 1 2.04 8c0-.69.05-1.36.15-2zm.26 5h2.11c.22.85.51 1.65.9 2.38A6.02 6.02 0 0 1 2.3 11zm5.7 3.96c-.75-1.02-1.32-2.15-1.66-3.46h3.32c-.34 1.31-.91 2.44-1.66 3.46zm0-4.46H5.66A10.7 10.7 0 0 1 5.5 8c0-.72.06-1.38.16-2.5h4.68C10.44 6.62 10.5 7.28 10.5 8s-.06 1.38-.16 2.5H8zM11.74 11h2.11a6.02 6.02 0 0 1-2.94 2.38c.39-.73.68-1.53.9-2.38zm.22-1c.06-.65.1-1.32.1-2s-.04-1.35-.1-2h2.2c.1.64.15 1.31.15 2s-.05 1.36-.15 2h-2.2zm-1.38-7.38c.39.73.68 1.53.9 2.38h-2.11c.21-.85.5-1.64.9-2.38z"/>
                  </svg>
                </div>
              </div>

              {/* Controls: Edit + Copy buttons + decorative ••• menu */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={onEdit}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    isEditing
                      ? 'bg-[#0A66C2]/10 text-[#0A66C2] border-[#0A66C2]/30 font-semibold'
                      : 'text-gray-500 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  {isEditing ? 'Editing…' : 'Edit'}
                </button>
                {/* Copy button — copies the full post (body + hashtags) to clipboard */}
                <button
                  onClick={handleCopy}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    copied
                      ? 'bg-green-50 text-green-600 border-green-200 font-semibold'
                      : 'text-gray-500 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
                <span className="text-gray-400 text-base font-bold leading-none select-none" aria-hidden>•••</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Post body ───────────────────────────────────────────────────── */}
        {/*
          Show the full post body — no line-clamp — so the user can review the
          complete text before copying. Long posts are naturally tall cards.
        */}
        <div className="mt-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
          {post.body || <span className="text-gray-400 italic">No content generated yet</span>}
        </div>

        {/* Hashtags in LinkedIn blue — matches how they appear on the platform */}
        {post.hashtags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {post.hashtags.map((h) => (
              <span key={h} className="text-sm text-[#0A66C2] font-medium">#{h}</span>
            ))}
          </div>
        )}
      </div>

      {/* ── Engagement row (decorative) ────────────────────────────────────── */}
      <div className="px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <span>👍</span><span>❤️</span>
          <span className="ml-0.5">1,034</span>
        </div>
        <span className="text-xs text-gray-500 hover:underline cursor-pointer">
          15 comments · 17 reposts
        </span>
      </div>

      {/* ── Action bar (decorative) ─────────────────────────────────────────── */}
      <div className="px-1 py-1 border-t border-gray-100 flex items-center justify-around">
        {[
          { label: 'Like',    icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
          )},
          { label: 'Comment', icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          )},
          { label: 'Repost',  icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          )},
          { label: 'Send',    icon: (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          )},
        ].map(({ label, icon }) => (
          <button
            key={label}
            className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-700 rounded-lg transition-colors flex-1 justify-center"
          >
            {icon}
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── X Post Card ─────────────────────────────────────────────────────────────
//
// Styled to look like a real tweet. Shows a placeholder profile, the tweet text
// (or thread), mock engagement stats, and action icons — all decorative except
// the "Edit" button. Highlighted with a dark border when being edited.

function XPostCard({
  tweets,
  hashtags,
  isEditing,
  onEdit,
}: {
  tweets:    string[];
  hashtags:  string[];
  isEditing: boolean;
  onEdit:    () => void;
}) {
  // Track clipboard copy state — shows "✓ Copied" for 2 seconds then resets
  const [copied, setCopied] = useState(false);

  // Full text: thread tweets joined by blank lines, then hashtags on a new line
  const fullText = [
    tweets.join('\n\n'),
    hashtags.map((h) => `#${h}`).join(' '),
  ].filter(Boolean).join('\n\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — fail silently
    }
  };

  return (
    <div
      className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all duration-200 ${
        isEditing
          ? 'border-gray-800 ring-2 ring-gray-200'
          : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      {/* ── Tweet header ─────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-start gap-3">
          {/* Profile pic placeholder */}
          <div
            className="w-10 h-10 rounded-full flex-shrink-0 border border-gray-200"
            style={{
              backgroundImage:
                'repeating-conic-gradient(#d1d5db 0% 25%, #e5e7eb 0% 50%)',
              backgroundSize: '8px 8px',
            }}
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <span className="text-sm font-bold text-gray-900 truncate">Your Name</span>
                <span className="text-xs text-gray-500 truncate">@yourhandle · 1h</span>
              </div>
              {/* Edit + Copy buttons + decorative ••• */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={onEdit}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    isEditing
                      ? 'bg-gray-900 text-white border-gray-900 font-semibold'
                      : 'text-gray-500 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  {isEditing ? 'Editing…' : 'Edit'}
                </button>
                {/* Copy button — copies full tweet thread + hashtags to clipboard */}
                <button
                  onClick={handleCopy}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    copied
                      ? 'bg-green-50 text-green-600 border-green-200 font-semibold'
                      : 'text-gray-500 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
                <span className="text-gray-400 text-base font-bold leading-none select-none" aria-hidden>•••</span>
              </div>
            </div>

            {/* ── Tweet text ────────────────────────────────────────────── */}
            {/* Thread tweets separated by a thin divider */}
            <div className="mt-2 space-y-3">
              {tweets.map((tweet, i) => (
                <p key={i} className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap">
                  {tweet}
                </p>
              ))}
            </div>

            {/* Hashtags in Twitter blue */}
            {hashtags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {hashtags.map((h) => (
                  <span key={h} className="text-sm text-[#1d9bf0] font-medium">#{h}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Engagement stats (decorative) ─────────────────────────────────── */}
      <div className="px-4 py-2.5 border-t border-gray-100 flex items-center gap-5 text-xs text-gray-500">
        <span><strong className="text-gray-800 font-semibold">3,290</strong> Reposts</span>
        <span><strong className="text-gray-800 font-semibold">1,234</strong> Quotes</span>
        <span><strong className="text-gray-800 font-semibold">15.6K</strong> Likes</span>
        <span><strong className="text-gray-800 font-semibold">73K</strong> Views</span>
      </div>

      {/* ── Action icons (decorative) ─────────────────────────────────────── */}
      <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-around text-gray-400">
        {/* Reply */}
        <button className="p-2 rounded-full hover:bg-[#1d9bf0]/10 hover:text-[#1d9bf0] transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        {/* Repost */}
        <button className="p-2 rounded-full hover:bg-green-500/10 hover:text-green-500 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
        </button>
        {/* Like */}
        <button className="p-2 rounded-full hover:bg-red-500/10 hover:text-red-500 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
        {/* Bookmark */}
        <button className="p-2 rounded-full hover:bg-[#1d9bf0]/10 hover:text-[#1d9bf0] transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        {/* Share */}
        <button className="p-2 rounded-full hover:bg-[#1d9bf0]/10 hover:text-[#1d9bf0] transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Edit Panel ───────────────────────────────────────────────────────────────
//
// Right column panel. Two states:
//   Idle (editingPost === null): shows the placeholder description from the sketch
//   Active (editingPost !== null): shows the full post editor for LinkedIn or X

interface EditPanelProps {
  editingPost:          EditingPost;
  linkedIn:             { body: string; hashtags: string[] };
  x:                    { tweets: string[]; hashtags: string[] };
  /** The clusters produced by the pipeline — sent to /api/generate on regenerate */
  clusters:             LearningCluster[];
  onLinkedInChange:     (val: string) => void;
  onLinkedInTagsChange: (tags: string[]) => void;
  onXChange:            (tweets: string[]) => void;
  onXTagsChange:        (tags: string[]) => void;
  onClose:              () => void;
  /** Called with the new posts after a successful regeneration */
  onPostsRegenerated:   (posts: GeneratedPosts) => void;
}

// ─── Edit Panel ───────────────────────────────────────────────────────────────
//
// Right column panel. Two states:
//   Idle (editingPost === null): shows the placeholder description from the sketch
//   Active (editingPost !== null): shows:
//     1. Regenerate section — textarea + button that calls /api/generate with new
//        instructions, then fires onPostsRegenerated() to sync all edit state
//     2. Manual editor — LinkedIn or X specific textarea/hashtag/link UI
//
// WHY REGENERATE LIVES HERE:
//   The regenerate call needs clusters (from the pipeline) and a custom instructions
//   string (from the user). The result (new posts) bubbles up to the page via
//   onPostsRegenerated so both PostCards and this panel stay in sync.

function EditPanel({
  editingPost,
  linkedIn,
  x,
  clusters,
  onLinkedInChange,
  onLinkedInTagsChange,
  onXChange,
  onXTagsChange,
  onClose,
  onPostsRegenerated,
}: EditPanelProps) {
  // ── Regeneration state ─────────────────────────────────────────────────────
  const [regenInstructions, setRegenInstructions] = useState('');
  const [isRegenerating, setIsRegenerating]       = useState(false);
  const [regenError, setRegenError]               = useState<string | null>(null);

  // Reset error when the user switches between LinkedIn and X,
  // so a stale error from one editor doesn't bleed into the other.
  useEffect(() => {
    setRegenError(null);
    setIsRegenerating(false);
  }, [editingPost]);

  /**
   * handleRegenerate — sends the current clusters + user instructions to
   * /api/generate, then notifies the page so all 4 edit states update.
   *
   * HOW IT FLOWS:
   *   1. User types instructions in the regenerate textarea
   *   2. User clicks "Regenerate Posts"
   *   3. We POST to /api/generate with { clusters, preferences: { customInstructions } }
   *   4. Server calls generatePosts() with the instructions guiding the AI
   *   5. On success: onPostsRegenerated() updates editedLinkedIn, editedLinkedInTags,
   *      editedX, editedXTags — both PostCards and this panel reflect the new content
   *   6. On failure: regenError is shown inline under the instructions textarea
   */
  const handleRegenerate = async () => {
    if (!regenInstructions.trim() || isRegenerating || clusters.length === 0) return;
    setIsRegenerating(true);
    setRegenError(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusters,
          preferences: { customInstructions: regenInstructions.trim() },
        }),
      });
      const data = (await res.json()) as { success: boolean; data?: GeneratedPosts; error?: string };
      if (!data.success || !data.data) throw new Error(data.error ?? 'Regeneration failed');
      // Push the new posts up to the page — updates all 4 edit states at once
      onPostsRegenerated(data.data);
      setRegenInstructions('');
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : 'Regeneration failed. Please try again.');
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm sticky top-4">

      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          {editingPost?.type === 'linkedin' ? 'Editing: LinkedIn'
           : editingPost?.type === 'x'      ? 'Editing: X / Twitter'
           : 'Edit Area for Posts'}
        </h2>
        {editingPost && (
          <button
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4 max-h-[calc(100vh-120px)] overflow-y-auto">
        {editingPost === null ? (
          // ── Placeholder state ────────────────────────────────────────────────
          <div className="text-xs text-gray-400 leading-relaxed space-y-2">
            <p>When clicked on edit, post loads here.</p>
            <ul className="space-y-1 text-gray-300">
              <li>• Regenerate with custom instructions</li>
              <li>• Manually edit text</li>
              <li>• Remove hashtags</li>
            </ul>
          </div>
        ) : (
          // ── Active editing state ─────────────────────────────────────────────
          <div className="space-y-4">

            {/* ── Regenerate section ────────────────────────────────────────── */}
            {/*
              This section lets the user give the AI new instructions and
              regenerate both posts from scratch using the same clusters.
              It sits above the manual editor so the user can either
              regenerate OR manually tweak — whichever they prefer.
            */}
            <div className="pb-4 border-b border-gray-100">
              <p className="text-xs text-gray-500 mb-1.5 font-medium">Regenerate with instructions</p>
              <p className="text-[10px] text-gray-400 mb-2 leading-relaxed">
                Describe the style, tone, or angle you want. The AI will rewrite both posts using your same learning data.
              </p>
              <textarea
                value={regenInstructions}
                onChange={(e) => setRegenInstructions(e.target.value)}
                placeholder={
                  'e.g. "make it more casual"\n"focus on the debugging part"\n"write for senior engineers"'
                }
                rows={3}
                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 placeholder-gray-300 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              {/* Inline error message under the textarea */}
              {regenError && (
                <p className="text-[10px] text-red-500 mt-1">{regenError}</p>
              )}
              <button
                onClick={handleRegenerate}
                disabled={!regenInstructions.trim() || isRegenerating || clusters.length === 0}
                className="mt-2 w-full text-xs py-1.5 px-3 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-1.5"
              >
                {isRegenerating ? (
                  <>
                    {/* Spinner — reuses the same SVG pattern as Button.tsx */}
                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Regenerating…
                  </>
                ) : (
                  'Regenerate Posts'
                )}
              </button>
              <p className="text-[10px] text-gray-300 mt-1 text-center">
                Regenerates both LinkedIn and X posts
              </p>
            </div>

            {/* ── Manual editor ─────────────────────────────────────────────── */}
            {editingPost?.type === 'linkedin' ? (
              <LinkedInEditor
                body={linkedIn.body}
                hashtags={linkedIn.hashtags}
                onBodyChange={onLinkedInChange}
                onHashtagsChange={onLinkedInTagsChange}
              />
            ) : (
              <XEditor
                tweets={x.tweets}
                hashtags={x.hashtags}
                onTweetsChange={onXChange}
                onHashtagsChange={onXTagsChange}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LinkedIn Editor ──────────────────────────────────────────────────────────
//
// Full edit UI for the LinkedIn post.
// Shows editable body textarea, char count, hashtag chips, copy button,
// and an "Add Link" helper that appends a URL to the post body.

function LinkedInEditor({
  body,
  hashtags,
  onBodyChange,
  onHashtagsChange,
}: {
  body:             string;
  hashtags:         string[];
  onBodyChange:     (val: string) => void;
  onHashtagsChange: (tags: string[]) => void;
}) {
  const charCount   = body.length;
  const isOverLimit = charCount > 3000;
  const fullText    = [body, hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n');

  const removeHashtag = (tag: string) => {
    onHashtagsChange(hashtags.filter((h) => h !== tag));
  };

  return (
    <div className="space-y-3">
      {/* Char count + body textarea */}
      <div className="flex justify-end">
        <span className={`text-xs font-mono ${isOverLimit ? 'text-red-500' : 'text-gray-400'}`}>
          {charCount.toLocaleString()} / 3,000
        </span>
      </div>
      <textarea
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        rows={14}
        className="w-full text-xs text-gray-800 bg-gray-50 rounded-lg p-3 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none leading-relaxed"
      />

      {/* Hashtag chips — click × to remove */}
      {hashtags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {hashtags.map((h) => (
            <span
              key={h}
              className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full"
            >
              #{h}
              <button onClick={() => removeHashtag(h)} className="hover:text-red-400 transition-colors leading-none">×</button>
            </span>
          ))}
        </div>
      )}

      {/* Copy */}
      <div className="pt-1 border-t border-gray-100 flex justify-end">
        <CopyButton text={fullText} label="Copy LinkedIn Post" />
      </div>
    </div>
  );
}

// ─── X Editor ────────────────────────────────────────────────────────────────
//
// Full edit UI for X / Twitter posts.
// Handles both single tweets and multi-tweet threads.
// Each tweet is a separate textarea with its own 280-char counter.

function XEditor({
  tweets,
  hashtags,
  onTweetsChange,
  onHashtagsChange,
}: {
  tweets:            string[];
  hashtags:          string[];
  onTweetsChange:    (tweets: string[]) => void;
  onHashtagsChange:  (tags: string[]) => void;
}) {
  const updateTweet = (index: number, value: string) => {
    const updated = [...tweets];
    updated[index] = value;
    onTweetsChange(updated);
  };

  const fullText = [
    tweets.join('\n\n'),
    hashtags.map((h) => `#${h}`).join(' '),
  ].filter(Boolean).join('\n\n');

  const removeHashtag = (tag: string) => {
    onHashtagsChange(hashtags.filter((h) => h !== tag));
  };

  return (
    <div className="space-y-3">
      {/* Tweet textareas */}
      <div className="space-y-2">
        {tweets.map((tweet, index) => {
          const isOver = tweet.length > 280;
          return (
            <div key={index}>
              {tweets.length > 1 && (
                <div className="flex justify-between mb-0.5">
                  <span className="text-xs text-gray-400">{index + 1} of {tweets.length}</span>
                  <span className={`text-xs font-mono ${isOver ? 'text-red-500' : 'text-gray-400'}`}>
                    {tweet.length} / 280
                  </span>
                </div>
              )}
              <textarea
                value={tweet}
                onChange={(e) => updateTweet(index, e.target.value)}
                rows={tweets.length > 1 ? 5 : 10}
                className="w-full text-xs text-gray-800 bg-gray-50 rounded-lg p-3 border border-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none leading-relaxed"
              />
              {tweets.length === 1 && (
                <div className="flex justify-end mt-0.5">
                  <span className={`text-xs font-mono ${isOver ? 'text-red-500' : 'text-gray-400'}`}>
                    {tweet.length} / 280
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Hashtag chips — click × to remove */}
      {hashtags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {hashtags.map((h) => (
            <span key={h} className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
              #{h}
              <button onClick={() => removeHashtag(h)} className="hover:text-red-400 transition-colors leading-none">×</button>
            </span>
          ))}
        </div>
      )}

      {/* Copy */}
      <div className="pt-1 border-t border-gray-100 flex justify-end">
        <CopyButton text={fullText} label="Copy X Post" />
      </div>
    </div>
  );
}
