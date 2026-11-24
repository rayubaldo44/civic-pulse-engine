#!/usr/bin/env python3
"""
scripts/export_annotation_data.py

Civic Pulse Engine — Label Studio data exporter.

Pulls UNREVIEWED rows out of Supabase into CSVs that you upload to Label
Studio as annotation tasks. Re-runnable: because the import script clears the
"needs review" flag / status, a second run only ships NEW rows.

Three projects / three CSVs (written to scripts/exports/):

  sentiment_review.csv   <- processed_content  WHERE sentiment_needs_review
  topic_review.csv       <- processed_content  WHERE topic_needs_review
  flagged_claims.csv     <- flagged_claims     WHERE status = 'Pending'

Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (same convention as
scripts/fetch_comments.py).
"""

import os
import sys
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

EXPORT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "exports")

SENTIMENT_CSV = os.path.join(EXPORT_DIR, "sentiment_review.csv")
TOPIC_CSV = os.path.join(EXPORT_DIR, "topic_review.csv")
FLAGGED_CSV = os.path.join(EXPORT_DIR, "flagged_claims.csv")


def get_supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
        sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def _safe_text(value) -> str:
    if value is None:
        return ""
    value = str(value)
    value = value.replace("\r", " ").replace("\n", " ")
    return value.replace('"', '""')


def _to_csv(rows, headers):
    lines = [",".join(headers)]
    for row in rows:
        lines.append(
            ",".join(f'"{_safe_text(row.get(h, ""))}"' for h in headers)
        )
    return "\n".join(lines) + "\n"


def export_sentiment(sb: Client) -> int:
    result = (
        sb.table("processed_content")
        .select("id, cleaned_text, comment_id, sentiment_label")
        .eq("sentiment_needs_review", True)
        .order("processed_at")
        .execute()
    )
    rows = result.data
    headers = ["id", "cleaned_text", "comment_id", "sentiment_label"]
    with open(SENTIMENT_CSV, "w", encoding="utf-8") as f:
        f.write(_to_csv(rows, headers))
    return len(rows)


def export_topic(sb: Client) -> int:
    result = (
        sb.table("processed_content")
        .select("id, cleaned_text, comment_id, topic_label")
        .eq("topic_needs_review", True)
        .order("processed_at")
        .execute()
    )
    rows = result.data
    headers = ["id", "cleaned_text", "comment_id", "topic_label"]
    with open(TOPIC_CSV, "w", encoding="utf-8") as f:
        f.write(_to_csv(rows, headers))
    return len(rows)


def export_flagged_claims(sb: Client) -> int:
    result = (
        sb.table("flagged_claims")
        .select("id, claim_text, rag_determination, rag_evidence_snippet")
        .eq("status", "Pending")
        .order("created_at")
        .execute()
    )
    rows = result.data
    headers = ["id", "claim_text", "rag_determination", "rag_evidence_snippet"]
    with open(FLAGGED_CSV, "w", encoding="utf-8") as f:
        f.write(_to_csv(rows, headers))
    return len(rows)


def main():
    os.makedirs(EXPORT_DIR, exist_ok=True)
    sb = get_supabase()

    counts = {
        ("sentiment", SENTIMENT_CSV): export_sentiment(sb),
        ("topic", TOPIC_CSV): export_topic(sb),
        ("flagged_claims", FLAGGED_CSV): export_flagged_claims(sb),
    }

    print("Export complete:")
    for (name, path), count in counts.items():
        print(f"  {name:<15} {count:>4} rows -> {path}")
    if not any(count for (_, path), count in counts.items()):
        print("  (No unreviewed rows found — nothing to annotate.)")


if __name__ == "__main__":
    main()
