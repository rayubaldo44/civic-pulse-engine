#!/usr/bin/env python3
"""
scripts/fetch_comments.py

Civic Pulse Engine — YouTube Comment Fetcher
Fetches public comments from YouTube videos about Philippine LGUs
and inserts them into Supabase raw_content.

MODES:
  MOCK MODE: When YOUTUBE_API_KEY is not set
  LIVE MODE: Uses YouTube Data API v3 (no approval needed)
"""

import os
import sys
import hashlib
import requests
from datetime import datetime, timezone, timedelta
from supabase import create_client, Client

# ── Date filter ───────────────────────────────────────────────────────────────
CUTOFF_DATE = datetime.now(timezone.utc) - timedelta(days=730)
CUTOFF_RFC3339 = CUTOFF_DATE.strftime("%Y-%m-%dT%H:%M:%SZ")  # for YouTube API

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# YouTube credentials (PRIMARY source - instant access)
YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "")

# Facebook credentials (FUTURE - when LGU approves)
FB_TOKEN     = os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN", "")
FB_PAGE_ID   = os.environ.get("FACEBOOK_PAGE_ID", "")

# Edge Function URL (for triggering processing)
EDGE_FUNCTION_URL = os.environ.get("EDGE_FUNCTION_URL", "")

# API versions and URLs
FB_API_VERSION = "v25.0"
FB_BASE_URL    = f"https://graph.facebook.com/{FB_API_VERSION}"

# Collection limits
MAX_YOUTUBE_COMMENTS = 80  # Increased from 15 since it's primary source now
MAX_FB_COMMENTS      = 20

# Search queries optimized for Philippine LGU content
YOUTUBE_SEARCH_QUERIES = [
    "Pulilan Bulacan",
    "Pulilan mayor",
    "Municipality of Pulilan",
    "Pulilan Bulacan news",
    "Pulilan local government"
]

# ── Supabase client ───────────────────────────────────────────────────────────
def get_supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
        sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Helpers ───────────────────────────────────────────────────────────────────
def hash_id(value: str) -> str:
    """SHA-256 hash for user IDs — PII compliance."""
    return hashlib.sha256(value.encode()).hexdigest()

def already_exists(supabase: Client, comment_id: str) -> bool:
    """Check if a comment_id is already in raw_content (dedup)."""
    result = supabase.table("raw_content") \
        .select("id") \
        .eq("comment_id", comment_id) \
        .limit(1) \
        .execute()
    return len(result.data) > 0

def insert_comment(supabase: Client, record: dict) -> bool:
    """Insert a single record into raw_content. Returns True on success."""
    try:
        supabase.table("raw_content").insert(record).execute()
        return True
    except Exception as e:
        print(f"  Insert error for {record.get('comment_id')}: {e}")
        return False

# ── Mock Mode ─────────────────────────────────────────────────────────────────
MOCK_COMMENTS = [
    {
        "comment_id":      "mock_001",
        "raw_text":        "Ang dumi ng kalsada sa amin! Tatlong buwan na walang aksyon ang LGU.",
        "author_hash":     hash_id("mock_user_001"),
        "source_platform": "youtube",
        "post_id":         "mock_video_001",
    },
    {
        "comment_id":      "mock_002",
        "raw_text":        "Sinabi ng mayor na 5 million ang budget para sa bagong health center, pero wala pa ring nangyayari.",
        "author_hash":     hash_id("mock_user_002"),
        "source_platform": "youtube",
        "post_id":         "mock_video_001",
    },
    {
        "comment_id":      "mock_003",
        "raw_text":        "Maganda ang bagong covered court sa barangay namin! Salamat LGU Pulilan.",
        "author_hash":     hash_id("mock_user_003"),
        "source_platform": "youtube",
        "post_id":         "mock_video_002",
    },
    {
        "comment_id":      "mock_004",
        "raw_text":        "Bakit hindi pa naaayos ang basura collection dito sa aming lugar? Dalawang linggo na!",
        "author_hash":     hash_id("mock_user_004"),
        "source_platform": "youtube",
        "post_id":         "mock_video_002",
    },
    {
        "comment_id":      "mock_005",
        "raw_text":        "Ayon sa balita, 10 million daw ang nawala sa pondo ng barangay. Totoo ba ito?",
        "author_hash":     hash_id("mock_user_005"),
        "source_platform": "youtube",
        "post_id":         "mock_video_003",
    },
    {
        "comment_id":      "mock_006",
        "raw_text":        "👍👍👍",
        "author_hash":     hash_id("mock_user_006"),
        "source_platform": "youtube",
        "post_id":         "mock_video_003",
    },
    {
        "comment_id":      "mock_007",
        "raw_text":        "Yung health center sa barangay namin, wala pa ring gamot. Paulit-ulit na reklamo pero walang solusyon.",
        "author_hash":     hash_id("mock_user_007"),
        "source_platform": "youtube",
        "post_id":         "mock_video_003",
    },
    {
        "comment_id":      "mock_008",
        "raw_text":        "Salamat sa bagong street lights! Mas safe na maglakad sa gabi.",
        "author_hash":     hash_id("mock_user_008"),
        "source_platform": "youtube",
        "post_id":         "mock_video_004",
    },
]

def run_mock_mode(supabase: Client):
    print("🔧 MOCK MODE — YouTube API key not set. Inserting test comments.")
    inserted = 0
    skipped  = 0

    for comment in MOCK_COMMENTS:
        if already_exists(supabase, comment["comment_id"]):
            print(f"  Skipping duplicate: {comment['comment_id']}")
            skipped += 1
            continue

        record = {
            **comment,
            "is_processed": False,
            "fetched_at":   datetime.now(timezone.utc).isoformat(),
        }
        if insert_comment(supabase, record):
            print(f"  Inserted: {comment['comment_id']} — {comment['raw_text'][:60]}...")
            inserted += 1

    print(f"\nMock mode complete. Inserted: {inserted}, Skipped (duplicate): {skipped}")
    return inserted

# ── YouTube Fetcher (Enhanced for Primary Source) ────────────────────────────
def fetch_youtube_comments(supabase: Client, limit: int = 80) -> int:
    """
    Fetch LGU-related comments from YouTube videos.
    Enhanced to collect more data since it's now the primary source.
    """
    if not YOUTUBE_API_KEY:
        print("⚠️ YouTube API key not set — running in mock mode")
        return 0

    print(f"🎬 Fetching from YouTube (PRIMARY SOURCE)...")
    print(f"   Target: {limit} comments")
    inserted = 0
    skipped = 0

    try:
        # Use more search queries since YouTube is primary source
        for query in YOUTUBE_SEARCH_QUERIES[:5]:  # Increased from 2 to 5 queries
            print(f"   Searching: '{query}'")

            # Search for videos
            search_url = "https://www.googleapis.com/youtube/v3/search"
            search_params = {
                "part": "id",
                "q": query,
                "type": "video",
                "maxResults": 5,  # 5 videos per query
                "regionCode": "PH",
                "relevanceLanguage": "tl",
                "publishedAfter": CUTOFF_RFC3339,  # last 730 days only
                "key": YOUTUBE_API_KEY
            }

            search_response = requests.get(search_url, params=search_params, timeout=30)
            if search_response.status_code != 200:
                print(f"   ⚠️ Search failed for '{query}': {search_response.status_code}")
                continue

            videos = search_response.json().get("items", [])
            print(f"   Found {len(videos)} videos for '{query}'")

            for video in videos:
                video_id = video["id"]["videoId"]

                # Get comments from video
                comments_url = "https://www.googleapis.com/youtube/v3/commentThreads"
                comments_params = {
                    "part": "snippet",
                    "videoId": video_id,
                    "maxResults": 10,  # Increased from 5 to 10 per video
                    "textFormat": "plainText",
                    "order": "relevance",  # Get most relevant comments
                    "key": YOUTUBE_API_KEY
                }

                comments_response = requests.get(comments_url, params=comments_params, timeout=30)
                if comments_response.status_code != 200:
                    # Comments might be disabled on this video
                    continue

                comment_threads = comments_response.json().get("items", [])

                for thread in comment_threads:
                    comment_snippet = thread["snippet"]["topLevelComment"]["snippet"]
                    comment_text = comment_snippet["textDisplay"]

                    # Skip comments older than 730 days
                    published_at = comment_snippet.get("publishedAt", "")
                    if published_at:
                        comment_date = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
                        if comment_date < CUTOFF_DATE:
                            skipped += 1
                            continue

                    # Filter short comments (less meaningful)
                    if len(comment_text) < 20:
                        continue

                    comment_id = f"youtube_{thread['id']}"

                    if already_exists(supabase, comment_id):
                        skipped += 1
                        continue

                    record = {
                        "comment_id": comment_id,
                        "raw_text": comment_text,
                        "author_hash": hash_id(comment_snippet.get("authorDisplayName", "unknown")),
                        "source_platform": "youtube",
                        "post_id": video_id,
                        "is_processed": False,
                        "fetched_at": datetime.now(timezone.utc).isoformat(),
                    }

                    if insert_comment(supabase, record):
                        inserted += 1
                        if inserted % 10 == 0:  # Progress indicator every 10 comments
                            print(f"   Progress: {inserted} comments collected...")

                    if inserted >= limit:
                        break

                if inserted >= limit:
                    break

            if inserted >= limit:
                break

        print(f"  ✅ YouTube: {inserted} inserted, {skipped} skipped")
        return inserted

    except Exception as e:
        print(f"  ❌ YouTube error: {e}")
        return 0

# ── Facebook Fetcher (Ready for Future Use) ──────────────────────────────────
def fetch_page_posts(page_id: str, token: str) -> list[dict]:
    """Fetch the 10 most recent posts from the page."""
    url = f"{FB_BASE_URL}/{page_id}/posts"
    params = {
        "access_token": token,
        "fields":       "id,message,created_time",
        "limit":        10,
    }
    res = requests.get(url, params=params, timeout=30)
    res.raise_for_status()
    return res.json().get("data", [])

def fetch_post_comments(post_id: str, token: str) -> list[dict]:
    """Fetch comments for a single post."""
    url = f"{FB_BASE_URL}/{post_id}/comments"
    params = {
        "access_token": token,
        "fields":       "id,message,from,created_time",
        "limit":        100,
        "filter":       "stream",
    }
    res = requests.get(url, params=params, timeout=30)
    res.raise_for_status()
    return res.json().get("data", [])

def fetch_facebook_comments(supabase: Client, limit: int = 20) -> int:
    """Fetch comments from Facebook Page (when LGU approves)."""
    if not FB_TOKEN or not FB_PAGE_ID:
        print("⚠️ Facebook credentials not set — skipping Facebook collection")
        print("   (Will be enabled when Pulilan LGU grants API access)")
        return 0

    print(f"📘 Fetching from Facebook page: {FB_PAGE_ID}")
    inserted = 0
    skipped  = 0
    errors   = 0

    try:
        posts = fetch_page_posts(FB_PAGE_ID, FB_TOKEN)
        print(f"  Found {len(posts)} recent posts.")

        for post in posts:
            # Skip posts older than 730 days
            post_time = post.get("created_time", "")
            if post_time:
                post_date = datetime.fromisoformat(post_time.replace("Z", "+00:00"))
                if post_date < CUTOFF_DATE:
                    continue

            post_id = post["id"]

            try:
                comments = fetch_post_comments(post_id, FB_TOKEN)
            except requests.HTTPError as e:
                print(f"  HTTP error fetching comments for {post_id}: {e}")
                errors += 1
                continue

            for comment in comments:
                comment_id = comment.get("id", "")
                raw_text   = comment.get("message", "").strip()
                author_id  = comment.get("from", {}).get("id", "anonymous")

                # Skip comments older than 730 days
                comment_time = comment.get("created_time", "")
                if comment_time:
                    comment_date = datetime.fromisoformat(comment_time.replace("Z", "+00:00"))
                    if comment_date < CUTOFF_DATE:
                        skipped += 1
                        continue

                if not raw_text:
                    skipped += 1
                    continue

                if already_exists(supabase, f"facebook_{comment_id}"):
                    skipped += 1
                    continue

                record = {
                    "comment_id":      f"facebook_{comment_id}",
                    "raw_text":        raw_text,
                    "author_hash":     hash_id(author_id),
                    "source_platform": "facebook",
                    "post_id":         post_id,
                    "is_processed":    False,
                    "fetched_at":      datetime.now(timezone.utc).isoformat(),
                }
                if insert_comment(supabase, record):
                    inserted += 1
                    print(f"  Inserted Facebook: facebook_{comment_id}")
                else:
                    errors += 1

                if inserted >= limit:
                    break

            if inserted >= limit:
                break

        print(f"  ✅ Facebook: {inserted} inserted, {skipped} skipped, {errors} errors")
        return inserted

    except Exception as e:
        print(f"  ❌ Facebook error: {e}")
        return 0

# ── Edge Function Trigger ─────────────────────────────────────────────────────
def trigger_edge_function():
    """Trigger the process-comment Edge Function."""
    if not EDGE_FUNCTION_URL or not SUPABASE_KEY:
        print("⚠️ Edge Function URL not set — skipping trigger")
        return

    print(f"\n🚀 Triggering Edge Function for processing...")

    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }

    try:
        response = requests.post(EDGE_FUNCTION_URL, headers=headers, json={}, timeout=60)

        if response.status_code == 200:
            result = response.json()
            print(f"  ✅ Processed: {result.get('processed', 0)}")
            print(f"  ✅ Flagged: {result.get('flagged', 0)}")
            if result.get('errors', 0) > 0:
                print(f"  ⚠️ Errors: {result.get('errors', 0)}")
        else:
            print(f"  ❌ Edge Function failed: {response.status_code}")

    except Exception as e:
        print(f"  ❌ Edge Function trigger error: {e}")

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("="*70)
    print("CivicPulseEngine — YouTube-Primary Comment Fetcher")
    print("="*70)

    supabase = get_supabase()
    total_inserted = 0

    # Check if we have YouTube API key
    if not YOUTUBE_API_KEY:
        # Mock mode - no API key available
        print("\n🔧 Running in MOCK MODE (set YOUTUBE_API_KEY for live data)\n")
        total_inserted = run_mock_mode(supabase)
    else:
        # Live mode - use YouTube as primary source
        print("\n🌐 LIVE MODE — Collecting from YouTube\n")

        # YouTube is now PRIMARY source (80 comments per run)
        youtube_count = fetch_youtube_comments(supabase, MAX_YOUTUBE_COMMENTS)
        total_inserted += youtube_count

        # Facebook (if/when available - 20 comments per run)
        facebook_count = fetch_facebook_comments(supabase, MAX_FB_COMMENTS)
        total_inserted += facebook_count

        print(f"\n📊 Collection Summary:")
        print(f"   YouTube: {youtube_count} comments")
        print(f"   Facebook: {facebook_count} comments")
        print(f"   TOTAL: {total_inserted} comments")

    # Trigger processing if we inserted anything
    if total_inserted > 0:
        trigger_edge_function()
    else:
        print("\n⚠️ No new comments inserted — skipping Edge Function trigger")

    print("="*70)
    print("✅ Complete")
    print("="*70)
