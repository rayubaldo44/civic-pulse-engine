# scripts/backfill_chunks.py
#
# Civic Pulse Engine — Document Chunk Backfill
#
# Splits each active lgu_documents row into paragraph-level chunks (using
# scripts/chunk_documents.py), embeds each chunk via the HF Space /embed
# endpoint, and writes them to the new document_chunks table (plan §7 step 2).
#
# Idempotent: for each document it deletes the doc's existing chunks before
# inserting fresh ones, so it can be safely (re)run. Source documents are
# never modified — no data loss.
#
# Security / resilience (added as part of implementation):
#   * Service-role key used against Supabase REST (bypasses RLS — writes to
#     document_chunks are service-role only per the migration).
#   * Every external HTTP call (HF /embed + Supabase REST) has a timeout.
#   * A token-bucket rate limiter throttles calls to the external /embed
#     endpoint so the chunker does not hammer the shared HF Space (the new
#     chunk-level pipeline multiplies embed calls many-fold vs. whole-doc).
#   * Retry with exponential backoff + jitter on transient failures (network,
#     5xx, 429) for both /embed and Supabase writes; 4xx are fatal.
#
# Usage:
#   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... HF_SPACE_URL=... \
#     python3 scripts/backfill_chunks.py [--embed-rate N] [--only-doc UUID]
#
# Options:
#   --embed-rate N   max /embed calls per second (default 3.0)
#   --only-doc UUID  process only a single document (for testing)

import os
import sys
import json
import time
import argparse
import random
import requests

from chunk_documents import chunk_document

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
HF_SPACE_URL = os.environ.get("HF_SPACE_URL", "")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

# ── HTTP fallback / timeouts ──────────────────────────────────────────────
REQUEST_TIMEOUT = 60          # seconds (embed can be slow on first load)
MAX_RETRIES = 4               # total attempts = 1 + MAX_RETRIES
BACKOFF_BASE = 1.5            # seconds, doubled each retry
BACKOFF_JITTER = 0.4          # fraction of backoff to jitter
# Non-retryable HTTP statuses → surfaced immediately as fatal errors.
FATAL_STATUS = {400, 401, 403, 404, 405, 422}


class TokenBucketLimiter:
    """Minimal token-bucket rate limiter (per-second capacity)."""

    def __init__(self, rate: float, burst: int = 1):
        self.rate = rate
        self.capacity = float(max(burst, 1))
        self.tokens = float(burst)
        self.updated = time.monotonic()

    def wait(self):
        while True:
            now = time.monotonic()
            elapsed = now - self.updated
            self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
            self.updated = now
            if self.tokens >= 1.0:
                self.tokens -= 1.0
                return
            # Sleep until the next token is available.
            deficit = 1.0 - self.tokens
            time.sleep(deficit / self.rate if self.rate > 0 else 0.1)


class ExponentialBackoff:
    """Retry helper with exponential backoff + jitter."""

    @staticmethod
    def sleep(attempt: int):
        delay = BACKOFF_BASE * (2 ** attempt)
        delay *= 1 + random.uniform(-BACKOFF_JITTER, BACKOFF_JITTER)
        time.sleep(delay)


def _should_retry(res: requests.Response) -> bool:
    """True if the response status indicates a transient failure worth retrying."""
    if 200 <= res.status_code < 300:
        return False
    if res.status_code in FATAL_STATUS:
        return False
    return True  # 5xx, 429, timeouts/connection errors, etc.


def request_with_retry(method, url, **kwargs):
    """Issue an HTTP request with retry + exponential backoff.

    Returns the final Response (caller checks .ok). Raises on connection
    errors after exhausting retries only; transient statuses are retried.
    """
    attempts = 0
    while True:
        try:
            res = requests.request(method, url, timeout=REQUEST_TIMEOUT, **kwargs)
        except (requests.ConnectionError, requests.Timeout) as e:
            if attempts >= MAX_RETRIES:
                raise
            print(f"    ⚠️ {type(e).__name__} — retrying ({attempts + 1}/{MAX_RETRIES})")
            ExponentialBackoff.sleep(attempts)
            attempts += 1
            continue

        if not _should_retry(res):
            return res  # success or fatal

        if attempts >= MAX_RETRIES:
            return res
        print(
            f"    ⚠️ HTTP {res.status_code} — retrying ({attempts + 1}/{MAX_RETRIES})"
        )
        ExponentialBackoff.sleep(attempts)
        attempts += 1


# ── Supabase REST helpers ─────────────────────────────────────────────────
def rest(path: str, method: str = "GET", json_body=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    res = request_with_retry(
        method,
        url,
        headers=HEADERS,
        json=json_body if json_body is not None else None,
    )
    return res


def get_active_documents() -> list:
    path = (
        "lgu_documents?select=id,title,content,document_type"
        "&is_active=eq.true"
    )
    res = rest(path, "GET")
    res.raise_for_status()
    return res.json()


def fetch_document(doc_id: str) -> dict:
    path = (
        "lgu_documents?select=id,title,content,document_type"
        f"&id=eq.{doc_id}"
    )
    res = rest(path, "GET")
    res.raise_for_status()
    rows = res.json()
    if not rows:
        return {}
    return rows[0]


def delete_chunks(doc_id: str):
    res = rest(f"document_chunks?document_id=eq.{doc_id}", "DELETE")
    res.raise_for_status()


def insert_chunks(doc_id: str, chunks: list):
    if not chunks:
        return
    res = rest("document_chunks", "POST", json_body=chunks)
    res.raise_for_status()


# ── Embedding ──────────────────────────────────────────────────────────────
def get_embedding(text: str, limiter: TokenBucketLimiter) -> list:
    limiter.wait()  # throttle external calls before hitting the HF Space
    res = request_with_retry(
        "POST",
        f"{HF_SPACE_URL}/embed",
        json={"text": text},
        headers={"Content-Type": "application/json"},
    )
    if not res.ok:
        raise RuntimeError(f"Embed API error {res.status_code}: {res.text[:300]}")
    data = res.json()
    embedding = data.get("embedding")
    # Validate shape defensively — a malformed response should surface loudly
    # rather than poison the vector store.
    if not isinstance(embedding, list) or len(embedding) != 768:
        raise RuntimeError(
            f"Embed API returned unexpected vector of length "
            f"{len(embedding) if isinstance(embedding, list) else '?'} (expected 768)"
        )
    return embedding


# ── Main ───────────────────────────────────────────────────────────────────
def process_document(doc: dict, limiter: TokenBucketLimiter) -> int:
    print(f"\n  {doc['title']} ({doc.get('document_type', '?')})")
    chunks = chunk_document(doc.get("content", ""), doc.get("document_type"))
    if not chunks:
        print("    (no chunkable content — skipping)")
        return 0

    print(f"    → {len(chunks)} chunk(s)")

    # Idempotency: clear the doc's chunks before regenerating (plan §4).
    delete_chunks(doc["id"])

    rows = []
    for c in chunks:
        embedding = get_embedding(c["chunk_text"], limiter)
        rows.append(
            {
                "document_id": doc["id"],
                "chunk_index": c["chunk_index"],
                "chunk_text": c["chunk_text"],
                "section_label": c["section_label"],
                "token_count": c["token_count"],
                "embedding": embedding,
            }
        )

    insert_chunks(doc["id"], rows)
    print(f"    ✅ saved {len(rows)} chunk(s)")
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description="Backfill document_chunks")
    parser.add_argument("--embed-rate", type=float, default=3.0,
                        help="max /embed calls per second (default 3.0)")
    parser.add_argument("--only-doc", type=str, default=None,
                        help="process only a single document UUID")
    args = parser.parse_args()

    _missing = [
        k
        for k, v in {
            "SUPABASE_URL": SUPABASE_URL,
            "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_KEY,
            "HF_SPACE_URL": HF_SPACE_URL,
        }.items()
        if not v
    ]
    if _missing:
        print(
            f"Error: missing required environment variables: {', '.join(_missing)}",
            file=sys.stderr,
        )
        sys.exit(1)

    limiter = TokenBucketLimiter(rate=args.embed_rate)

    print("=== LGU Document Chunk Backfill ===\n")

    if args.only_doc:
        doc = fetch_document(args.only_doc)
        if not doc:
            print(f"No document found with id {args.only_doc}")
            sys.exit(1)
        docs = [doc]
    else:
        docs = get_active_documents()

    if not docs:
        print("No active documents found.")
        sys.exit(0)

    print(f"Found {len(docs)} active document(s).")
    total_chunks = 0
    for doc in docs:
        try:
            total_chunks += process_document(doc, limiter)
        except Exception as e:
            print(f"  ❌ Failed for {doc.get('title', doc.get('id'))}: {e}")

    print(f"\nAll done. {total_chunks} chunks written across {len(docs)} documents.")


if __name__ == "__main__":
    main()
