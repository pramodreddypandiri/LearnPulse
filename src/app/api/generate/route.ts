// ══════════════════════════════════════════════════════════════════════
// API Route: POST /api/generate
// src/app/api/generate/route.ts
//
// PURPOSE:
//   HTTP endpoint that receives LearningCluster[] and optional user
//   preferences, then generates LinkedIn + X posts using DeepSeek.
//
// REQUEST SHAPE:
//   POST /api/generate
//   Content-Type: application/json
//   Body: {
//     clusters: LearningCluster[],
//     preferences?: UserPreferences
//   }
//
// RESPONSE SHAPE:
//   { success: true, data: GeneratedPosts, meta: { processingTimeMs } }
//   OR
//   { success: false, error: "..." }
//
// WHERE THIS IS CALLED FROM:
//   - src/hooks/usePipeline.ts during the 'generating' pipeline stage
//   - Called AFTER /api/cluster succeeds
//
// NOTE ON VALIDATION:
//   The cluster schema is complex (deeply nested objects). We validate
//   the top-level structure (clusters array with required fields) but
//   don't deep-validate every entry in every cluster — that would be
//   excessive for this stage. The AI already produced these clusters
//   from validated data, so deep re-validation is unnecessary overhead.
// ══════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generatePosts } from '@/lib/ai/post-generator';
import type { ApiResponse, GeneratedPosts } from '@/lib/types';

// ─── Request Validation Schema ───────────────────────────────────────────────

// Lightweight cluster schema — validates required top-level fields only.
// We trust the entries inside clusters since they came from our own /api/cluster.
const ClusterSchema = z.object({
  id: z.string(),
  name: z.string(),
  narrative: z.string(),
  depth: z.enum(['surface', 'moderate', 'deep']),
  entries: z.array(z.any()), // Already validated by /api/cluster
  keywords: z.array(z.string()),
  inferredGoal: z.string(),
});

const UserPreferencesSchema = z.object({
  professionalContext: z.string().max(200).optional(),
  linkedinTone: z.enum(['reflective', 'educational', 'storytelling']).optional(),
  xFormat: z.enum(['single', 'thread']).optional(),
}).optional();

const GenerateRequestSchema = z.object({
  clusters: z
    .array(ClusterSchema)
    .min(1, 'At least one cluster is required')
    .max(20, 'Too many clusters — maximum 20 per generate request'),
  preferences: UserPreferencesSchema,
});

// ─── Route Handler ───────────────────────────────────────────────────────────

/**
 * POST /api/generate
 *
 * Generates LinkedIn and X posts from learning clusters.
 * This is the final stage of the pipeline — the output is displayed to the user.
 */
export async function POST(request: Request): Promise<NextResponse<ApiResponse<GeneratedPosts>>> {
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
  const validation = GenerateRequestSchema.safeParse(body);

  if (!validation.success) {
    const errorMessage = validation.error.issues[0]?.message ?? 'Invalid request';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 400 }
    );
  }

  const { clusters, preferences } = validation.data;

  // ── Call the Post Generator ──
  try {
    const posts = await generatePosts(clusters, preferences);

    return NextResponse.json({
      success: true,
      data: posts,
      meta: { processingTimeMs: Date.now() - startTime },
    });

  } catch (error) {
    console.error('[/api/generate] Unexpected error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Post generation failed. Please try again.',
        meta: { processingTimeMs: Date.now() - startTime },
      },
      { status: 500 }
    );
  }
}
