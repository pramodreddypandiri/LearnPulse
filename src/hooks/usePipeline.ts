// ══════════════════════════════════════════════════════════════════════
// usePipeline — Pipeline Orchestration Hook
// src/hooks/usePipeline.ts
//
// PURPOSE:
//   The central brain of the LearnPulse UI. This hook manages the entire
//   4-stage AI pipeline and exposes the current state to any component
//   that wants to know "what's happening right now?"
//
// STATE MACHINE:
//   idle → ingesting → classifying → clustering → generating → complete
//                                                            ↘ error (at any stage)
//
// WHAT THIS HOOK DOES:
//   1. Accepts raw user input (pasted text or file content)
//   2. Runs it through the parser (client-side, instant)
//   3. Calls /api/classify with the parsed entries
//   4. Filters out noise entries (isLearning=false)
//   5. Calls /api/cluster with the learning entries
//   6. Calls /api/generate with the clusters
//   7. Updates state at each step so the UI can show live progress
//
// HOW COMPONENTS USE THIS:
//   const { state, runPipeline, reset } = usePipeline();
//
//   // Trigger analysis
//   await runPipeline(rawTextFromTextarea);
//
//   // Read state for UI
//   state.stage        → 'classifying' | 'complete' | etc.
//   state.clusters     → LearningCluster[] (after clustering)
//   state.posts        → GeneratedPosts | null (after generating)
//   state.error        → string | null (if something went wrong)
//
// ERROR HANDLING PHILOSOPHY:
//   - Each stage catches its own errors and sets state.stage = 'error'
//   - The error message is user-friendly (not a stack trace)
//   - The user can reset and try again
//   - We never silently swallow errors (that leads to confusing blank states)
//
// AFFECT ON THE SYSTEM:
//   - Used by: src/app/page.tsx (main dashboard)
//   - Calls: /api/classify, /api/cluster, /api/generate
//   - Uses: src/lib/parsers/index.ts (parseInput)
//   - Reads/writes: PipelineState (from src/lib/types)
// ══════════════════════════════════════════════════════════════════════

'use client';

import { useState, useCallback } from 'react';
import { parseInput } from '@/lib/parsers';
import type {
  PipelineState,
  PipelineStage,
  HistoryEntry,
  ClassifiedEntry,
  LearningCluster,
  GeneratedPosts,
  UserPreferences,
} from '@/lib/types';

// ─── Initial State ───────────────────────────────────────────────────────────

/**
 * The pipeline starts in 'idle' with all arrays empty.
 * reset() returns to this exact state.
 */
const INITIAL_STATE: PipelineState = {
  stage: 'idle',
  entries: [],
  classified: [],
  clusters: [],
  posts: null,
  error: null,
};

// ─── Hook Return Type ────────────────────────────────────────────────────────

export interface UsePipelineReturn {
  /** Current pipeline state — the UI reads this to know what to render */
  state: PipelineState;

  /**
   * Starts the pipeline analysis.
   * @param rawInput - Raw text from the textarea (pasted or uploaded)
   * @param preferences - Optional user preferences for post generation
   */
  runPipeline: (rawInput: string, preferences?: UserPreferences) => Promise<void>;

  /** Resets pipeline to initial idle state — clears all results */
  reset: () => void;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * usePipeline — Main hook for running the LearnPulse analysis pipeline.
 *
 * Manages the complete flow:
 *   parse input → classify → cluster → generate posts
 *
 * All state transitions are atomic updates (one setState call per stage)
 * to prevent UI flickering or intermediate inconsistent states.
 */
export function usePipeline(): UsePipelineReturn {
  const [state, setState] = useState<PipelineState>(INITIAL_STATE);

  /**
   * Helper to update a specific part of the pipeline state.
   * Using functional updates (setState(prev => ...)) ensures we always
   * update from the latest state, even if multiple updates are batched.
   */
  const updateState = useCallback(
    (updates: Partial<PipelineState>) => {
      setState((prev) => ({ ...prev, ...updates }));
    },
    []
  );

  /**
   * Transitions the pipeline to a new stage.
   * Separate helper for stage updates to make the flow readable.
   */
  const setStage = useCallback(
    (stage: PipelineStage) => {
      setState((prev) => ({ ...prev, stage }));
    },
    []
  );

  /**
   * Sets the error state and stops the pipeline.
   */
  const setError = useCallback(
    (errorMessage: string) => {
      setState((prev) => ({ ...prev, stage: 'error', error: errorMessage }));
    },
    []
  );

  // ─── Main Pipeline Function ─────────────────────────────────────────────────

  const runPipeline = useCallback(
    async (rawInput: string, preferences?: UserPreferences): Promise<void> => {
      // Reset to clean state before starting (handles re-runs)
      setState(INITIAL_STATE);

      // ── Stage 1: Ingest ──────────────────────────────────────────────────────
      // Parse the raw input into structured HistoryEntry[]
      // This runs entirely client-side — no network call, instant.
      setStage('ingesting');

      let entries: HistoryEntry[];
      try {
        const result = parseInput(rawInput);
        entries = result.entries;
      } catch (err) {
        setError('Failed to parse your input. Please check the format and try again.');
        return;
      }

      if (entries.length === 0) {
        setError(
          'No history entries found in your input. ' +
          'Try pasting search queries (one per line) or URLs.'
        );
        return;
      }

      // Update state with parsed entries before moving to classification
      updateState({ entries, stage: 'classifying' });

      // ── Stage 2: Classify ────────────────────────────────────────────────────
      // Send entries to /api/classify — the AI labels each entry with intent and topic
      let classified: ClassifiedEntry[];
      try {
        const classifyResponse = await fetch('/api/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Serialize entries — Date objects become strings (valid ISO format)
          body: JSON.stringify({ entries }),
        });

        if (!classifyResponse.ok) {
          const errorData = await classifyResponse.json().catch(() => null);
          throw new Error(errorData?.error ?? `Classification API returned ${classifyResponse.status}`);
        }

        const classifyData = await classifyResponse.json();

        if (!classifyData.success) {
          throw new Error(classifyData.error ?? 'Classification failed');
        }

        classified = classifyData.data as ClassifiedEntry[];
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Classification failed';
        setError(`Classification error: ${message}`);
        return;
      }

      // Filter to learning entries only before clustering
      // Noise entries are preserved in state.classified for display,
      // but not sent to the clusterer
      const learningEntries = classified.filter((e) => e.isLearning);

      updateState({ classified, stage: 'clustering' });

      if (learningEntries.length === 0) {
        setError(
          'No learning activity found in your history. ' +
          'The AI classified everything as noise (utility searches, entertainment, etc.). ' +
          'Try including more technical searches or documentation URLs.'
        );
        return;
      }

      // ── Stage 3: Cluster ─────────────────────────────────────────────────────
      // Send learning entries to /api/cluster — AI groups them into learning journeys
      let clusters: LearningCluster[];
      try {
        const clusterResponse = await fetch('/api/cluster', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: learningEntries }),
        });

        if (!clusterResponse.ok) {
          const errorData = await clusterResponse.json().catch(() => null);
          throw new Error(errorData?.error ?? `Clustering API returned ${clusterResponse.status}`);
        }

        const clusterData = await clusterResponse.json();

        if (!clusterData.success) {
          throw new Error(clusterData.error ?? 'Clustering failed');
        }

        clusters = clusterData.data as LearningCluster[];
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Clustering failed';
        setError(`Clustering error: ${message}`);
        return;
      }

      updateState({ clusters, stage: 'generating' });

      // ── Stage 4: Generate ────────────────────────────────────────────────────
      // Send clusters to /api/generate — AI writes LinkedIn + X posts
      let posts: GeneratedPosts;
      try {
        const generateResponse = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clusters, preferences }),
        });

        if (!generateResponse.ok) {
          const errorData = await generateResponse.json().catch(() => null);
          throw new Error(errorData?.error ?? `Generation API returned ${generateResponse.status}`);
        }

        const generateData = await generateResponse.json();

        if (!generateData.success) {
          throw new Error(generateData.error ?? 'Post generation failed');
        }

        posts = generateData.data as GeneratedPosts;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Post generation failed';
        setError(`Generation error: ${message}`);
        return;
      }

      // ── Complete ─────────────────────────────────────────────────────────────
      // All stages succeeded — update to final state
      setState({
        stage: 'complete',
        entries,
        classified,
        clusters,
        posts,
        error: null,
      });
    },
    [updateState, setStage, setError]
  );

  // ─── Reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { state, runPipeline, reset };
}
