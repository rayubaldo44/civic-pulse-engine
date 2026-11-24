-- =============================================================================
-- 006_rag_chunking.sql
-- Paragraph-level RAG chunking — document_chunks store + chunk retrieval RPC
-- =============================================================================
-- Implements the design in docs/RAG_CHUNKING_PLAN.md ("Proposed" → applied).
--
-- Additive + non-breaking (per plan §7 step 1): the existing
-- lgu_documents.embedding and match_lgu_documents RPC remain intact so current
-- retrieval keeps working during migration. Cleanup (dropping the old whole-doc
-- path) is a separate follow-up after verification.
--
-- Changes here:
--   1. document_chunks table + indexes (pgvector hnsw, cosine)
--   2. RLS on document_chunks — authenticated SELECT only; ALL writes flow
--      through service-role contexts (Edge Function + backfill script). This
--      write-gate blocks any authenticated user from posting poisoned
--      embeddings that would sabotage retrieval (plan §3 security flag).
--   3. flagged_claims.matched_chunk_id FK (ON DELETE SET NULL) so a claim can
--      link to the exact evidence chunk without losing historical rows.
--   4. lgu_documents.document_type CHECK extended with Executive Order,
--      Project Plan, Fiesta Schedule (plan §1 type-gap).
--   5. match_document_chunks RPC — chunk-level cosine search inner-joined to
--      lgu_documents filtered on is_active = true (plan §5).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. document_chunks table
-- ---------------------------------------------------------------------------
-- Ensure the pgvector extension is available (idempotent). It is normally
-- already enabled — lgu_documents.embedding is a vector(768) column — but this
-- makes the migration self-contained.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.document_chunks (
    id            uuid primary key default gen_random_uuid(),
    document_id   uuid not null references public.lgu_documents(id) on delete cascade,
    chunk_index   int  not null,                 -- 0-based order within the doc
    chunk_text    text not null,                 -- raw chunk text (LLM evidence + display)
    section_label text,                          -- "Section 3.", heading text, etc. (nullable)
    token_count   int  not null default 0,
    embedding     vector(768) not null,          -- pgvector, same model/dims as lgu_documents.embedding
    created_at    timestamptz not null default now(),
    unique (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx
    ON public.document_chunks (document_id);

-- hnsw cosine — matches existing cosine behavior. Preferred over ivfflat on
-- Postgres 17 at prototype scale (no lists tuning, stronger recall, no
-- ivfflat degradation on small tables).
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
    ON public.document_chunks
    USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- 2. RLS on document_chunks — read-only for authenticated, service-role writes
-- ---------------------------------------------------------------------------
-- Security model (matched to plan §3):
--   * authenticated users may SELECT chunks (reference-docs UI, evidence view)
--   * NO INSERT/UPDATE/DELETE policy for authenticated → any write attempt via
--     PostgREST is denied.
--   * Writes flow exclusively through service-role contexts (the process-comment
--     Edge Function and scripts/backfill_chunks.py), which bypass RLS
--     (FORCE ROW LEVEL SECURITY is NOT set, per the established repo pattern).
--   * Rationale: without this gate, any authenticated user could POST arbitrary
--     document_chunks rows with a poisoned embedding and corrupt retrieval for
--     all claims.
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_chunks_select ON public.document_chunks;
CREATE POLICY document_chunks_select
    ON public.document_chunks FOR SELECT
    TO authenticated
    USING (true);

-- ---------------------------------------------------------------------------
-- 3. flagged_claims.matched_chunk_id — evidence-chunk link
-- ---------------------------------------------------------------------------
-- Keeps the existing matched_document_id FK (used by the reference-docs join on
-- the flagged-claims page) and adds a nullable pointer to the specific chunk.
-- ON DELETE SET NULL ensures a deleted chunk never cascades away historical
-- claim rows nor blocks review_records.
ALTER TABLE public.flagged_claims
    ADD COLUMN IF NOT EXISTS matched_chunk_id uuid
        REFERENCES public.document_chunks(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 4. Extend lgu_documents.document_type CHECK (plan §1 type-gap)
-- ---------------------------------------------------------------------------
-- Adds Executive Order, Project Plan, Fiesta Schedule so each maps to a
-- sensible chunking structure rule and the Reference Docs UI exposes them.
-- Must be kept in sync with DOCUMENT_TYPES in
-- src/routes/Authenticated/reference-docs/+page.server.ts.
DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'public.lgu_documents'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%document_type%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.lgu_documents DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

ALTER TABLE public.lgu_documents
    ADD CONSTRAINT lgu_documents_document_type_check
    CHECK (
        document_type = ANY (ARRAY[
            'Ordinance'::text,
            'Resolution'::text,
            'Advisory'::text,
            'Health Protocol'::text,
            'Infrastructure Report'::text,
            'Budget Report'::text,
            'Press Release'::text,
            'Waste Management Plan'::text,
            'Public Safety Report'::text,
            'Executive Order'::text,
            'Project Plan'::text,
            'Fiesta Schedule'::text,
            'Other'::text
        ])
    );

-- ---------------------------------------------------------------------------
-- 5. match_document_chunks RPC — chunk-level retrieval (plan §5)
-- ---------------------------------------------------------------------------
-- Cosine similarity (<=>) over document_chunks, inner-joined to lgu_documents
-- and filtered to active docs, ordered by similarity desc, limited to
-- match_count. Returns chunk + joined doc metadata for the LLM prompt.
CREATE OR REPLACE FUNCTION public.match_document_chunks(
    query_embedding vector(768),
    match_threshold double precision,
    match_count integer
)
RETURNS TABLE (
    chunk_id      uuid,
    document_id   uuid,
    chunk_index   int,
    chunk_text    text,
    section_label text,
    title         text,
    document_type text,
    uploaded_at   timestamptz,
    similarity    double precision
)
LANGUAGE sql STABLE
-- STABLE + SECURITY INVOKER: runs with the caller's privileges. The RLS
-- policies already grant authenticated SELECT on document_chunks and
-- lgu_documents, so no separate policy is needed for the RPC.
AS $$
    SELECT
        dc.id,
        dc.document_id,
        dc.chunk_index,
        dc.chunk_text,
        dc.section_label,
        ld.title,
        ld.document_type,
        ld.uploaded_at,
        1 - (dc.embedding <=> query_embedding) AS similarity
    FROM public.document_chunks dc
    INNER JOIN public.lgu_documents ld ON ld.id = dc.document_id
    WHERE ld.is_active = true
      AND 1 - (dc.embedding <=> query_embedding) > match_threshold
    ORDER BY dc.embedding <=> query_embedding ASC
    LIMIT match_count;
$$;
