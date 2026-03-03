// ══════════════════════════════════════════════════════════════════════
// PipelineStatus — Live Pipeline Stage Indicator
// src/components/dashboard/PipelineStatus.tsx
//
// PURPOSE:
//   Shows the user which stage of the AI pipeline is currently running.
//   Provides real-time feedback so users know the app is working,
//   not frozen (AI calls can take 5-15 seconds total).
//
// WHAT IT RENDERS:
//   A horizontal progress bar with 4 steps:
//   [Parse] → [Classify] → [Cluster] → [Generate]
//   The current step is highlighted. Completed steps show a checkmark.
//
// STAGE MAPPING:
//   PipelineStage     → Which step is highlighted
//   'idle'            → Nothing (component returns null)
//   'ingesting'       → Step 1 (Parse) is active
//   'classifying'     → Step 2 (Classify) is active
//   'clustering'      → Step 3 (Cluster) is active
//   'generating'      → Step 4 (Generate) is active
//   'complete'        → All steps done (checkmarks)
//   'error'           → Shows error banner instead
//
// AFFECT ON THE SYSTEM:
//   - Used by: src/app/page.tsx
//   - Reads: PipelineStage from usePipeline().state
//   - No user interactions — purely informational display
// ══════════════════════════════════════════════════════════════════════

import { Spinner } from '@/components/ui';
import type { PipelineStage } from '@/lib/types';

interface PipelineStatusProps {
  stage: PipelineStage;
  error: string | null;
  entryCount?: number;
  learningCount?: number;
}

// The four pipeline steps visible to the user
const STEPS: Array<{ key: PipelineStage; label: string; description: string }> = [
  { key: 'ingesting',   label: 'Parse',     description: 'Reading your history' },
  { key: 'classifying', label: 'Classify',  description: 'Identifying learning signals' },
  { key: 'clustering',  label: 'Cluster',   description: 'Grouping into journeys' },
  { key: 'generating',  label: 'Generate',  description: 'Writing your posts' },
];

// Order of stages for determining "completed" vs "active" vs "pending"
const STAGE_ORDER: PipelineStage[] = [
  'ingesting', 'classifying', 'clustering', 'generating', 'complete'
];

/**
 * PipelineStatus — Shows which stage of the pipeline is active.
 *
 * Returns null during 'idle' stage (nothing to show before analysis starts).
 * Shows an error banner if stage === 'error'.
 */
export function PipelineStatus({
  stage,
  error,
  entryCount,
  learningCount,
}: PipelineStatusProps) {
  // Don't render during idle
  if (stage === 'idle') return null;

  // Show error banner
  if (stage === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-5">
        <div className="flex items-start gap-3">
          <span className="text-red-500 text-xl mt-0.5">⚠</span>
          <div>
            <p className="font-medium text-red-800">Analysis failed</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const currentStageIndex = STAGE_ORDER.indexOf(stage);

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-6 py-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {stage !== 'complete' && <Spinner size="sm" />}
          {stage === 'complete' && <span className="text-green-500">✓</span>}
          <span className="text-sm font-medium text-gray-700">
            {stage === 'complete' ? 'Analysis complete!' : 'Analyzing your learning...'}
          </span>
        </div>

        {/* Entry counts — shown after classification */}
        {entryCount !== undefined && learningCount !== undefined && stage !== 'classifying' && (
          <span className="text-xs text-gray-500">
            {learningCount} learning entries from {entryCount} total
          </span>
        )}
      </div>

      {/* Step indicators */}
      <div className="flex items-center">
        {STEPS.map((step, index) => {
          const stepOrder = STAGE_ORDER.indexOf(step.key);
          const isCompleted = currentStageIndex > stepOrder;
          const isActive = currentStageIndex === stepOrder;

          return (
            <div key={step.key} className="flex items-center flex-1">
              {/* Step circle */}
              <div className="flex flex-col items-center flex-1">
                <div
                  className={`
                    w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all
                    ${isCompleted ? 'bg-indigo-600 text-white' : ''}
                    ${isActive ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-400' : ''}
                    ${!isCompleted && !isActive ? 'bg-gray-100 text-gray-400' : ''}
                  `}
                >
                  {isCompleted ? '✓' : index + 1}
                </div>
                <p className={`text-xs mt-1 font-medium ${isActive ? 'text-indigo-700' : isCompleted ? 'text-gray-600' : 'text-gray-400'}`}>
                  {step.label}
                </p>
                {isActive && (
                  <p className="text-xs text-gray-400 text-center mt-0.5 max-w-[80px]">
                    {step.description}
                  </p>
                )}
              </div>

              {/* Connector line between steps */}
              {index < STEPS.length - 1 && (
                <div className={`h-0.5 w-full mx-1 mb-6 transition-all ${isCompleted ? 'bg-indigo-600' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
