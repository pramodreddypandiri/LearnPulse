// ══════════════════════════════════════════════════════════════════════
// DeepSeek Client Singleton
// src/lib/ai/client.ts
//
// PURPOSE:
//   Creates and exports the DeepSeek API client used by all three
//   AI pipeline modules (classifier, clusterer, post-generator).
//
// WHY A SINGLETON?
//   We use a single client instance (not creating a new one per request)
//   because the OpenAI client maintains HTTP connection pooling internally.
//   Creating a new client per request would bypass this optimization and
//   add connection overhead to every API call.
//
// HOW DeepSeek WORKS WITH THE OPENAI SDK:
//   DeepSeek's API is 100% compatible with OpenAI's API schema.
//   The only difference is the `baseURL` — we point the OpenAI SDK
//   at DeepSeek's endpoint instead of OpenAI's. This means:
//   - Same method: client.chat.completions.create()
//   - Same parameters: model, messages, temperature, max_tokens
//   - Same response shape: response.choices[0].message.content
//   The model name changes from "gpt-4" to "deepseek-chat".
//
// SECURITY:
//   - This file is ONLY imported by server-side code (API routes in app/api/)
//   - The API key lives in .env.local and is NEVER sent to the client
//   - Next.js does not expose server-side env vars to the client bundle
//   - The "server-only" package (not installed yet) would enforce this at
//     build time — for now, we rely on keeping imports in API routes only
//
// AFFECT ON THE SYSTEM:
//   - Imported by: classifier.ts, clusterer.ts, post-generator.ts
//   - Those modules are imported only by: src/app/api/*/route.ts files
// ══════════════════════════════════════════════════════════════════════

import OpenAI from 'openai';

/**
 * DeepSeek API client configured to use DeepSeek's OpenAI-compatible endpoint.
 *
 * Environment variable: DEEPSEEK_API_KEY (in .env.local)
 * Get your key at: https://platform.deepseek.com
 *
 * The client is created once at module load time and reused across all
 * API requests (Node.js module caching handles the singleton behavior).
 */
export const deepseek = new OpenAI({
  // DeepSeek's API is OpenAI-compatible — just swap the base URL
  baseURL: 'https://api.deepseek.com',

  // The API key is injected from the environment — NEVER hardcode this
  apiKey: process.env.DEEPSEEK_API_KEY,
});

/**
 * The DeepSeek model to use for all pipeline calls.
 *
 * 'deepseek-chat' is the flagship model — fast, capable, and cheap.
 * It's the best choice for classification, clustering, and generation
 * because it excels at following structured JSON output instructions.
 *
 * If you need higher reasoning quality (e.g., for complex clustering),
 * you can switch to 'deepseek-reasoner' — but it's slower and pricier.
 */
export const DEEPSEEK_MODEL = 'deepseek-chat';
