-- =============================================================================
-- 000_base_tables.sql
-- Bootstrap migration for the LOCAL test stack.
-- =============================================================================
-- The production project's core tables (profiles, raw_content,
-- processed_content, flagged_claims, lgu_documents) predate this repo's
-- migration history — they were created directly in the Supabase dashboard and
-- managed there. Local `supabase db reset` therefore could not replay the
-- migration chain (001+ reference these tables). This migration reconstructs
-- the pre-repo schema from the app's query surface + the RAG plan, so a fresh
-- local stack is deterministic and reproducible.
--
-- It is idempotent-friendly (CREATE TABLE IF NOT EXISTS / DROP ... IF EXISTS /
-- CREATE OR REPLACE) and mirrors the security model the existing migrations
-- rely on:
--   * writes to raw/processed/flagged/lgu flow through the service role
--     (Edge Functions, ingestion cron, app server) which bypasses RLS;
--   * authenticated users get read access (dashboards) plus the two INSERT
--     paths the app runs with the *user* client: profiles is never inserted
--     here (auth trigger) and lgu_documents has an authenticated INSERT for the
--     Reference Docs upload action.
--
-- NOTE: `add_barangay_mention.sql` (non-numeric filename, skipped by the CLI)
-- is folded into processed_content below. The legacy `add_audit_logs.sql`
-- (also skipped by the CLI) is superseded locally by 011_enhance_audit_logs.sql,
-- which is a strict superset — no separate migration is needed.
-- =============================================================================

-- ── profiles ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
    id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name    text,
    role         text        NOT NULL DEFAULT 'analyst'
                            CHECK (role IN ('analyst', 'admin')),
    password_set boolean     NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Auto-create a profile row on user signup/invite (mirrors the production
-- handle_new_user trigger documented in README.md).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        'analyst'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);

-- ── raw_content ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.raw_content (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id      text,
    raw_text        text        NOT NULL,
    source_platform text,
    post_id         text,
    author_hash     text,
    is_processed    boolean     NOT NULL DEFAULT false,
    fetched_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- engagement counters live here; migration 004 adds them  — kept here too
    -- so a bootstrapped stack is complete even if 004 is skipped.
    reaction_count  integer     NOT NULL DEFAULT 0
                                CHECK (reaction_count >= 0),
    reply_count     integer     NOT NULL DEFAULT 0
                                CHECK (reply_count >= 0)
);

ALTER TABLE public.raw_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select_raw_content ON public.raw_content;
CREATE POLICY auth_select_raw_content
    ON public.raw_content FOR SELECT
    TO authenticated
    USING (true);

-- ── processed_content ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.processed_content (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_content_id         uuid NOT NULL REFERENCES public.raw_content(id) ON DELETE CASCADE,
    content_type           text,
    cleaned_text           text,
    language               text,
    hashed_user_id         text,
    sentiment_label        text CHECK (sentiment_label IN ('positive', 'negative', 'neutral', 'review')),
    sentiment_score        double precision,
    sentiment_needs_review boolean NOT NULL DEFAULT false,
    topic_label            text,
    topic_score            double precision,
    topic_needs_review     boolean NOT NULL DEFAULT false,
    is_flagged             boolean NOT NULL DEFAULT false,
    barangay_mention       text CHECK (
        barangay_mention IS NULL
        OR barangay_mention = ANY (ARRAY[
            'Alagao', 'Aulaga', 'Bagong Buhay', 'Balubad', 'Bambang',
            'Dampol 1st-A', 'Dampol 2nd-A', 'Dampol 2nd-B', 'Dulong Malabon',
            'Inaon', 'Lumbac', 'Lunt', 'Magnificat', 'Marinig',
            'Niugan', 'Poblacion', 'Polo', 'Remlo'
        ])
    ),
    created_at             timestamptz NOT NULL DEFAULT now(),
    processed_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.processed_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select_processed_content ON public.processed_content;
CREATE POLICY auth_select_processed_content
    ON public.processed_content FOR SELECT
    TO authenticated
    USING (true);

-- ── lgu_documents ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lgu_documents (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    title         text        NOT NULL,
    content       text        NOT NULL,
    document_type text,
    is_active     boolean     NOT NULL DEFAULT true,
    uploaded_by   uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
    uploaded_at   timestamptz NOT NULL DEFAULT now()
);
-- document_type CHECK is established by migration 006_rag_chunking.sql.
-- lgu_documents.embedding (vector(768)) + match_lgu_documents were the legacy
-- str; 006 keeps them intact and 007_drop_legacy_embeddings.sql removes them,
-- so this bootstrap omits them entirely.

ALTER TABLE public.lgu_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lgu_documents_select ON public.lgu_documents;
CREATE POLICY lgu_documents_select
    ON public.lgu_documents FOR SELECT
    TO authenticated
    USING (true);

-- The Reference Docs upload action writes through the *user* (not service-role)
-- client — grant authenticated INSERT accordingly.
DROP POLICY IF EXISTS lgu_documents_insert ON public.lgu_documents;
CREATE POLICY lgu_documents_insert
    ON public.lgu_documents FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- ── flagged_claims ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.flagged_claims (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    processed_content_id uuid        REFERENCES public.processed_content(id) ON DELETE SET NULL,
    claim_text           text        NOT NULL,
    matched_patterns     jsonb,
    matched_document_id  uuid        REFERENCES public.lgu_documents(id) ON DELETE SET NULL,
    rag_determination    text,
    rag_evidence_snippet text,
    status               text        NOT NULL DEFAULT 'Pending'
                                    CHECK (status IN ('Pending', 'Verified True', 'Verified False', 'Inconclusive')),
    language             text,
    source_platform      text,
    created_at           timestamptz NOT NULL DEFAULT now()
);
-- matched_chunk_id is added by migration 006_rag_chunking.sql.

ALTER TABLE public.flagged_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flagged_claims_select ON public.flagged_claims;
CREATE POLICY flagged_claims_select
    ON public.flagged_claims FOR SELECT
    TO authenticated
    USING (true);

-- ── nlp_categories ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nlp_categories (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL UNIQUE CHECK (char_length(name) <= 60),
    description text,
    created_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nlp_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nlp_categories_select ON public.nlp_categories;
CREATE POLICY nlp_categories_select
    ON public.nlp_categories FOR SELECT
    TO authenticated
    USING (true);

-- Defense-in-depth: admin-only writes at the DB layer, independent of the
-- app's triple-check in the addCategory action (src/routes/Authenticated/
-- reference-docs/+page.server.ts).
DROP POLICY IF EXISTS nlp_categories_insert_admin ON public.nlp_categories;
CREATE POLICY nlp_categories_insert_admin
    ON public.nlp_categories FOR INSERT
    TO authenticated
    WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS nlp_categories_update_admin ON public.nlp_categories;
CREATE POLICY nlp_categories_update_admin
    ON public.nlp_categories FOR UPDATE
    TO authenticated
    USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
    WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS nlp_categories_delete_admin ON public.nlp_categories;
CREATE POLICY nlp_categories_delete_admin
    ON public.nlp_categories FOR DELETE
    TO authenticated
    USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ── system_config ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_config (
    id                    integer     PRIMARY KEY CHECK (id = 1),
    flagging_sensitivity  integer     NOT NULL DEFAULT 75 CHECK (flagging_sensitivity BETWEEN 0 AND 100),
    codeswitching_model   boolean     NOT NULL DEFAULT true,
    contextual_sentiment  boolean     NOT NULL DEFAULT true,
    spam_filter           boolean     NOT NULL DEFAULT true,
    updated_at            timestamptz,
    updated_by            uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Always guarantee the singleton row the admin page expects.
INSERT INTO public.system_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;