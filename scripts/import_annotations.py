#!/usr/bin/env python3
"""
scripts/import_annotations.py

Civic Pulse Engine — Label Studio annotation importer.

Takes Label Studio JSON exports (one per project) and applies the human
verification back into Supabase. Run AFTER exporting annotations from Label
Studio and dropping the JSON files into scripts/exports/.

Projects & expected files (drop here, e.g. sentiment_review.json):

  sentiment_review.json    -> UPDATE processed_content.sentiment_label
                              AND clear sentiment_needs_review
  topic_review.json        -> UPDATE processed_content.topic_label
                              AND clear topic_needs_review
  flagged_claims.json      -> UPDATE flagged_claims.status
                              AND INSERT review_records (for Verify accuracy)

Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
For the flagged-claims project, also set PROFILES_ID to your profiles.id so
the audit row's reviewed_by FK is correct. If unset, the script tries to pick
the single admin profile; if there are several it aborts and asks you to set
PROFILES_ID.

Label Studio JSON export shape handled here (per task):
  {
    "data": { "id": "<supabase uuid>", ... },
    "annotations": [
      { "result": [ { "type": "choices", "value": {"choices": ["<label>"]} },
                    { "type": "textarea", "value": {"text": ["notes"]} } ] }
    ]
  }
"""

import json
import os
import sys
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
PROFILES_ID = os.environ.get("PROFILES_ID", "")

EXPORT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "exports")

# Project name -> filename in EXPORT_DIR
FILES = {
    "sentiment": "sentiment_review.json",
    "topic": "topic_review.json",
    "flagged_claims": "flagged_claims.json",
}


def get_supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
        sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def load_tasks(path: str) -> list[dict]:
    if not os.path.isfile(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _choice_from_result(result: list[dict], result_type: str):
    """Return the single label for a choices result, or text for textarea."""
    for r in result:
        if r.get("type") == result_type and r.get("value"):
            if result_type == "choices":
                choices = (r["value"].get("choices") or [])
                return choices[0] if choices else None
            if result_type == "textarea":
                text = (r["value"].get("text") or [])
                return text[0] if text else None
    return None


def apply_sentiment(sb: Client, tasks: list[dict]) -> tuple[int, int]:
    updated = skipped = 0
    for task in tasks:
        row_id = (task.get("data") or {}).get("id")
        label = _choice_from_result(task["annotations"][0]["result"], "choices") \
            if task.get("annotations") else None
        if not row_id or not label:
            skipped += 1
            continue
        sb.table("processed_content") \
            .update({"sentiment_label": label, "sentiment_needs_review": False}) \
            .eq("id", row_id) \
            .execute()
        updated += 1
    return updated, skipped


def apply_topic(sb: Client, tasks: list[dict]) -> tuple[int, int]:
    updated = skipped = 0
    for task in tasks:
        row_id = (task.get("data") or {}).get("id")
        label = _choice_from_result(task["annotations"][0]["result"], "choices") \
            if task.get("annotations") else None
        if not row_id or not label:
            skipped += 1
            continue
        sb.table("processed_content") \
            .update({"topic_label": label, "topic_needs_review": False}) \
            .eq("id", row_id) \
            .execute()
        updated += 1
    return updated, skipped


def resolve_reviewer_id(sb: Client) -> str:
    if PROFILES_ID:
        return PROFILES_ID
    admins = (
        sb.table("profiles")
        .select("id")
        .eq("role", "admin")
        .execute()
    ).data
    if len(admins) == 1:
        return admins[0]["id"]
    if len(admins) == 0:
        print("ERROR: No admin profile found to attribute reviews. Set PROFILES_ID.")
        sys.exit(1)
    print(
        "ERROR: Multiple admin profiles found. Set PROFILES_ID to your "
        "profiles.id to attribute reviews."
    )
    sys.exit(1)


def apply_flagged_claims(sb: Client, tasks: list[dict]) -> tuple[int, int]:
    reviewer_id = resolve_reviewer_id(sb)
    updated = skipped = 0
    for task in tasks:
        claim_id = (task.get("data") or {}).get("id")
        if not task.get("annotations"):
            skipped += 1
            continue
        result = task["annotations"][0]["result"]
        decision = _choice_from_result(result, "choices")
        notes = _choice_from_result(result, "textarea")
        if not claim_id or not decision:
            skipped += 1
            continue

        sb.table("flagged_claims") \
            .update({"status": decision}) \
            .eq("id", claim_id) \
            .execute()
        record = {
            "flagged_claim_id": claim_id,
            "reviewed_by": reviewer_id,
            "decision": decision,
        }
        if notes:
            record["notes"] = notes
        sb.table("review_records").insert(record).execute()
        updated += 1
    return updated, skipped


def main():
    sb = get_supabase()
    total_updated = 0
    total_skipped = 0

    for project, filename in FILES.items():
        path = os.path.join(EXPORT_DIR, filename)
        tasks = load_tasks(path)
        if not tasks:
            print(f"  [{project}] no file / no tasks at {path} — skipping")
            continue

        if project == "sentiment":
            updated, skipped = apply_sentiment(sb, tasks)
        elif project == "topic":
            updated, skipped = apply_topic(sb, tasks)
        else:
            updated, skipped = apply_flagged_claims(sb, tasks)

        print(
            f"  [{project:<14}] updated={updated:<4} skipped={skipped}"
        )
        total_updated += updated
        total_skipped += skipped

    print(f"Import complete: {total_updated} updated, {total_skipped} skipped.")


if __name__ == "__main__":
    main()
