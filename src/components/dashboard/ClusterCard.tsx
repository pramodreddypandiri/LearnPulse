// ══════════════════════════════════════════════════════════════════════
// ClusterCard — Learning Journey Card
// src/components/dashboard/ClusterCard.tsx
//
// PURPOSE:
//   Displays one LearningCluster as a card showing:
//   - Cluster name (e.g., "Async Python Programming")
//   - Depth badge (surface / moderate / deep)
//   - Narrative (the AI's story of how the user explored the topic)
//   - Inferred goal (what the user was trying to accomplish)
//   - Entry count (how many searches/URLs are in this cluster)
//   - Keywords (as tag pills)
//   - Expandable entry list (click to see individual queries/URLs)
//
// INTERACTION:
//   - The card is initially collapsed (showing name + narrative + stats)
//   - Clicking "Show entries" expands to reveal individual entries with badges
//
// AFFECT ON THE SYSTEM:
//   - Used by: ClusterGrid.tsx
//   - Reads: LearningCluster from usePipeline().state.clusters
// ══════════════════════════════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { Card, DepthBadge, IntentBadge } from '@/components/ui';
import type { LearningCluster } from '@/lib/types';

interface ClusterCardProps {
  cluster: LearningCluster;
  /** Visual index for the card (1, 2, 3...) */
  index: number;
}

/**
 * ClusterCard — Displays a single learning journey with expandable details.
 */
export function ClusterCard({ cluster, index }: ClusterCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const urlCount = cluster.entries.filter((e) => e.source === 'visit').length;
  const searchCount = cluster.entries.filter((e) => e.source === 'search').length;

  return (
    <Card className="hover:shadow-md transition-shadow duration-200">
      {/* Card header: index + name + depth badge */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          {/* Numbered circle */}
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold flex items-center justify-center">
            {index}
          </span>
          <h3 className="font-semibold text-gray-900 text-base leading-tight">
            {cluster.name}
          </h3>
        </div>
        <DepthBadge depth={cluster.depth} />
      </div>

      {/* Inferred goal */}
      {cluster.inferredGoal && (
        <p className="text-xs text-indigo-600 font-medium mb-2 italic">
          Goal: {cluster.inferredGoal}
        </p>
      )}

      {/* Narrative */}
      <p className="text-sm text-gray-600 leading-relaxed mb-4">
        {cluster.narrative}
      </p>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
        {searchCount > 0 && (
          <span>{searchCount} {searchCount === 1 ? 'search' : 'searches'}</span>
        )}
        {urlCount > 0 && (
          <span>{urlCount} {urlCount === 1 ? 'URL' : 'URLs'} visited</span>
        )}
        <span className="text-gray-300">•</span>
        <span>{cluster.entries.length} total entries</span>
      </div>

      {/* Keywords */}
      {cluster.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {cluster.keywords.map((kw) => (
            <span
              key={kw}
              className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs"
            >
              #{kw}
            </span>
          ))}
        </div>
      )}

      {/* Expand/collapse toggle */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
      >
        {isExpanded ? '↑ Hide entries' : `↓ Show ${cluster.entries.length} entries`}
      </button>

      {/* Expandable entry list */}
      {isExpanded && (
        <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
          {cluster.entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-2 text-xs text-gray-600"
            >
              {/* Source icon */}
              <span className="flex-shrink-0 text-gray-400 mt-0.5">
                {entry.source === 'search' ? '🔍' : '🔗'}
              </span>

              {/* Entry content */}
              <span className="flex-1 min-w-0">
                {entry.source === 'search' ? (
                  // Search query — show as plain text
                  <span className="text-gray-800">{entry.query}</span>
                ) : (
                  // URL — truncate and show as link-styled text
                  <span className="text-indigo-600 truncate block" title={entry.url}>
                    {entry.title || entry.url}
                  </span>
                )}
              </span>

              {/* Intent badge */}
              <IntentBadge intent={entry.intent} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
