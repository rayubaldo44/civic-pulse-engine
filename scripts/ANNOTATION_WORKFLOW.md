# Label Studio Annotation Workflow — Civic Pulse Engine

End-to-end pipeline for human annotation of NLP outputs, feeding results back
into Supabase. Single-annotator friendly; re-runnable on demand.

## Prerequisites

- Docker (for Label Studio)
- Supabase access with the **service-role key** in your env
  (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — same as `fetch_comments.py`).

## Python environment

The annotation scripts use the `supabase` Python package. The system Python
(3.14) has an incompatible `httpcore`, so create a project-local venv once:

```bash
python -m venv .venv
.venv/bin/pip install supabase
```

Then run every script below with `.venv/bin/python`.

## Quick start

### 1. Start Label Studio

```bash
docker compose up -d
```

Open http://localhost:8080 and create an admin account. Your projects and
labels persist in the `label-studio-data` Docker volume.

### 2. Export unreviewed rows from Supabase

```bash
set -a; source .env.local; set +a    # loads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
.venv/bin/python scripts/export_annotation_data.py
```

Writes three CSVs to `scripts/exports/`:

| File                   | Rows pulled                                             |
| ---------------------- | ------------------------------------------------------- |
| `sentiment_review.csv` | `processed_content` where `sentiment_needs_review=true` |
| `topic_review.csv`     | `processed_content` where `topic_needs_review=true`     |
| `flagged_claims.csv`   | `flagged_claims` where `status='Pending'`               |

### 3. Create three Label Studio projects

For each project: **Settings → Labeling Interface**, paste the matching config
from `scripts/label_configs/`, then **Import** the matching CSV:

| Project        | Config file                        | CSV                    |
| -------------- | ---------------------------------- | ---------------------- |
| Sentiment      | `label_configs/sentiment.xml`      | `sentiment_review.csv` |
| Topic          | `label_configs/topic.xml`          | `topic_review.csv`     |
| Flagged Claims | `label_configs/flagged_claims.xml` | `flagged_claims.csv`   |

Note: a single comment can appear in both Sentiment and Topic exports (both
flags low). Annotate each project independently.

### 4. Annotate

Review each task, pick a label (and notes for flagged claims). Skip tasks you
can't judge — they'll stay unreviewed.

### 5. Export annotations as JSON

For each project: **Export** (format: **JSON**, one of "JSON list of tasks").
Save as `scripts/exports/{sentiment_review,topic_review,flagged_claims}.json`
(matching the names in `import_annotations.py`).

### 6. Import results back to Supabase

```bash
set -a; source .env.local; set +a
export PROFILES_ID="<your profiles.id>"   # needed for flagged-claims audit trail
.venv/bin/python scripts/import_annotations.py
```

What gets applied:

- **Sentiment** → `processed_content.sentiment_label` updated and
  `sentiment_needs_review` cleared.
- **Topic** → `processed_content.topic_label` updated and
  `topic_needs_review` cleared.
- **Flagged Claims** → `flagged_claims.status` set to the decision **and** a
  `review_records` row inserted (feeds the dashboard's Verified Accuracy stat).

Because reviewed rows are un-flagged on import, re-running step 2 only ships
**new** unreviewed rows. This makes the pipeline safe to schedule (cron or
manual) without double-annotation.

## Files

```
docker-compose.yml                         # Label Studio service + volume
scripts/export_annotation_data.py          # Supabase -> CSVs
scripts/import_annotations.py              # Label Studio JSONs -> Supabase
scripts/label_configs/*.xml                # Labeling Interface templates
scripts/exports/                           # generated CSVs/JSONs (gitignored)
```

## Env vars

| Var                         | Used by                      |
| --------------------------- | ---------------------------- |
| `SUPABASE_URL`              | export/import                |
| `SUPABASE_SERVICE_ROLE_KEY` | export/import                |
| `PROFILES_ID`               | import (flagged claims only) |
