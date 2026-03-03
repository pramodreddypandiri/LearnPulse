// ══════════════════════════════════════════════════════════════════════
// API Route: POST /api/cluster
// src/app/api/cluster/route.ts
//
// PURPOSE:
//   HTTP endpoint that receives ClassifiedEntry[] (learning entries only —
//   noise should already be filtered by the client before sending),
//   passes them through the AI clusterer, and returns LearningCluster[].
//
// REQUEST SHAPE:
//   POST /api/cluster
//   Content-Type: application/json
//   Body: { entries: ClassifiedEntry[] }
//         Note: Only isLearning=true entries should be sent here.
//         The route doesn't reject noise entries, but the clusterer
//         will include them which pollutes the clusters.
//
// RESPONSE SHAPE:
//   { success: true, data: LearningCluster[], meta: { processingTimeMs } }
//   OR
//   { success: false, error: "..." }
//
// WHERE THIS IS CALLED FROM:
//   - src/hooks/usePipeline.ts during the 'clustering' pipeline stage
//   - Called AFTER /api/classify succeeds
//   - The hook filters classified entries to isLearning=true before calling this
//
// VALIDATION APPROACH:
//   ClassifiedEntry extends HistoryEntry — we validate both the base fields
//   (id, source, raw) and the classification fields (isLearning, intent, topic).
//   We're lenient with optional fields (contentType, confidence) to avoid
//   rejecting valid data that happens to be missing optional metadata.
// ══════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clusterEntries } from '@/lib/ai/clusterer';
import type { ApiResponse, LearningCluster } from '@/lib/types';

// ─── Request Validation Schema ───────────────────────────────────────────────

const ClassifiedEntrySchema = z.object({
  // Base HistoryEntry fields
  id: z.string().min(1),
  source: z.enum(['search', 'visit']),
  query: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  timestamp: z.string().datetime().optional().transform((val) => val ? new Date(val) : undefined),
  raw: z.string(),

  // ClassifiedEntry-specific fields
  isLearning: z.boolean(),
  intent: z.enum(['learning', 'debugging', 'exploring', 'reference', 'building', 'noise']),
  contentType: z.enum([
    'documentation', 'tutorial', 'qa', 'repository', 'article', 'video', 'tool', 'noise'
  ]).optional(),
  topic: z.string(),
  confidence: z.number().min(0).max(1),
});

const ClusterRequestSchema = z.object({
  entries: z
    .array(ClassifiedEntrySchema)
    .min(1, 'At least one entry is required')
    .max(300, 'Too many entries — maximum 300 per cluster request'),
});

// ─── Route Handler ───────────────────────────────────────────────────────────

/**
 * POST /api/cluster
 *
 * Groups classified learning entries into semantic learning journey clusters.
 */
export async function POST(request: Request): Promise<NextResponse<ApiResponse<LearningCluster[]>>> {
  const startTime = Date.now();

  // ── Parse request body ──
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON in request body' },
      { status: 400 }
    );
  }

  // ── Validate with Zod ──
  const validation = ClusterRequestSchema.safeParse(body);

  if (!validation.success) {
    const errorMessage = validation.error.issues[0]?.message ?? 'Invalid request';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 400 }
    );
  }

  const { entries } = validation.data;

  // ── Handle empty entries ──
  if (entries.length === 0) {
    return NextResponse.json({
      success: true,
      data: [],
      meta: { processingTimeMs: Date.now() - startTime },
    });
  }

  // ── Call the AI Clusterer ──
  try {
    const clusters = await clusterEntries(entries);

    return NextResponse.json({
      success: true,
      data: clusters,
      meta: { processingTimeMs: Date.now() - startTime },
    });

  } catch (error) {
    console.error('[/api/cluster] Unexpected error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Clustering failed. Please try again.',
        meta: { processingTimeMs: Date.now() - startTime },
      },
      { status: 500 }
    );
  }
}
