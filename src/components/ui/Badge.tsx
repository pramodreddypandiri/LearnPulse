// ══════════════════════════════════════════════════════════════════════
// Badge — Intent/Type Label Component
// src/components/ui/Badge.tsx
//
// PURPOSE:
//   Small colored label pills used to display LearningIntent and
//   ClusterDepth values throughout the app.
//
// USAGE:
//   <Badge intent="learning" />        → green "learning" pill
//   <Badge intent="debugging" />       → red "debugging" pill
//   <Badge depth="deep" />             → purple "deep" pill
//
// COLOR CODING:
//   The colors follow intuitive conventions:
//   - Learning intents: green=active learning, yellow=exploring, blue=reference,
//     orange=building, red=debugging, gray=noise
//   - Depth: purple=deep, blue=moderate, gray=surface
//
// AFFECT ON THE SYSTEM:
//   - Used by: ClusterCard (depth badge), EntryList (intent badges)
//   - Exported from: src/components/ui/index.ts
// ══════════════════════════════════════════════════════════════════════

import type { LearningIntent, ClusterDepth } from '@/lib/types';

interface IntentBadgeProps {
  intent: LearningIntent;
  className?: string;
}

interface DepthBadgeProps {
  depth: ClusterDepth;
  className?: string;
}

/** Color map for LearningIntent values */
const INTENT_COLORS: Record<LearningIntent, string> = {
  learning:  'bg-green-100 text-green-800',
  debugging: 'bg-red-100 text-red-800',
  exploring: 'bg-yellow-100 text-yellow-800',
  reference: 'bg-blue-100 text-blue-800',
  building:  'bg-orange-100 text-orange-800',
  noise:     'bg-gray-100 text-gray-500',
};

/** Color map for ClusterDepth values */
const DEPTH_COLORS: Record<ClusterDepth, string> = {
  deep:     'bg-purple-100 text-purple-800',
  moderate: 'bg-blue-100 text-blue-800',
  surface:  'bg-gray-100 text-gray-600',
};

const BASE = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium';

/**
 * Badge that displays a LearningIntent with appropriate color coding.
 * Used in entry lists to show what kind of activity each entry represents.
 */
export function IntentBadge({ intent, className = '' }: IntentBadgeProps) {
  return (
    <span className={`${BASE} ${INTENT_COLORS[intent]} ${className}`}>
      {intent}
    </span>
  );
}

/**
 * Badge that displays a ClusterDepth value.
 * Used on ClusterCard to indicate how deeply the user engaged with a topic.
 */
export function DepthBadge({ depth, className = '' }: DepthBadgeProps) {
  const icons: Record<ClusterDepth, string> = {
    deep: '🔥',
    moderate: '📖',
    surface: '👀',
  };

  return (
    <span className={`${BASE} ${DEPTH_COLORS[depth]} ${className}`}>
      <span className="mr-1">{icons[depth]}</span>
      {depth}
    </span>
  );
}
