# Unit Testing — Civic Pulse Engine

Documentation of the automated unit-test suite, written for the capstone paper.
All numbers below are verified against a live run (`pnpm vitest run`).

## 1. Overview

| Item        | Value                                            |
| ----------- | ------------------------------------------------ |
| Framework   | Vitest 4 (`node` environment, `$lib` path alias) |
| Test files  | 29                                               |
| Test cases  | **391** — all passing (0 skipped, 0 failed)      |
| Run command | `pnpm vitest run`                                |

Scope spans three layers, from pure business logic down to rendered UI:

- **Layer 1 — Pure logic & utilities** · 13 files · **201 tests**
- **Layer 2 — Server / API route handlers** · 13 files · **166 tests**
- **Layer 3 — Svelte UI components** · 3 files · **24 tests**

## 2. Testing approach

Unit tests target small, deterministic units and run without a database,
network, or browser:

- **Pure logic** is asserted directly on live functions.
- **Database and API behaviour** uses a hand-rolled
  `fake-supabase` helper (`tests/unit/helpers/fake-supabase.ts`) that records
  every query (`table`, `select`, `order`, `filters`) so tests can assert on
  _what query was built_, not just its result.
- **Auth / environment** use `vi.hoisted` mocks and static env stubs
  (`tests/unit/helpers/env-stubs/`).
- **Components** mount real Svelte runes components and drive them with
  keyboard/click events.

The suite deliberately locks in **lenient validation**: invalid filter or
enum values are _ignored, not rejected_ (e.g. `?status=Ope` must never reach
`eq()`), and every timezone calculation is tested against **Asia/Manila
civil time**, never raw UTC math.

## 3. Layer 1 — Pure logic & utilities (201 tests)

| Module (test file)  | Unit under test                                                 | Tests | What the tests prove                                                                                                                                           |
| ------------------- | --------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sentiment-trends`  | `sentiment-trends.ts`                                           | 45    | Trend-window boundaries, 28-day / monthly / yearly bucketing, date-window clamping, sentiment folding (review/null → neutral), PH-timezone midnight edge cases |
| `issue-transitions` | `ISSUE_TRANSITIONS`, `isValidTransition`                        | 33    | Workflow adjacency map integrity, every legal/illegal edge, fail-closed behaviour on unknown statuses                                                          |
| `password`          | `validateNewPassword`, `maskEmail`                              | 26    | Each complexity rule in isolation, 12-char minimum, check ordering, email masking edge cases                                                                   |
| `priority`          | `computeTopicPriorities`, `normalizeTopic`, `deriveTopicStatus` | 17    | Weight sums, scoring/rank tie-breaking, MIN_SUPPORT filtering, NLP compound-topic normalisation                                                                |
| `patch-validator`   | `validatePatchFields`                                           | 14    | Illegal transitions rejected, priority whitelist, assignee callback validation, field-order precedence                                                         |
| `accuracy`          | `computeClaimAccuracy`, `consolidateReviewRecords`              | 12    | Verified↔RAG agreement metrics, per-class precision/recall, dedup by latest review, case/whitespace tolerance                                                  |
| `csv`               | `csvCell`                                                       | 12    | Quoting, null/empty cells, CSV formula-injection neutralisation (`=+-@`), embedded-quote doubling                                                              |
| `badges`            | `priorityBadge`, `ragBadgeClass`, `sentimentDot`                | 9     | Distinct class per value, deterministic fallbacks for unknown/null                                                                                             |
| `caches`            | badges + dashboard caches                                       | 9     | TTL expiry, per-user key isolation, never caching errored results                                                                                              |
| `dashboard-trend`   | `buildTrendData`                                                | 8     | Hourly vs 7-day fallback, bucket-boundary placement, empty handling                                                                                            |
| `edge-rag-parse`    | `parseRagDetermination` (Edge helper)                           | 9     | Contract-valid JSON, substring fallback, evidence-snippet trim/cap at 300 chars                                                                                |
| `format`            | `formatDateTime`                                                | 3     | en-PH date/time grouping, null-safety                                                                                                                          |
| `edge-topic`        | `normalizeTopic` (Edge helper)                                  | 4     | Canonical pass-through, compound variants, case-insensitivity, fallback to “Other”                                                                             |

## 4. Layer 2 — Server / API route handlers (166 tests)

| Module (test file)     | Route / server unit                           | Tests | What the tests prove                                                                                        |
| ---------------------- | --------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| `api-issue-detail`     | `GET/PATCH /api/issues/[id]`                  | 32    | Transition enforcement + status-log correction, notification email on/off rules, unassign, field validation |
| `auth-flows`           | login / set-password / logout / auth-callback | 27    | Session redirects, generic auth errors (no leakage), role routing, password-set flow, invite-token handling |
| `issues-list`          | `listIssues`                                  | 15    | Shared select shape, newest-first order, valid filters reach query, invalid ignored, `ilike` keyword search |
| `api-issues`           | `GET/POST /api/issues`                        | 17    | Whitelist filters, topic whitelist, priority coercion, assignee validation + notify, error mapping          |
| `issue-store`          | `createIssueState` (rune store)               | 17    | SSR seed, detail load, optimistic merge, resolve PATCH, refresh dedup, stale-response discard               |
| `notify`               | `notifyIssueAssigned / StatusChanged`         | 12    | Self-assign skip, origin derivation (APP_ORIGIN vs VERCEL_URL), silent dev/missing-key no-op, error swallow |
| `api-priorities`       | `GET /api/priorities`                         | 10    | RPC aggregation, migration-004 (42703) fallbacks, 7/30/90-day windows, unknown-topic leniency               |
| `api-issue-comments`   | `POST /api/issues/[id]/comments`              | 10    | Parent-existence check (404), body validation, actor scoping, insert-error mapping                          |
| `flagged-claims-patch` | `PATCH flagged-claims`                        | 8     | Review record + audit write-on, Pending revert skips review, best-effort audit tolerance                    |
| `hooks`                | `hooks.server.handle`                         | 7     | Route guards, client env build, refresh-token rejection cookie clearing, session reuse                      |
| `audit`                | `logAudit`, `buildDetails`                    | 5     | Full payload insert, optional-field pass-through, null actor, failure swallow                               |
| `api-staff`            | `GET /api/staff`                              | 4     | Auth gate, order-by-name, null → empty, error mapping                                                       |
| `api-logout-beacon`    | `POST /api/logout-beacon`                     | 2     | Verified sign-out + audit, anonymous 204                                                                    |

## 5. Layer 3 — Svelte UI components (24 tests)

| Module (test file) | Component        | Tests | What the tests prove                                                                                                                    |
| ------------------ | ---------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `IssueTable`       | `IssueTable`     | 10    | Row rendering, empty state, search filter, status-pill filters, sort cycling, severity (not alpha) priority sort, Resolve action gating |
| `IssueSlideOver`   | `IssueSlideOver` | 9     | Render authoring, legal-transition list, Escape close, optimistic comment post, PATCH + refetch / revert-on-error                       |
| `IssueBoard`       | `IssueBoard`     | 5     | Five-column kanban order, empty placeholders, per-status routing, card select, avatar fallback                                          |

## 6. Run & verification

The suite is part of the project verification bar for every code change:

```bash
pnpm vitest run && pnpm check && pnpm format && pnpm lint
```

- `pnpm vitest run` — **391 / 391 tests passing** (this document’s baseline).
- `pnpm check` — svelte-check type pass (3 pre-existing warnings in
  unrelated files).
- `pnpm lint` / `pnpm format` — Prettier style gate for the touched files.
