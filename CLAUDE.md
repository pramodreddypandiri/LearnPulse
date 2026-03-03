# CLAUDE.md — LearnPulse Agent

## Project Overview

**LearnPulse** is an AI-powered agent that analyzes a user's daily search history and browsing history, classifies learning-related activity, groups related topics into learning journeys, and generates reflective social media posts (LinkedIn + X/Twitter).

### Core Insight

With AI-powered search (Google AI Overviews, Perplexity, ChatGPT, Copilot), users increasingly consume knowledge directly from search results without clicking links. **Search queries are now the primary learning signal**, with browsed URLs serving as supplementary depth indicators.

---
### Instructions for Claude code:
This project is a leanring path. so, when we are implementing services/apis or any file except for styles, give user a detailed explanation of what is being done, what code does, how this code affecting other parts of the system. make sure to write detailed comments in the code.  
## Architecture Summary

**Pipeline**: `Ingest → Classify → Cluster → Generate`

| Stage       | Input                        | Output                          | AI Role              |
| ----------- | ---------------------------- | ------------------------------- | -------------------- |
| **Ingest**  | Raw search/browsing history  | Normalized `HistoryEntry[]`     | None (parsing only)  |
| **Classify**| `HistoryEntry[]`             | `ClassifiedEntry[]`             | Intent classification |
| **Cluster** | `ClassifiedEntry[]`          | `LearningCluster[]`            | Semantic grouping     |
| **Generate**| `LearningCluster[]`          | `LinkedInPost` + `XPost`       | Reflective writing    |

### Key Design Decisions

1. **Search history is the PRIMARY signal** — each query is treated as a potential learning moment even without a click.
2. **Browsed URLs are DEPTH signals** — if a user searched AND clicked 3 links, that's a deep dive vs. a quick AI-answered query.
3. **Classification is two-step**: first filter (learning vs. noise), then categorize (topic/domain).
4. **Post generation is REFLECTIVE, not summarizing** — the output should read like a person reflecting on their learning journey, not a bullet-point summary.

---

## Tech Stack

- **Framework**: Next.js 14 (App Router) + TypeScript
- **Styling**: Tailwind CSS
- **AI**: DeepSeek API (OpenAI-compatible, via `openai` SDK with `baseURL: https://api.deepseek.com`)
- **State**: React hooks + context (no external state management)
- **Testing**: Vitest + React Testing Library
- **Future**: Chrome Extension (Manifest V3) for automatic history ingestion

---

## File Structure Convention

```
src/
├── app/                    # Next.js App Router pages + API routes
│   ├── api/                # Backend API routes (AI calls happen here)
│   │   ├── classify/       # POST: classify history entries
│   │   ├── cluster/        # POST: group classified entries
│   │   └── generate/       # POST: generate social posts
│   ├── layout.tsx          # Root layout
│   └── page.tsx            # Main dashboard page
├── components/
│   ├── ui/                 # Reusable UI primitives (Button, Card, etc.)
│   ├── history/            # History input, parsing, display
│   ├── posts/              # Post preview, editing, export
│   └── dashboard/          # Main dashboard layout, pipeline status
├── lib/
│   ├── ai/                 # AI pipeline logic (prompts, chains)
│   │   ├── classifier.ts   # Learning vs noise classification
│   │   ├── clusterer.ts    # Semantic topic grouping
│   │   └── post-generator.ts # LinkedIn + X post generation
│   ├── parsers/            # Input parsing (CSV, JSON, paste, Chrome DB)
│   ├── types/              # TypeScript type definitions
│   └── utils/              # Shared utility functions
├── hooks/                  # React hooks (usePipeline, useHistory, etc.)
└── config/                 # App configuration, constants
```

---

## Coding Conventions

### General

- **TypeScript strict mode** — no `any` types unless absolutely necessary.
- **Functional components only** — no class components.
- **Named exports** — default exports only for pages/layouts.
- **Barrel exports** — each directory has an `index.ts` re-exporting public API.
- **Error boundaries** — wrap AI-dependent components in error boundaries.

### Naming

- Files: `kebab-case.ts` (e.g., `post-generator.ts`)
- Components: `PascalCase.tsx` (e.g., `HistoryInput.tsx`)
- Types/Interfaces: `PascalCase`, prefixed with `I` only for interfaces that describe a contract (e.g., `IParser`), otherwise just `PascalCase` (e.g., `HistoryEntry`).
- Constants: `SCREAMING_SNAKE_CASE`
- Hooks: `useCamelCase`

### AI Prompts

- All prompts live in `src/lib/ai/` as template literal functions.
- Prompts are versioned with a comment header: `// PROMPT_V1 — 2025-xx-xx`
- System prompts and user prompts are always separate variables.
- JSON output mode is enforced via prompt engineering (instruct model to return only JSON).

### API Routes

- All AI calls go through API routes (never call DeepSeek directly from the client).
- API routes validate input with Zod schemas.
- Responses follow a consistent shape: `{ success: boolean, data?: T, error?: string }`

---

## Classification Taxonomy

The classifier categorizes search queries and URLs into:

### Intent Types (Search Queries)

| Intent           | Description                                    | Example                                   |
| ---------------- | ---------------------------------------------- | ----------------------------------------- |
| `learning`       | Actively trying to understand a concept        | "how does TCP handshake work"             |
| `debugging`      | Troubleshooting a specific problem             | "why is my FastAPI endpoint slow"         |
| `exploring`      | Surveying a topic or comparing options         | "best state management for React 2025"   |
| `reference`      | Looking up specific syntax/API/docs            | "python asyncio.gather signature"         |
| `building`       | Searching while actively building something    | "nextjs dynamic routes with params"       |
| `noise`          | Non-learning utility/entertainment searches    | "weather today", "pizza near me"          |

### Content Types (URLs)

| Type             | Description                                    | Example Domains                           |
| ---------------- | ---------------------------------------------- | ----------------------------------------- |
| `documentation`  | Official docs / API references                 | docs.python.org, developer.mozilla.org    |
| `tutorial`       | Step-by-step learning content                  | freecodecamp.org, Medium tutorials        |
| `qa`             | Question/answer threads                        | stackoverflow.com, reddit (tech subs)     |
| `repository`     | Source code / project repos                    | github.com                                |
| `article`        | Blog posts, essays, thought leadership         | blog.*, substack, dev.to                  |
| `video`          | Video tutorials / talks                        | youtube.com (tech channels)               |
| `tool`           | SaaS tools, playgrounds, sandboxes            | codepen.io, regex101.com                  |
| `noise`          | Non-learning pages                             | social media feeds, email, banking        |

---

## Post Generation Guidelines

### LinkedIn Post

- Tone: Professional, insightful, first-person reflective
- Length: 150–300 words
- Structure: Hook → Journey narrative → Key insight → Takeaway
- Should feel like a person sharing genuine curiosity, NOT a list of links
- Include 3-5 relevant hashtags
- No emojis in body text (optional in hashtags)

### X/Twitter Post

- Tone: Punchy, conversational, authentic
- Length: 1-3 tweets (thread if needed, prefer single tweet)
- Structure: Sharp insight or question → brief context → optional call-to-action
- Should feel spontaneous, not polished
- Include 1-2 hashtags max

### Anti-Patterns (NEVER do these)

- ❌ "Today I learned about X, Y, and Z" (boring list)
- ❌ "Here are 5 things I read today" (summarizer mode)
- ❌ Generic motivational wrapper ("Never stop learning!")
- ❌ Overly formal or corporate tone
- ✅ "Went down a rabbit hole on connection pooling today. Started from a timeout bug, ended up reading CPython source code. Turns out..."

---

## Environment Variables

```
DEEPSEEK_API_KEY=            # Required — DeepSeek API key (get from platform.deepseek.com)
NEXT_PUBLIC_APP_URL=         # App base URL (default: http://localhost:3000)
```

---

## Development Workflow

```bash
npm run dev          # Start dev server (Next.js)
npm run build        # Production build
npm run test         # Run tests (Vitest)
npm run test:watch   # Tests in watch mode
npm run lint         # ESLint + Prettier check
npm run type-check   # TypeScript strict check
```

---

## Future Roadmap

1. **Phase 1 (MVP)**: Paste/upload history → classify → cluster → generate posts
2. **Phase 2**: Chrome extension for automatic history capture
3. **Phase 3**: Daily digest emails, scheduling posts directly to LinkedIn/X
4. **Phase 4**: Learning streak tracking, topic trend graphs, weekly/monthly reports
5. **Phase 5**: Multi-user support, team learning dashboards
