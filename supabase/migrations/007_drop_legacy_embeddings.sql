-- =============================================================================
-- 007_drop_legacy_embeddings.sql
-- Cleanup per docs/RAG_CHUNKING_PLAN.md §7 step 5.
-- =============================================================================
-- Run ONLY after chunk-level retrieval is verified:
--   1. scripts/eval_retrieval.py against the live corpus (results recorded in
--      docs/retrieval-eval-results.md — 4/4 evidenced pairs at threshold 0.4),
--   2. process-comment + compute-issue-priority redeployed with the locked
--      MATCH_THRESHOLD, and
--   3. a post-deploy sanity check of newly flagged claims.
--
-- Drops the legacy whole-doc retrieval path that 006 kept intact for the
-- migration window:
--     * match_lgu_documents RPC
--     * lgu_documents.embedding (vector(768) column; dropping it also removes
--       any dependent index)
-- document_chunks is now the sole retrieval store; the eval harness
-- (scripts/eval_retrieval.py) reports the baseline as "n/a (RPC missing)" if
-- this migration runs before it.
--
-- NOTE: scripts/embed_documents.py (one-time whole-doc embedder) writes the
-- dropped column and is therefore obsolete after this migration — superseded
-- by chunk_documents.py + backfill_chunks.py. Delete it when convenient.
--
-- Recoverable in place: the column + RPC can be re-created from the 006-era
-- schema if ever needed.
-- =============================================================================

DROP FUNCTION IF EXISTS public.match_lgu_documents(vector, double precision, integer);

ALTER TABLE public.lgu_documents
    DROP COLUMN IF EXISTS embedding;

-- ---------------------------------------------------------------------------
-- Post-apply sanity queries
-- ---------------------------------------------------------------------------
-- 1. Whole-doc RPC should be gone:
--    select proname from pg_proc where proname = 'match_lgu_documents';
--    -- expect: 0 rows
--
-- 2. Legacy column should be gone:
--    select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'lgu_documents'
--      and column_name = 'embedding';
--    -- expect: 0 rows
--
-- 3. Chunk store intact:
--    select count(*) from public.document_chunks;
--    -- expect: > 0
--
-- 4. Chunk RPC still resolves:
--    select proname from pg_proc where proname = 'match_document_chunks';
--    -- expect: 1 row