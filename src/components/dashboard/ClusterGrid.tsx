// ══════════════════════════════════════════════════════════════════════
// ClusterGrid — Grid of Learning Journey Cards
// src/components/dashboard/ClusterGrid.tsx
//
// PURPOSE:
//   Renders the full grid of LearningCluster cards after the clustering
//   stage completes. Shows the header (with cluster count + learning entry count)
//   and the grid of ClusterCard components.
//
// LAYOUT:
//   - Single column on mobile
//   - Two columns on tablet+
//   - Three columns on large screens (if many clusters)
//
// AFFECT ON THE SYSTEM:
//   - Used by: src/app/page.tsx
//   - Reads: LearningCluster[] from usePipeline().state.clusters
// ══════════════════════════════════════════════════════════════════════

import { ClusterCard } from './ClusterCard';
import type { LearningCluster } from '@/lib/types';

interface ClusterGridProps {
  clusters: LearningCluster[];
  learningEntryCount: number;
}

/**
 * ClusterGrid — Displays all learning journey clusters in a responsive grid.
 */
export function ClusterGrid({ clusters, learningEntryCount }: ClusterGridProps) {
  if (clusters.length === 0) return null;

  const deepCount = clusters.filter((c) => c.depth === 'deep').length;
  const moderateCount = clusters.filter((c) => c.depth === 'moderate').length;

  return (
    <section>
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Your Learning Journeys
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Found {clusters.length} {clusters.length === 1 ? 'topic' : 'topics'} from {learningEntryCount} learning{' '}
            {learningEntryCount === 1 ? 'signal' : 'signals'}
            {deepCount > 0 && ` · ${deepCount} deep dive${deepCount > 1 ? 's' : ''}`}
            {moderateCount > 0 && ` · ${moderateCount} exploration${moderateCount > 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Responsive grid */}
      <div className={`grid gap-4 ${clusters.length === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
        {clusters.map((cluster, index) => (
          <ClusterCard
            key={cluster.id}
            cluster={cluster}
            index={index + 1}
          />
        ))}
      </div>
    </section>
  );
}
