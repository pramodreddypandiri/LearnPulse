# Architecture — LearnPulse

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Next.js)                         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ History Input │  │  Dashboard   │  │   Post Editor/Export  │ │
│  │  (paste/file) │  │  (clusters)  │  │  (LinkedIn + X)       │ │
│  └──────┬───────┘  └──────▲───────┘  └───────────▲───────────┘ │
│         │                 │                      │              │
│         ▼                 │                      │              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    usePipeline() Hook                     │  │
│  │         Orchestrates: ingest → classify → cluster → gen   │  │
│  └──────┬──────────────────┬──────────────────┬─────────────┘  │
│         │                  │                  │                 │
└─────────┼──────────────────┼──────────────────┼─────────────────┘
          │ POST             │ POST             │ POST
          ▼                  ▼                  ▼
┌─────────────────┐ ┌────────────────┐ ┌─────────────────┐
│ /api/classify   │ │ /api/cluster   │ │ /api/generate   │
│                 │ │                │ │                 │
│ DeepSeek:       │ │ DeepSeek:      │ │ DeepSeek:       │
│ - Filter noise  │ │ - Group by     │ │ - LinkedIn post │
│ - Classify      │ │   learning     │ │ - X/Twitter     │
│   intent        │ │   journey      │ │   post          │
│ - Classify      │ │ - Name clusters│ │ - Reflective    │
│   content type  │ │ - Rank by      │ │   tone          │
│                 │ │   depth        │ │                 │
└─────────────────┘ └────────────────┘ └─────────────────┘
```

---

## Data Flow

### Stage 1: Ingest

**Input**: Raw text (pasted) or file (CSV/JSON/exported Chrome history)

**Parser logic** (runs client-side, no AI needed):

```
Raw Input
  │
  ├─ Detect format (freeform text / CSV / JSON / Chrome SQLite)
  │
  ├─ Extract entries:
  │   ├─ Search queries  → { type: 'search', query: string, timestamp? }
  │   └─ URLs visited    → { type: 'visit', url: string, title?: string, timestamp? }
  │
  ├─ Deduplicate (same query/URL within short window)
  │
  └─ Output: HistoryEntry[]
```

**Supported input formats**:

| Format | Source | Fields Available |
|--------|--------|-----------------|
| Freeform paste | User types/pastes | Query text, URLs |
| CSV | Google Takeout export | Query, timestamp, URL |
| JSON | Custom export tools | Flexible schema |
| Chrome SQLite | Direct DB read (future) | Full history + visit count |

### Stage 2: Classify

**Input**: `HistoryEntry[]`
**Output**: `ClassifiedEntry[]` (entries enriched with intent + learning score)

Single DeepSeek API call with structured JSON output. The prompt:

1. Receives batch of entries (up to 100 per call)
2. For each entry, returns:
   - `isLearning: boolean` — is this a learning signal?
   - `intent`: one of `learning | debugging | exploring | reference | building | noise`
   - `contentType` (for URLs): one of `documentation | tutorial | qa | repository | article | video | tool | noise`
   - `topic: string` — inferred topic (e.g., "async programming in Python")
   - `confidence: number` — 0-1 confidence score
3. Noise entries are preserved but flagged (user can override)

**Batching strategy**: Process in chunks of 50-100 entries. Typical daily history is 30-200 entries, so usually 1-2 API calls.

### Stage 3: Cluster

**Input**: `ClassifiedEntry[]` (learning entries only, noise filtered)
**Output**: `LearningCluster[]`

DeepSeek groups related entries into learning journeys:

```typescript
interface LearningCluster {
  id: string;
  name: string;               // "Async Programming in Python"
  narrative: string;           // "Started from a production bug, explored connection pooling..."
  depth: 'surface' | 'moderate' | 'deep';  // Based on # of entries + URL clicks
  entries: ClassifiedEntry[];  // The entries in this cluster
  keywords: string[];          // For hashtag generation
  inferredGoal: string;        // "Debug a FastAPI performance issue"
}
```

**Depth scoring**:
- `surface`: 1-2 search queries, no clicks → quick AI-answered lookup
- `moderate`: 3-5 queries or 1-2 clicked URLs → deliberate exploration
- `deep`: 5+ queries and/or 3+ clicked URLs → rabbit hole / deep dive

### Stage 4: Generate

**Input**: `LearningCluster[]` + user preferences
**Output**: `{ linkedin: string, x: string }`

Two separate DeepSeek API calls with different system prompts:

**LinkedIn prompt personality**: Thoughtful professional sharing genuine curiosity. First person. Narrative arc. No bullet points. Not a "today I learned" list.

**X prompt personality**: Sharp, concise, conversational. One insight that makes people stop scrolling. Thread only if the story demands it.

Both prompts receive:
- All clusters (ordered by depth, deepest first)
- The raw queries that formed each cluster (for authenticity)
- User's professional context (if provided)

---

## Type System

```typescript
// ── Core Types ──────────────────────────────────────────

type EntrySource = 'search' | 'visit';

type LearningIntent =
  | 'learning'
  | 'debugging'
  | 'exploring'
  | 'reference'
  | 'building'
  | 'noise';

type ContentType =
  | 'documentation'
  | 'tutorial'
  | 'qa'
  | 'repository'
  | 'article'
  | 'video'
  | 'tool'
  | 'noise';

type ClusterDepth = 'surface' | 'moderate' | 'deep';

// ── Data Models ─────────────────────────────────────────

interface HistoryEntry {
  id: string;
  source: EntrySource;
  query?: string;          // For search entries
  url?: string;            // For visit entries
  title?: string;          // Page title (if available)
  timestamp?: Date;        // When it happened
  raw: string;             // Original input text
}

interface ClassifiedEntry extends HistoryEntry {
  isLearning: boolean;
  intent: LearningIntent;
  contentType?: ContentType;  // Only for URLs
  topic: string;
  confidence: number;         // 0-1
}

interface LearningCluster {
  id: string;
  name: string;
  narrative: string;
  depth: ClusterDepth;
  entries: ClassifiedEntry[];
  keywords: string[];
  inferredGoal: string;
}

interface GeneratedPosts {
  linkedin: {
    body: string;
    hashtags: string[];
    characterCount: number;
  };
  x: {
    tweets: string[];          // Array for thread support
    hashtags: string[];
    characterCount: number;    // Per tweet
  };
  generatedAt: Date;
  basedOn: LearningCluster[];
}

// ── API Contracts ───────────────────────────────────────

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    processingTimeMs: number;
    tokensUsed?: number;
  };
}

// ── Pipeline State ──────────────────────────────────────

type PipelineStage = 'idle' | 'ingesting' | 'classifying' | 'clustering' | 'generating' | 'complete' | 'error';

interface PipelineState {
  stage: PipelineStage;
  entries: HistoryEntry[];
  classified: ClassifiedEntry[];
  clusters: LearningCluster[];
  posts: GeneratedPosts | null;
  error: string | null;
}
```

---

## API Route Specifications

### POST `/api/classify`

```
Request:  { entries: HistoryEntry[] }
Response: ApiResponse<ClassifiedEntry[]>
```

- Validates entries with Zod
- Batches into chunks of 50
- Calls DeepSeek with classification prompt
- Returns enriched entries

### POST `/api/cluster`

```
Request:  { entries: ClassifiedEntry[] }  // Pre-filtered to isLearning=true
Response: ApiResponse<LearningCluster[]>
```

- Receives only learning-classified entries
- Claude groups semantically related entries
- Returns named, scored clusters

### POST `/api/generate`

```
Request:  { clusters: LearningCluster[], preferences?: UserPreferences }
Response: ApiResponse<GeneratedPosts>
```

- Receives clusters ordered by depth
- Makes 2 DeepSeek API calls (LinkedIn + X) in parallel
- Returns both posts with metadata

---

## Error Handling Strategy

| Error Type | Handling |
|-----------|----------|
| Malformed input | Zod validation → 400 with descriptive error |
| Empty history | Short-circuit → friendly "nothing to analyze" message |
| DeepSeek API failure | Retry once with exponential backoff → surface error to user |
| Rate limit | Queue with delay → show progress indicator |
| Partial failure | Return successful results + flag failed entries for retry |
| Prompt injection (via URLs) | Sanitize all user input before including in prompts |

---

## Security Considerations

1. **All AI calls are server-side** — API key never exposed to client
2. **Input sanitization** — URLs and queries are cleaned before prompt inclusion
3. **No history storage** — data is processed in-memory, never persisted to disk/db (privacy-first)
4. **Rate limiting** — API routes are rate-limited per session
5. **Prompt injection defense** — user input is wrapped in XML tags with clear boundaries in prompts

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Ingest + Parse | < 100ms (client-side) |
| Classification (50 entries) | < 5s |
| Clustering | < 3s |
| Post generation | < 5s |
| **Total pipeline** | **< 15s** |

---

## Chrome Extension (Phase 2 — Implemented)

The extension is built and lives in `chrome-extension/`. It captures searches and URLs
automatically in the background — no manual copy-paste needed.

### Extension File Structure

```
chrome-extension/
├── manifest.json               # Manifest V3 — permissions, content scripts, popup
├── src/
│   ├── types.ts                # CapturedEntry, DailyStorage, STORAGE_KEY, helpers
│   ├── background.ts           # Service worker — history backfill, badge, alarms
│   ├── content-google.ts       # Content script — captures Google search queries
│   ├── content-perplexity.ts   # Content script — captures Perplexity searches
│   └── popup/
│       ├── popup.html          # Extension popup UI (340px wide)
│       └── popup.ts            # Popup logic — renders entries, handles buttons
├── dist/                       # esbuild compiled output (Chrome loads this)
│   ├── background.js           # ESM format (MV3 service worker)
│   ├── content-google.js       # IIFE format (injected into Google pages)
│   ├── content-perplexity.js   # IIFE format (injected into Perplexity pages)
│   └── popup/
│       ├── popup.html          # Copied from src/popup/popup.html by build.js
│       └── popup.js            # IIFE format (popup script)
└── build.js                    # esbuild build script (node build.js)
```

### Extension Data Flow

```
User searches Google/Perplexity
         │
         ▼
Content Script captures query
  └─ appendEntry() → chrome.storage.local
         │
Background Service Worker
  ├─ updateBadge() — shows count on icon
  ├─ backfillHistory() — pulls chrome.history on startup
  ├─ alarms — midnight reset, 9pm notification
         │
User clicks extension icon
         │
         ▼
popup.html + popup.ts loads
  ├─ Shows entry count (searches / URLs / total)
  ├─ Shows last 10 entries (with source badges + relative timestamps)
  └─ "Open LearnPulse" button (primary CTA)
         │
         ▼
handleOpenLearnPulse() in popup.ts
  ├─ Reads storage → formats entries as freeform text
  ├─ Opens/focuses LearnPulse tab (http://localhost:3000)
  ├─ Waits for tab to finish loading
  └─ chrome.scripting.executeScript() → injects injectHistoryIntoWebApp()
         │
         ▼ (runs inside the LearnPulse tab's JavaScript context)
injectHistoryIntoWebApp(text)
  └─ window.dispatchEvent(new CustomEvent('learnpulse:inject', { detail: { text } }))
         │
         ▼ (caught by React in src/app/page.tsx)
useEffect 'learnpulse:inject' handler
  ├─ parseInput(text) → HistoryEntry[]
  ├─ setIsExtensionMode(true)
  └─ setCapturedEntries(entries)
         │
         ▼
Two-panel layout activates
  LEFT PANEL: CapturedEntriesPanel
    ├─ Lists all entries (🔍 search, 🔗 URL) with × delete buttons
    └─ "Analyze N entries" button
  RIGHT PANEL: Pipeline output (empty until analyze is clicked)
         │
User deletes noise entries, clicks "Analyze"
         │
         ▼
handleAnalyzeExtension() in page.tsx
  └─ Converts capturedEntries → freeform text → runPipeline(text)
         │
         ▼
Standard 4-stage AI pipeline runs
  ingest → classify → cluster → generate
```

### Capture Sources

| Source | Mechanism | Data captured |
|--------|-----------|---------------|
| Google | `content-google.ts` polls URL every 1.5s | Search query from `?q=` param |
| Perplexity | `content-perplexity.ts` + MutationObserver | Initial query + follow-up questions |
| Chrome History | `background.ts` → `chrome.history.search()` | All visited URLs from today |

### Extension Storage Schema

```typescript
// chrome.storage.local key: 'learnpulse_daily'
interface DailyStorage {
  date: string;          // "2025-06-10" — resets automatically each day
  entries: CapturedEntry[];
}

interface CapturedEntry {
  type: 'search' | 'visit';
  content: string;       // Query text or URL
  source: 'google' | 'perplexity' | 'history';
  timestamp: number;     // Unix ms
  title?: string;        // Page title (for URL visits)
}
```

### Web App — Extension Mode Layout

When extension data is injected, `src/app/page.tsx` switches to a two-panel layout:

```
┌─ max-w-6xl ───────────────────────────────────────────────────────────┐
│  Header: LearnPulse · "Review captures, remove noise, then analyze"   │
├─ w-72 (sticky) ────────┬─ flex-1 ──────────────────────────────────── │
│  CAPTURED ENTRIES      │  PIPELINE + RESULTS                          │
│  ─────────────────     │                                              │
│  32 entries            │  [idle]  → shows "Ready when you are" hint   │
│  24 searches · 8 URLs  │  [running] → PipelineStatus progress         │
│                        │  [clusters] → ClusterGrid                    │
│  🔍 how does TCP   ×   │  [complete] → PostPreview                    │
│  🔍 python asyncio ×   │                                              │
│  🔗 stackoverflow  ×   │                                              │
│  🔍 weather today  ×   │                                              │
│  🔗 github.com     ×   │                                              │
│  ...                   │                                              │
│                        │                                              │
│  [Analyze 30 entries]  │                                              │
│  Start over            │                                              │
└────────────────────────┴──────────────────────────────────────────────┘
```

**Entry deletion UX**: Hovering an entry reveals the `×` button (opacity transition).
Clicking it removes the entry from `capturedEntries` state immediately (client-side).
No API call — just a React `setState` filter.

**"Start over"** returns to manual mode and clears all extension state.

### Why This Design (vs. Auto-Analyze)

The previous design auto-started the AI pipeline as soon as the extension injected data.
This was changed because:

1. **User control**: The user can see and delete noise entries (YouTube rabbit holes,
   weather searches, banking) before they reach the AI classifier.
2. **Cost awareness**: The user consciously decides when to spend API credits.
3. **Privacy**: The user can remove sensitive browsing before it's sent to any server.
4. **Quality**: Fewer, cleaner entries produce better clusters and more focused posts.
