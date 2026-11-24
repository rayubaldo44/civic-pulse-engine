# Measuring login and page performance

The benchmark in `scripts/measure-performance.mjs` measures a production build without using the seeded Playwright configuration. It submits only the ordinary login form and visits pages; it never seeds a database, invokes migrations, exports records, edits settings, reviews claims, or marks notifications read. Normal application reads/polls can still run their existing notification evaluator. Successful logins create normal audit entries.

## Run locally

Use your normal local application configuration and existing test accounts. Keep the application and its Supabase database consistent between comparisons.

```sh
pnpm build
pnpm exec vite preview --host 127.0.0.1 --port 4173
```

In another terminal, supply account credentials through environment variables using your normal secret-management method. Required variables are `PERF_ANALYST_EMAIL` and `PERF_ANALYST_PASSWORD`; `PERF_ADMIN_EMAIL` and `PERF_ADMIN_PASSWORD` add admin coverage. Either complete credential pair can run independently. The script does not read `.env` files or print supplied credentials.

```sh
BASE_URL=http://127.0.0.1:4173 node scripts/measure-performance.mjs
```

Chromium must already be installed. If necessary, install it using `pnpm exec playwright install chromium`.

Default coverage is five runs for each configured role, desktop and mobile profiles, and all authenticated routes. For a quick smoke run:

```sh
PERF_RUNS=1 PERF_PROFILES=desktop PERF_ROUTES=dashboard,reference-docs node scripts/measure-performance.mjs
```

## Run against a hosted preview

Hosted requests require explicit opt-in. Use a dedicated benchmark account. Never aim the seeded e2e configuration at a hosted database.

```sh
BASE_URL=https://your-preview.example PERF_ALLOW_HOSTED=1 node scripts/measure-performance.mjs
```

The URL must be HTTPS, have no embedded credentials, and contain no path, query, or fragment. Deployment protection must be resolved separately; a login/protection redirect is a failed sample rather than a successful page load.

## What the results mean

JSON artifacts default to a timestamped file under `/tmp`. Set `PERF_OUTPUT` to choose another file. Artifacts contain only static route/role/profile identifiers, numeric timing and byte/request counters, and fixed failure codes. They contain no account email, password, response body, cookie, saved auth state, screenshots, traces, query strings, or full request URLs. Auth cookies are copied between browser contexts only in memory.

For each role/profile/run the script measures:

- **Login page, cold and warm browser:** visibility and usability of the login form before and after reloading it.
- **Login to usable:** submit to the role's expected landing page, including loaded dashboard metrics/chart data or the admin configuration/personnel controls. This excludes the preceding time spent loading/filling the login form.
- **Direct cold browser:** a fresh browser context with in-memory auth cookies, opening each route directly.
- **Direct warm browser:** reopening the same route in the same browser context, allowing normal HTTP asset caching.
- **Client navigation:** opening the route through its sidebar link, including notification-menu navigation. A document reload is reported as a failure because this scenario expects SvelteKit client navigation.

A cold browser does **not** guarantee a cold Vercel/serverless instance or an empty server cache. Browser contexts cannot force either. Cold and warm samples share the same deployed code and database.

First-content time means the expected page heading becomes visible (the login form on `/login`), rather than the browser's FCP metric. Usable time additionally waits for document hydration and route-specific controls/data: resolved dashboard metrics/chart-data placeholders; rendered sentiment chart or its legitimate empty state; paginated claims/document results and totals; issue-board search/status data; audit table or analyst export links; loaded notification results or empty state; profile form; or admin config/personnel. Errors and unavailable notification schema fail the sample instead of being counted as fast empty content. The benchmark does not assert the correctness of the underlying data, measure document editing, or include optional dashboard tabs.

Request count and completed encoded transfer bytes come from Chromium's network protocol during the measured action. In-flight requests at usable time are reported separately, so bytes are not a full-page lifetime download total. HTTP errors are counted. Known numeric `Server-Timing` groups are summed across measured responses; concurrent spans overlap, and database work finishing after streamed response headers may be absent. These sums are diagnostic rather than an exclusive breakdown of wall-clock time.

Desktop uses a 1440×1000 viewport without artificial throttling. Mobile uses 390×844, 150 ms added network latency, 1.6 Mbps download, 750 Kbps upload and 4× CPU slowdown. This is a repeatable Chromium simulation, not evidence from a physical phone.

Each group reports median and nearest-rank p95, along with sample/success/failure counts. Five samples are a smoke-sized comparison; increase `PERF_RUNS` for a more stable p95. Failures produce a nonzero process exit code and remain visible in the artifact. `PERF_TIMEOUT_MS` defaults to 30000 and accepts 1000–120000.

The script overrides `navigator.sendBeacon` only for the app's `/api/logout-beacon` teardown call (and delegates other beacons normally), so one context closing does not invalidate the in-memory login session needed by later contexts. This affects teardown only and preserves normal browser HTTP caching; Playwright request interception is not used. It is not a change to application authentication. Use dedicated accounts and manage their sessions normally after benchmarking.

## Compare and accept changes

Run the same route list, roles, profiles, run count and dataset against before/after builds. Capture database/server cache conditions and deployment region separately. Do not compare Vite development timings with production-build timings. Confirm that list response sizes stay bounded as records grow, and investigate auth/database timing groups before changing infrastructure.

The provisional goals are login-to-usable within 3 seconds and warm navigation within 1 second. They are targets, not measured promises. No hosted before/after improvement is established merely by passing unit tests, building successfully, or adding timing headers. Keep the baseline and follow-up JSON artifacts for an actual comparison.

## Local regression suite and deployment order

`pnpm exec playwright test --config playwright.preview.config.ts` runs page-loading regression tests against local Supabase only. If no preview is already running, it builds with local-stack credentials and starts the preview automatically. Reuse an existing preview only if it was also built with those local credentials. The fixture helper honors the configured base URL and suppresses the last-tab teardown beacon for reused test sessions; explicit logout actions remain tested. The independent Edge/HuggingFace NLP ingestion tests remain in the normal e2e suite and are excluded from this page-loading suite.

Before deploying the application changes, apply `20261110130240_claims_pagination.sql` and `20261110130258_issue_pagination.sql` using the project's normal migration process. The existing `015_issue_peer_review.sql` is a prerequisite. Both new RPCs use SECURITY INVOKER and allow only service-role execution. The paginated loaders deliberately return a recoverable error if the RPCs are missing rather than reverting to unbounded reads. No hosted migration or deployment was performed during implementation.

The repository keeps the existing `/api/issues` array response for compatibility. App trackers now use `/api/issues/paged`; claims and reference libraries use 25-result pages with database filtering/counts. Full document content is available through the authenticated `/api/reference-docs/[id]` endpoint.

## Verified implementation snapshot — 2026-11-10

The production build, 602 unit tests, 58 local PostgreSQL integration tests, and 33 production-preview browser tests pass. Type checking has zero errors and seven existing warnings; formatting/lint pass. Browser regression fixtures exercise 126–130-record lists, page-six access, all-record filtering/counts, per-column loading, mutation refresh, history navigation and on-demand document content. The page-loading suite excludes the separate NLP ingestion pipeline.

A local seeded-data benchmark recorded 144 successful samples across analyst/admin roles, desktop and throttled-mobile profiles, with three runs per group for dashboard, documents and issues. Observed medians (seconds):

| Profile / role           | Login to landing content | Sidebar navigation across those three pages |
| ------------------------ | -----------------------: | ------------------------------------------: |
| Desktop analyst          |                    1.340 |                                 0.258–0.319 |
| Desktop admin            |                    1.310 |                                 0.163–0.316 |
| Throttled mobile analyst |                    1.450 |                                 0.404–0.471 |
| Throttled mobile admin   |                    1.244 |                                 0.397–0.435 |

Raw numeric artifacts for this session are `/tmp/civic-performance-local.json`; they contain no page bodies or credentials. These are small local measurements after the change, not a hosted before/after comparison. Browser checks also confirmed zero requests to Google font servers. The existing app is desktop-first: narrow-phone layout constraints remain a separate usability concern, and mobile timing results do not certify responsive usability.

A separate all-route smoke run recorded 126 successful samples (one run per group) covering login plus every authenticated route across both roles and both profiles. Artifact: `/tmp/civic-performance-all-routes.json`. Live-feed flagged-claim alerts are treated as legitimate content; a feed-load error still fails readiness, covered by a regression test. No failures remain in either benchmark run.
