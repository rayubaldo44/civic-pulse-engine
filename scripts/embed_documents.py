# scripts/embed_documents.py
#
# Civic Pulse Engine — One-Time LGU Document Embedder
# Uses plain requests only — no supabase library needed.
#
# Usage:
#   SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=sb_secret_... HF_SPACE_URL=https://... python3 scripts/embed_documents.py

import os
import sys
import json
import requests

SUPABASE_URL  = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
HF_SPACE_URL  = os.environ.get("HF_SPACE_URL", "")

_missing = [k for k, v in {
    "SUPABASE_URL": SUPABASE_URL,
    "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_KEY,
    "HF_SPACE_URL": HF_SPACE_URL,
}.items() if not v]
if _missing:
    print(f"Error: missing required environment variables: {', '.join(_missing)}", file=sys.stderr)
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

def get_documents():
    res = requests.get(
        f"{SUPABASE_URL}/rest/v1/lgu_documents?select=id,title,content",
        headers=HEADERS,
        timeout=15,
    )
    res.raise_for_status()
    return res.json()

def get_embedding(text):
    res = requests.post(
        f"{HF_SPACE_URL}/embed",
        json={"text": text},
        timeout=30,
    )
    res.raise_for_status()
    return res.json()["embedding"]

def save_embedding(doc_id, embedding):
    res = requests.patch(
        f"{SUPABASE_URL}/rest/v1/lgu_documents?id=eq.{doc_id}",
        headers=HEADERS,
        json={"embedding": embedding},
        timeout=15,
    )
    res.raise_for_status()

def main():
    print("=== LGU Document Embedder ===\n")

    docs = get_documents()
    if not docs:
        print("No documents found.")
        sys.exit(0)

    print(f"Found {len(docs)} documents.\n")

    for doc in docs:
        print(f"Embedding: {doc['title']}...")
        try:
            embedding = get_embedding(doc["content"])
            save_embedding(doc["id"], embedding)
            print(f"  ✅ Done ({len(embedding)} dimensions)")
        except Exception as e:
            print(f"  ❌ Failed: {e}")

    print(f"\nAll done. {len(docs)} documents embedded.")

if __name__ == "__main__":
    main()
