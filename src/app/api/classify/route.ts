// ══════════════════════════════════════════════════════════════════════
// API Route: POST /api/classify
// src/app/api/classify/route.ts
//
// PURPOSE:
//   HTTP endpoint that receives HistoryEntry[] from the client,
//   passes them through the AI classifier, and returns ClassifiedEntry[].
//
// REQUEST SHAPE:
//   POST /api/classify
//   Content-Type: application/json
//   Body: { entries: HistoryEntry[] }
//
// RESPONSE SHAPE:
//   { success: true, data: ClassifiedEntry[], meta: { processingTimeMs, tokensUsed } }
//   OR
//   { success: false, error: "..." }
//
// WHERE THIS IS CALLED FROM:
//   - src/hooks/usePipeline.ts during the 'classifying' pipeline stage
//   - The hook calls this after the 'ingesting' stage completes
//
// VALIDATION (Zod):
//   We validate the request body before passing to the AI.
//   This prevents:
//   - Malformed data reaching the AI (would waste tokens and cause errors)
//   - Excessively large payloads (DoS protection)
//   - Type mismatches crashing the classifier
//
// ERROR HANDLING:
//   - Invalid request body → 400 Bad Request with Zod error details
//   - Empty entries array → 200 with empty data (not an error)
//   - AI failure → 500 with error message (classifier handles internally too)
//   - Unexpected errors → 500 with generic message (no leak of internals)
// ══════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { classifyEntries } from '@/lib/ai/classifier';
import type { ApiResponse, ClassifiedEntry } from '@/lib/types';

// ─── Request Validation Schema ───────────────────────────────────────────────
//
// Zod schema for the incoming request body.
//
// WHY VALIDATE EACH ENTRY FIELD?
//   The client sends data parsed from user input — it could contain
//   unexpected shapes if the parsers have edge cases. Zod catches this
//   before the AI classifier ever sees it.
//
// We use z.string().min(1) for ID because empty IDs would break the
// ID-based matching in the classifier's mergeClassifications() function.

const HistoryEntrySchema = z.object({
  id: z.string().min(1, 'Entry ID cannot be empty'),
  source: z.enum(['search', 'visit']),
  query: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  // Timestamps arrive as JSON strings — coerce them back to Date objects
  timestamp: z.string().datetime().optional().transform((val) => val ? new Date(val) : undefined),
  raw: z.string(),
});

const ClassifyRequestSchema = z.object({
  entries: z
    .array(HistoryEntrySchema)
    .min(1, 'At least one entry is required')
    .max(500, 'Too many entries — maximum 500 per request'),
});

// ─── Route Handler ───────────────────────────────────────────────────────────

/**
 * POST /api/classify
 *
 * Validates the request, calls the classifier, and returns results.
 * This is the ONLY way the client should call classifyEntries() —
 * direct imports of classifier.ts from client components are not allowed
 * (would expose server-only code in the browser bundle).
 */
export async function POST(request: Request): Promise<NextResponse<ApiResponse<ClassifiedEntry[]>>> {
  const startTime = Date.now();

  // ── Parse the request body ──
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
  const validation = ClassifyRequestSchema.safeParse(body);

  if (!validation.success) {
    // Return the first Zod error message — Zod errors are already human-readable
    const errorMessage = validation.error.issues[0]?.message ?? 'Invalid request';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 400 }
    );
  }

  const { entries } = validation.data;

  // ── Handle empty entries gracefully ──
  // An empty array is valid — the user might have pasted something
  // that produced no parseable entries. Return empty results, not an error.
  if (entries.length === 0) {
    return NextResponse.json({
      success: true,
      data: [],
      meta: { processingTimeMs: Date.now() - startTime },
    });
  }

  // ── Call the AI Classifier ──
  try {
    const classified = await classifyEntries(entries);

    return NextResponse.json({
      success: true,
      data: classified,
      meta: {
        processingTimeMs: Date.now() - startTime,
        // Note: DeepSeek API doesn't always return token usage, so this may be undefined
        tokensUsed: undefined,
      },
    });

  } catch (error) {
    // The classifier handles most errors internally (with fallbacks),
    // but we catch any unexpected thrown errors here as a safety net
    console.error('[/api/classify] Unexpected error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Classification failed. Please try again.',
        meta: { processingTimeMs: Date.now() - startTime },
      },
      { status: 500 }
    );
  }
}
