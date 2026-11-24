# scripts/eval_retrieval.py
#
# Civic Pulse Engine — Retrieval Evaluation Harness
#
# Runs the manual claim→evidence test set (docs/RAG_CHUNKING_PLAN.md §8) against
# the live knowledge base and writes a markdown report to
# docs/retrieval-eval-results.md.
#
# For each claim pair in tests/fixtures/claim-evidence-pairs.json this script:
#   1. Embeds the claim via the HF Space /embed endpoint (same vector space as
#      the corpus — 768-dim, validated defensively).
#   2. Calls match_document_chunks (chunk-level retrieval) for each sweep
#      threshold and classifies the top-k against the expected evidence:
#        doc hit    — a returned chunk belongs to the expected document
#                      (document_type + title substring)
#        section hit — a returned chunk ALSO contains a section_signature
#                      phrase → the exact evidence region, not just the doc.
#   3. Calls the legacy match_lgu_documents RPC (whole-doc baseline, 0.3/3) so
#      the chunk-level numbers can be compared against the previous pipeline.
#      The whole-doc path only supports doc-level hits (chunks are the granular
#      evidence unit since the 006 migration).
#
# The 0.4 match_threshold in the Edge Function was chosen without empirical
# tuning; the threshold sweep below gives the real numbers to lock it in
# (plan §8 / Decision Summary).
#
# Usage:
#   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... HF_SPACE_URL=... \
#     python3 scripts/eval_retrieval.py [--threshold 0.2,0.3,0.4,0.5] \
#                                       [--top-k 5] [--fixture tests/fixtures/claim-evidence-pairs.json]
#
# Not part of CI — requires a live Supabase DB (migration 006 applied +
# chunks backfilled) and reachable HF Space.

import os
import sys
import json
import argparse
from datetime import datetime, timezone

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
HF_SPACE_URL = os.environ.get("HF_SPACE_URL", "")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

DEFAULT_FIXTURE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "tests",
    "fixtures",
    "claim-evidence-pairs.json",
)
DEFAULT_REPORT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "docs",
    "retrieval-eval-results.md",
)

REQUEST_TIMEOUT = 60

# Legacy whole-doc baseline parameters — matches the old process-comment RPC
# call (match_threshold 0.3, match_count 3) so the delta is apples-to-apples.
BASELINE_THRESHOLD = 0.3
BASELINE_COUNT = 3


# ── HTTP helpers ──────────────────────────────────────────────────────────────
def rest_json(method, path, json_body=None):
    url = f"{SUPABASE_URL}{path}"
    res = requests.request(method, url, headers=HEADERS, json=json_body, timeout=REQUEST_TIMEOUT)
    return res


def call_rpc(fn, body):
    """POST to a PostgREST RPC endpoint. Returns (payload, error_code)."""
    res = rest_json("POST", f"/rest/v1/rpc/{fn}", json_body=body)
    if not res.ok:
        try:
            err = res.json().get("code") or res.json().get("message") or res.text[:200]
        except ValueError:
            err = res.text[:200]
        return None, err
    return res.json(), None


def call_embed(text):
    res = requests.post(
        f"{HF_SPACE_URL}/embed",
        json={"text": text},
        headers={"Content-Type": "application/json"},
        timeout=REQUEST_TIMEOUT,
    )
    if not res.ok:
        raise RuntimeError(f"Embed API error {res.status_code}: {res.text[:200]}")
    data = res.json()
    embedding = data.get("embedding")
    if not isinstance(embedding, list) or len(embedding) != 768:
        raise RuntimeError(
            "Embed API returned an unexpected vector shape "
            f"(got {len(embedding) if isinstance(embedding, list) else '?'}, expected 768)"
        )
    return embedding


# ── Classification ────────────────────────────────────────────────────────────
def doc_matches(row, pair):
    """True if the row's document is the expected one (type + title substring)."""
    doc_type = row.get("document_type")
    if doc_type is not None and str(doc_type).lower() != pair["expected_document_type"].lower():
        return False
    title = (row.get("title") or "").lower()
    titles = pair.get("expected_title") or []
    return not titles or any(s.lower() in title for s in titles)


def section_matches(row, pair):
    """True if doc matches AND chunk text/label contains an evidence phrase."""
    if not doc_matches(row, pair):
        return False
    signatures = pair.get("section_signature") or []
    if not signatures:
        return True  # doc-level evidence is the best the fixture can specify
    haystack = (
        f"{row.get('chunk_text') or ''} {row.get('section_label') or ''} "
        f"{row.get('content') or ''}"
    ).lower()
    return any(s.lower() in haystack for s in signatures)


def classify_rows(rows, pair, top_k):
    """Classify a ranked result list. Returns a dict of hit booleans."""
    top1 = rows[0] if rows else None
    top5 = rows[:top_k]
    return {
        "ranked": len(rows),
        "doc_top1": bool(top1) and doc_matches(top1, pair),
        "doc_top5": any(doc_matches(r, pair) for r in top5),
        "section_top1": bool(top1) and section_matches(top1, pair),
        "section_top5": any(section_matches(r, pair) for r in top5),
        "best_similarity": (top1.get("similarity") if top1 else None),
        "top1_similarity": (top1.get("similarity") if top1 else None),
        "retrieved_titles": sorted({str(r.get("title")) for r in rows}),
    }


# ── Report rendering ──────────────────────────────────────────────────────────
def fmt_pct(n, d):
    return f"{100.0 * n / d:.0f}%" if d else "n/a"


def fmt_sim(v):
    return f"{v:.4f}" if v is not None else "n/a"


def build_report(args, corpus, threshold_results, baseline_results, by_pair, pair_count):
    lines = []
    lines.append("# Retrieval Evaluation — Claim→Evidence Test Set\n")
    lines.append(
        f"- Run date (UTC): {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n"
    )
    lines.append(
        f"- Corpus: **{corpus['documents']}** active documents, **{corpus['chunks']}** chunks "
        f"(migration 006 applied + backfilled)\n"
    )
    lines.append(
        f"- Claim pairs: **{pair_count}** — fixture "
        f"`tests/fixtures/claim-evidence-pairs.json`\n"
    )
    lines.append(
        f"- Evidenced in corpus: **{corpus.get('evidenced')}** · "
        f"unavailable (gap): **{corpus.get('gaps')}** — gap pairs are excluded from "
        f"recall (their evidence document does not exist in the KB yet).\n"
    )
    lines.append("- Retrieval: `match_document_chunks` (chunk-level)\n")
    lines.append(
        f"- Baseline: `match_lgu_documents` (whole-doc, threshold {BASELINE_THRESHOLD}, "
        f"count {BASELINE_COUNT})\n"
    )
    lines.append(
        "- Scoring: a **doc hit** requires the expected document_type (+ title substring); "
        "a **section hit** additionally requires a `section_signature` phrase inside the "
        "matched chunk text/label.\n"
    )
    lines.append(
        f"- Produced by `scripts/eval_retrieval.py` — rerun the script to refresh; "
        f"tune `expected_title`/`section_signature` in the fixture to live document wording.\n"
    )

    lines.append("\n## Threshold sweep (top-1 / top-5 recall)\n")
    lines.append("| Threshold | section top-1 | section top-5 | doc top-5 | no-evidence pairs | avg top-1 sim |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    best = None
    for t in sorted(threshold_results.keys(), key=float):
        res = threshold_results[t]
        lines.append(
            f"| {t} | {fmt_pct(res['section_top1'], res['pairs'])} "
            f"| {fmt_pct(res['section_top5'], res['pairs'])} "
            f"| {fmt_pct(res['doc_top5'], res['pairs'])} "
            f"| {res['no_evidence']} | {fmt_sim(res['avg_top1_sim'])} |"
        )
        # Prefer the higher threshold on equal recall: fewer low-similarity
        # chunks are passed to the LLM (cheaper, fewer spurious matches).
        if best is None or res["section_top5"] > threshold_results[best]["section_top5"] or (
            res["section_top5"] == threshold_results[best]["section_top5"]
            and float(t) > float(best)
        ):
            best = t
    if best is None:
        best = sorted(threshold_results.keys(), key=float)[0]
    proposed = args.proposed
    recommended = best
    if recommended == proposed:
        note = f"- **Recommended threshold:** `{proposed}` (matches the proposed value).\n"
    else:
        note = (
            f"- **Recommended threshold:** `{recommended}` (highest section top-5 recall; "
            f"proposed `{proposed}`).\n"
        )
    lines.append(note)

    lines.append("\n## Chunk retrieval vs whole-doc baseline\n")
    lines.append("| | Chunk (recommended) | Whole-doc baseline |")
    lines.append("| --- | --- | --- |")
    rec = threshold_results[recommended]
    baseline_doc_recall = (
        fmt_pct(baseline_results["doc_top5"], baseline_results["pairs"])
        if baseline_results["doc_top5"] is not None
        else "n/a (RPC missing)"
    )
    baseline_sim = (
        f"{baseline_results['avg_top1_sim']:.4f}"
        if baseline_results["avg_top1_sim"] is not None
        else "n/a"
    )
    lines.append(f"| doc-top-5 recall | {fmt_pct(rec['doc_top5'], rec['pairs'])} | {baseline_doc_recall} |")
    lines.append(f"| docs retrieved (unique) | {rec['docs_retrieved']} | {baseline_results['docs_retrieved']} |")
    lines.append(f"| avg top-1 similarity | {fmt_sim(rec['avg_top1_sim'])} | {baseline_sim} |")
    if baseline_results["avg_top1_sim"] is None:
        lines.append("| | | (_baseline RPC unavailable — legacy path likely dropped_) |")
    lines.append("")

    lines.append(f"\n## Per-pair detail (threshold `{proposed}`)\n")
    lines.append("| Pair | Claim | doc top-1 | section top-1 | section top-5 | best sim | retrieved documents |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- |")
    for pair_id, info in sorted(by_pair.items()):
        c = info["proposed"]
        claim = info["claim"].replace("|", "\\|")
        retrieved = ", ".join(c["retrieved_titles"]) or "—"
        best_sim = f"{c['best_similarity']:.4f}" if c["best_similarity"] is not None else "n/a"
        gap_marker = " ⛔" if info.get("gap") else ""
        lines.append(
            f"| {pair_id}{gap_marker} | {claim} | {'✓' if c['doc_top1'] else '✗'} | "
            f"{'✓' if c['section_top1'] else '✗'} | {'✓' if c['section_top5'] else '✗'} | "
            f"{best_sim} | {retrieved} |"
        )
    lines.append("\n_⛔ = provision unavailable in the current corpus (excluded from recall)._")
    lines.append("\n## Notes\n")
    lines.append(
        "- Misses may be genuine retrieval failures OR fixture signatures that do not match the "
        "live document wording — inspect the `retrieved documents` column and the corpus before "
        "judging.\n"
    )
    lines.append(
        "- This is the evidence set referenced by the manual validation in "
        "`docs/RAG_CHUNKING_PLAN.md` §8; lock `MATCH_THRESHOLD` in "
        "`supabase/functions/process-comment/index.ts` to the recommended value after review.\n"
    )
    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Evaluate chunk-level retrieval against the claim→evidence test set"
    )
    parser.add_argument(
        "--threshold",
        type=str,
        default="0.3,0.4,0.5",
        help="comma-separated thresholds to sweep (default 0.3,0.4,0.5)",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=5,
        help="number of chunks to retrieve per query (default 5)",
    )
    parser.add_argument("--fixture", type=str, default=DEFAULT_FIXTURE)
    parser.add_argument("--report", type=str, default=DEFAULT_REPORT)
    args = parser.parse_args()

    proposed = "0.4"
    args.proposed = proposed
    thresholds = [t.strip() for t in args.threshold.split(",") if t.strip()]
    if proposed not in thresholds:
        thresholds.append(proposed)

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
        print(f"Error: missing required environment variables: {', '.join(_missing)}", file=sys.stderr)
        sys.exit(1)

    with open(args.fixture, "r", encoding="utf-8") as f:
        fixture = json.load(f)
    pairs = fixture["pairs"]
    evidenced = [p for p in pairs if p.get("evidence_in_corpus", True)]
    gaps = [p for p in pairs if not p.get("evidence_in_corpus", True)]
    print(
        f"=== Retrieval Evaluation ({len(pairs)} claims, {len(evidenced)} evidenced, "
        f"{len(gaps)} corpus gaps, thresholds {args.threshold}) ==="
    )

    # Corpus stats
    doc_res = rest_json("GET", "/rest/v1/lgu_documents?select=id&is_active=eq.true")
    doc_res.raise_for_status()
    chunk_res = rest_json("GET", "/rest/v1/document_chunks?select=id")
    chunk_res.raise_for_status()
    corpus = {
        "documents": len(doc_res.json()),
        "chunks": len(chunk_res.json()),
        "evidenced": len(evidenced),
        "gaps": len(gaps),
    }

    # Embeds (once per claim)
    claims = []
    print("\nEmbedding claims…")
    for pair in pairs:
        embedding = call_embed(pair["claim"])
        claims.append((pair, embedding))
        print(f"  {pair['id']}: embedded ({len(embedding)} dims)")
    print(f"Corpus: {corpus['documents']} docs, {corpus['chunks']} chunks\n")

    baseline_results = {
        "pairs": len(evidenced),
        "doc_top5": 0,
        "docs_retrieved": 0,
        "avg_top1_sim": None,
        "available": True,
    }
    baseline_sims = []
    baseline_retrieved = set()

    threshold_results = {}
    by_pair = {}

    # Baseline (whole-doc) first — it may be missing if the legacy path was dropped.
    print("Running whole-doc baseline (match_lgu_documents)…")
    for pair, embedding in claims:
        rows, err = call_rpc(
            "match_lgu_documents",
            {"query_embedding": embedding, "match_threshold": BASELINE_THRESHOLD, "match_count": BASELINE_COUNT},
        )
        if err is not None:
            print(f"  {pair['id']}: baseline unavailable ({err})")
            baseline_results["available"] = False
            baseline_results["doc_top5"] = None
            break
        if not pair.get("evidence_in_corpus", True):
            continue  # gaps don't contribute to baseline recall either
        rows = rows or []
        cls = classify_rows(rows, pair, BASELINE_COUNT)
        if cls["doc_top5"]:
            baseline_results["doc_top5"] += 1
        if cls["top1_similarity"] is not None:
            baseline_sims.append(cls["top1_similarity"])
        for title in cls["retrieved_titles"]:
            baseline_retrieved.add(title)
    if baseline_results["available"]:
        baseline_results["avg_top1_sim"] = (sum(baseline_sims) / len(baseline_sims)) if baseline_sims else None
        baseline_results["docs_retrieved"] = len(baseline_retrieved)

    # Chunk-level sweep
    print("Running chunk-level sweep…")
    for t in thresholds:
        agg = {
            "pairs": len(evidenced),
            "section_top1": 0,
            "section_top5": 0,
            "doc_top5": 0,
            "no_evidence": 0,
            "avg_top1_sim": None,
            "docs_retrieved": 0,
        }
        sims = []
        retrieved = set()
        for pair, embedding in claims:
            rows, err = call_rpc(
                "match_document_chunks",
                {"query_embedding": embedding, "match_threshold": float(t), "match_count": args.top_k},
            )
            if err is not None:
                print(f"  ERROR match_document_chunks threshold {t} pair {pair['id']}: {err}", file=sys.stderr)
                sys.exit(1)
            rows = rows or []
            cls = classify_rows(rows, pair, args.top_k)
            is_evidenced = pair.get("evidence_in_corpus", True)
            if is_evidenced:
                if not rows:
                    agg["no_evidence"] += 1
                agg["section_top1"] += 1 if cls["section_top1"] else 0
                agg["section_top5"] += 1 if cls["section_top5"] else 0
                agg["doc_top5"] += 1 if cls["doc_top5"] else 0
                if cls["top1_similarity"] is not None:
                    sims.append(cls["top1_similarity"])
                for title in cls["retrieved_titles"]:
                    retrieved.add(title)
            if t == proposed:
                by_pair[pair["id"]] = {
                    "claim": pair["claim"],
                    "proposed": cls,
                    "gap": not is_evidenced,
                }
            if is_evidenced:
                print(f"  t={t} {pair['id']}: section_top5={'✓' if cls['section_top5'] else '✗'} ({cls['ranked']} chunks)")
        agg["avg_top1_sim"] = (sum(sims) / len(sims)) if sims else None
        agg["docs_retrieved"] = len(retrieved)
        threshold_results[t] = agg
        agg["avg_top1_sim"] = (sum(sims) / len(sims)) if sims else None
        agg["docs_retrieved"] = len(retrieved)
        threshold_results[t] = agg

    report = build_report(args, corpus, threshold_results, baseline_results, by_pair, len(pairs))
    with open(args.report, "w", encoding="utf-8") as f:
        f.write(report + "\n")
    print(f"\nReport written to {args.report}")


if __name__ == "__main__":
    main()
