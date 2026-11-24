# Civic Pulse Engine — Full Documentation

Municipality of Pulilan, Bulacan capstone project. Processes imported public
feedback, runs NLP on it, surfaces misinformation via RAG claim
checking, and gives LGU staff a complete issue-management workflow including
data-driven issue prioritization.

> This document describes the staff application architecture. Deployment notes and historical examples may lag the source; use README.md for the supported synthetic showcase setup. No production dataset, collection workflow, or external NLP service is bundled. Hashing author IDs does not anonymize comment text.

---

## 1. Tech Stack

| Layer          | Technology                                                         |
| -------------- | ------------------------------------------------------------------ |
| Frontend       | SvelteKit 2 + Svelte 5 (runes), Tailwind CSS v4                    |
| Charts         | Chart.js (LineChart / DonutChart wrappers)                         |
| Maps           | Leaflet + leaflet.heat (Barangay heatmap)                          |
| Backend        | SvelteKit server routes (`+server.ts`) on Vercel                   |
| Database       | Supabase (PostgreSQL 17) with Row Level Security                   |
| Auth           | Supabase Auth (email invite → set-password flow)                   |
| NLP pipeline   | Python/FastAPI output persisted by `process-comment` Edge Function |
| Data ingestion | Python YouTube ingestion; configured Facebook sources              |

---

## 2. Data Flow Architecture

```
Facebook comments
  └─ GitHub Actions cron (Graph API v25)
       └─ raw_content                (Layer 1: raw text + engagement counters)
            └─ process-comment Edge Function
                 └─ processed_content (Layer 3: sentiment_label/score, topic_label/score,
                       is_flagged, barangay_mention, cleaned_text)
                      ├─ flagged_claims  (Layer 4: RAG-detected claims)
                      │    └─ review_records (Layer 5: immutable staff decisions)
                      ├─ lgu_documents   (Layer 4: ordinance/resolution sources)
                      │    └─ document_chunks (Layer 4: paragraph-level pgvector chunks for RAG)
                      └─ compute-issue-priority Edge Function
                           └─ civic_issues (one ticket per notable comment)
```

Two distinct "priority" mechanisms exist — do not confuse them:

1. **`compute-issue-priority` Edge Function** — per-_comment_ additive score
   that auto-creates individual Issue Tracker tickets.
2. **Issue Prioritization dashboard feature** — per-_topic aggregate_ ranking
   computed on read from `processed_content` (+ engagement). Documented below.

---

## 3. Features

### 3.1 Dashboard (`/Authenticated/dashboard`)

Stat cards (Total Analyzed, Flagged Claims, NLP Accuracy, Positive Rate),
sentiment trend line chart, topic distribution doughnut, sentiment breakdown
bars, Priority Flagged Claims list, and the bottom tabbed section:

- **Barangay Heatmap** — Leaflet heat layer of negative-sentiment intensity
  per Pulilan barangay (18 barangay centroids).
- **Issue Prioritization** (default tab) — see §4.
- **Issue Tracker** — embedded board/table view linking to the full tracker.

### 3.2 Live Data Stream

Anonymized feed of processed comments with client-side filtering
(sentiment toggles, flagged-only, keyword search, **topic dropdown**) plus a
**server-side date window**: an All | Weekly | Monthly | Yearly | Custom pill
toggle beside the search bar syncs `?range=&from=&to=` URL params (validated
against a Set + `YYYY-MM-DD` regex; invalid values fall back to `all`), which
narrow the Supabase query via `.gte()/.lte('processed_at', …)`. Presets are
rolling windows (7/30/365 days); Custom interprets From/To as inclusive
Manila civil days (`getDateWindow()` in `$lib/server/sentiment-trends.ts` —
same-day pick = exact-date search). Selecting Custom navigates to bare
`?range=custom` immediately so a polling refresh can't snap the date pickers
shut mid-selection. Text/sentiment/topic filters remain client-side on top of
the date-filtered result set (limit 100): the topic filter routes raw labels
through `normalizeTopic()` — compound NLP variants ("Infrastructure and
Public Works") map onto canonical topics exactly like the chart API — and the
platform select's options are **derived from the loaded rows** instead of a
hardcoded list (so it only reflects platforms present in the current window).

**Refresh**: a Refresh button plus a 60-second auto-poll keep the feed live.
The page load declares a scoped `depends('live-stream:feed')`; the page calls
`invalidate('live-stream:feed')`, so each poll re-runs **only this query** —
never the layout (sidebar pending-count stays out of the poll path). DB
errors surface as a `role="alert"` banner via the load's user-safe
`loadError` field (internal details stay in server logs) instead of silently
rendering an empty feed.

**Real-Time Sentiment Overview** (adviser revision): Chart.js trend card above
the feed with a Live | Weekly | Monthly | Yearly segmented toggle (Weekly
default) plus topic
and platform selects, reusing the shared `LineChart.svelte` (x-axis thins
labels with Chart.js native `autoSkip`, capped at 8 ticks — adapts to any
bucket count). Data comes from
`GET /api/sentiment-trends`; buckets per range (all computed in Asia/Manila
civil time via `Intl.DateTimeFormat` parts — never UTC `Date` math, which
would shift PH early-morning comments into the previous day):

| Range   | Span                    | Bucket                                                               |
| ------- | ----------------------- | -------------------------------------------------------------------- |
| Live    | last 12 hours           | hourly (daily-7d fallback when idle — delegates to `buildTrendData`) |
| Weekly  | last 28 days            | daily                                                                |
| Monthly | current month-to-date   | daily                                                                |
| Yearly  | last 12 calendar months | monthly                                                              |

Sentiment lines stay consistent across modes: Positive / Negative / everything
else (neutral, `review`, null) folded into Neutral. Partial current buckets
(today / current month) render as-is. Topic filtering runs rows through
`normalizeTopic()` after fetch (NLP emits compound variants — never `eq()` on
canonical values); platform whitelists `facebook | test` per the schema CHECK.
Query performance: a single bounded windowed query on `processed_content`
aggregated server-side in TS — no materialized view or scheduled refresh job;
justified by capstone-scale volume (revisit only at ~100× growth).

### 3.3 Flagged Claims Review

Queue for RAG-flagged claims; staff decide Verified False / Verified True /
Inconclusive (writes `review_records`) or escalate into the Issue Tracker.

### 3.4 Issue Tracker (`/Authenticated/issues`)

Kanban board + sortable table + slide-over detail panel with status history,
staff comment thread, priority/status/assignee controls. Server-enforced
status transition adjacency list.

### 3.5 Reference Docs

RAG document library of LGU ordinances, resolutions, advisories. Documents
are chunked into **paragraph-level `document_chunks`** (structure-aware split,
384-token chunks / 64-token overlap) and each chunk is embedded separately, so
claim retrieval matches a specific provision rather than a whole-doc vector.
Editing a document invalidates its chunks (regenerated by `backfill_chunks.py`).

### 3.6 Reports & Audit Log

Weekly Summary PDF, Flagged Claims CSV, Issue Tracker CSV, full audit XLSX
(admin only).

### 3.7 Admin Config

Role-gated admin panel: personnel invites, system configuration, audit log.

---

## 4. Issue Prioritization (feature added this cycle)

### 4.1 Purpose

Answer "which civic topics deserve LGU attention right now?" from existing
NLP output — transparent weighted score, no ML model.

### 4.2 Scoring Formula

Per topic _t_ over time window _W_:

```
f_t   = # processed_content rows with topic_label = t in W
neg_t = # of those rows with sentiment_label = 'negative'
e_t   = Σ(reaction_count + reply_count) joined from raw_content

F̂_t = f_t / max(f)              normalized frequency      ∈ [0,1]
V_t = neg_t / f_t               negativity rate           ∈ [0,1]
Ê_t = max_e > 0 ? e_t/max_e : 0 normalized engagement     ∈ [0,1]

PriorityScore_t = round(100 × (0.40·F̂_t + 0.35·V_t + 0.25·Ê_t))
```

Default weights: **Frequency 0.40 · Negativity 0.35 · Engagement 0.25**
(`PRIORITY_WEIGHTS` in `$lib/utils/priority.ts`). Engagement contributes 0
until the ingestion cron starts populating the new counters.

Rules:

- Topics with < `MIN_SUPPORT` (3) comments are excluded **unless no topic
  clears the threshold** (small-dataset fallback).
- Ranking sorts by score desc, then negativity desc, then frequency desc,
  then topic name asc. Rank badges are 1-based positions.
- `review`/neutral/positive sentiments count as non-negative (conservative).

### 4.2.1 Topic Normalization

The NLP service emits compound labels outside the five-topic taxonomy (e.g.
"Public Safety and Peace and Order", "Infrastructure and Public Works").
`normalizeTopic()` in `$lib/utils/priority.ts` maps them onto canonical
topics via an alias table (case-insensitive); unrecognized labels fold into
**Other**. The API filters _after_ normalization — a PostgREST `eq()` on the
canonical value would miss compound-labelled rows.

### 4.2.2 Graceful Degradation

If migration `004_issue_prioritization.sql` has not been applied (engagement
columns missing → PostgREST error 42703), the endpoint retries the window
query without the engagement embed and scores frequency + negativity only.
The response includes `"engagementAvailable": false` so clients can surface
the degraded mode.

### 4.3 Status Derivation (no parallel state system)

Status per topic comes from the existing `civic_issues` workflow:

| Condition                                        | Label          |
| ------------------------------------------------ | -------------- |
| No civic_issue ticket exists for the topic       | **New**        |
| ≥1 ticket exists, none Resolved/Closed           | **Monitoring** |
| Every ticket for the topic is Resolved or Closed | **Addressed**  |

`review_records` is intentionally untouched — it governs misinformation
claims, not topic workflow state.

### 4.4 API — `GET /api/priorities`

Query params (whitelist-validated):

- `topic` — one of `Infrastructure | Healthcare | Waste Management | Public Safety | Other`; unknown values are ignored (all topics returned).
- `days` — `7 | 30 | 90`; other values fall back to `30`.

Response:

```json
{
	"range": { "days": 30, "since": "<ISO>" },
	"generatedAt": "<ISO>",
	"priorities": [
		{
			"rank": 1,
			"topic": "Infrastructure",
			"displayName": "Road Repair",
			"score": 78,
			"status": "Monitoring",
			"frequencyComponent": 1.0,
			"negativityComponent": 0.62,
			"engagementComponent": 0.41,
			"commentCount": 34,
			"negativeCount": 21,
			"engagementCount": 118
		}
	]
}
```

Requires an authenticated session (`safeGetSession()`); unauthenticated
requests are redirected to `/login`.

### 4.5 Display Names

Cards show friendly category names mapped from NLP topic labels via
`TOPIC_DISPLAY_NAMES` (Infrastructure→"Road Repair", Healthcare→"Health
Services", Waste Management→"Waste Collection", Public Safety→"Public
Safety", Other→"Other"). Unknown labels fall back to the raw value.

---

## 5. Database Schema Summary

```
profiles              — user accounts (role: analyst | admin, password_set gate)
raw_content           — Layer 1: ingested comments; reaction_count, reply_count (DEFAULT 0)
processed_content     — Layer 3: NLP results + barangay_mention
lgu_documents         — Layer 4: RAG source documents (person-level metadata)
document_chunks       — Layer 4: paragraph-level pgvector chunks for retrieval
flagged_claims        — Layer 4: claims queued for staff review
review_records        — Layer 5: immutable review decisions
audit_logs            — append-only event log
civic_issues          — Issue Tracker tickets (priority, status, FKs to sources/assignees)
issue_status_logs     — status-transition audit trail (auto via trigger)
issue_comments        — internal staff discussion threads
```

Key indexes:

- `idx_civic_issues_{status,priority,topic,source_comment}` — tracker queries
- `idx_processed_content_topic_time (topic_label, processed_at)` — prioritization window aggregation
- `idx_processed_content_barangay` — partial index for heatmap aggregation
- `document_chunks_embedding_idx` — pgvector **hnsw** (cosine) chunk search
- `document_chunks_document_id_idx` — per-document chunk lookup/invalidation

RLS:

- `civic_issues`, `issue_status_logs`, `issue_comments`: authenticated
  SELECT/INSERT/UPDATE; DELETE service-role only.
- `raw_content`, `processed_content`: RLS enabled; authenticated SELECT only
  (migration `004_issue_prioritization.sql`). All writes flow through
  service-role contexts (Edge Functions / ingestion cron).
- `document_chunks` (migration `006_rag_chunking.sql`): RLS enabled;
  authenticated **SELECT only** — no INSERT/UPDATE/DELETE policy for
  authenticated, so all chunk writes flow through service-role contexts
  (the `process-comment` Edge Function and `backfill_chunks.py`). This blocks
  any authenticated user from posting poisoned embeddings that would sabotage
  retrieval.

---

## 6. Security Model

- Session cookies via `@supabase/ssr`; `safeGetSession()` validates tokens
  server-side with `getUser()` before trusting them.
- `/Authenticated/**` routes hard-gated in `hooks.server.ts`.
- API routes independently session-check; query params are whitelist-
  validated enum values; all Supabase queries are parameterized (no string
  interpolation).
- Service-role key is used only inside `src/lib/server/` (SvelteKit blocks
  client imports) and mirrors every sibling API route.
- Auto-logout beacon (`/api/logout-beacon`) invalidates sessions on tab close.
- Password policy: 12+ chars, mixed classes; invites are single-use.

---

## 7. Testing

```
pnpm vitest run        # unit tests (tests/unit/**/*.test.ts)
pnpm check             # svelte-check / TypeScript
pnpm lint              # prettier --check
```

Unit tests cover the trend-data builder, sentiment-trend series bucketing
(Manila-timezone edges, year rollover, partial buckets), dashboard helpers,
and the full
priority scoring module (weights, normalization, MIN_SUPPORT fallback,
tie-breaking, rank assignment, status derivation).

---

## 8. Deployment Notes (Vercel + Supabase)

1. Apply migrations to production SQL editor — including
   `004_issue_prioritization.sql`.
2. Set env vars: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. Supabase Auth: Site URL + redirect allowlist, invite email template using
   `/auth/callback/confirm?token_hash={{ .TokenHash }}&type=invite`, SMTP.
4. Post-deploy smoke test: invite → set password → login → dashboard tabs →
   Issue Prioritization loads ranked cards.
