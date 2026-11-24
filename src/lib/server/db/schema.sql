-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.flagged_claims (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    processed_content_id uuid NOT NULL,
    matched_document_id uuid,
    matched_chunk_id uuid,
    claim_text text NOT NULL,
    similarity_score double precision,
    rag_determination text CHECK (rag_determination = ANY (ARRAY['Supported'::text, 'Refuted'::text, 'Insufficient Evidence'::text])),
    rag_evidence_snippet text,
    status text NOT NULL DEFAULT 'Pending'::text CHECK (status = ANY (ARRAY['Pending'::text, 'Verified False'::text, 'Verified True'::text, 'Inconclusive'::text])),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    matched_patterns ARRAY,
    comment_id text,
    language text,
    source_platform text,
    CONSTRAINT flagged_claims_pkey PRIMARY KEY (id),
    CONSTRAINT flagged_claims_processed_content_id_fkey FOREIGN KEY (processed_content_id) REFERENCES public.processed_content(id),
    CONSTRAINT flagged_claims_matched_document_id_fkey FOREIGN KEY (matched_document_id) REFERENCES public.lgu_documents(id),
    CONSTRAINT flagged_claims_matched_chunk_id_fkey FOREIGN KEY (matched_chunk_id) REFERENCES public.document_chunks(id) ON DELETE SET NULL
);
CREATE TABLE public.lgu_documents (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    uploaded_by uuid,
    document_type text NOT NULL CHECK (document_type = ANY (ARRAY['Ordinance'::text, 'Resolution'::text, 'Advisory'::text, 'Health Protocol'::text, 'Infrastructure Report'::text, 'Budget Report'::text, 'Press Release'::text, 'Waste Management Plan'::text, 'Public Safety Report'::text, 'Executive Order'::text, 'Project Plan'::text, 'Fiesta Schedule'::text, 'Other'::text])),
    title text NOT NULL,
    content text NOT NULL,
    embedding USER-DEFINED,
    uploaded_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT lgu_documents_pkey PRIMARY KEY (id),
    CONSTRAINT lgu_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.document_chunks (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    chunk_text text NOT NULL,
    section_label text,
    token_count integer NOT NULL DEFAULT 0,
    embedding vector(768) NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT document_chunks_pkey PRIMARY KEY (id),
    CONSTRAINT document_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.lgu_documents(id) ON DELETE CASCADE,
    CONSTRAINT document_chunks_document_id_chunk_index_key UNIQUE (document_id, chunk_index)
);
-- Indexes + RLS for document_chunks live in migration
-- supabase/migrations/006_rag_chunking.sql (hnsw cosine index, authenticated
-- SELECT-only RLS, match_document_chunks RPC).
CREATE TABLE public.processed_content (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    raw_content_id uuid NOT NULL,
    content_type text,
    sentiment_label text CHECK (sentiment_label = ANY (ARRAY['positive'::text, 'negative'::text, 'neutral'::text, 'review'::text])),
    sentiment_score double precision,
    topic_label text,
    topic_score double precision,
    is_flagged boolean NOT NULL DEFAULT false,
    processed_at timestamp with time zone NOT NULL DEFAULT now(),
    cleaned_text text,
    language text,
    hashed_user_id text,
    sentiment_needs_review boolean DEFAULT false,
    topic_needs_review boolean DEFAULT false,
    comment_id text,
    CONSTRAINT processed_content_pkey PRIMARY KEY (id),
    CONSTRAINT processed_content_raw_content_id_fkey FOREIGN KEY (raw_content_id) REFERENCES public.raw_content(id)
);
CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    role text NOT NULL DEFAULT 'reviewer'::text CHECK (role = ANY (ARRAY['reviewer'::text, 'admin'::text])),
    CONSTRAINT profiles_pkey PRIMARY KEY (id),
    CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.raw_content (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    source_platform text NOT NULL DEFAULT 'facebook'::text CHECK (source_platform = ANY (ARRAY['facebook'::text, 'youtube'::text])),
    source_page_id text,
    post_id text NOT NULL UNIQUE,
    raw_text text,
    author_hash text,
    created_at timestamp with time zone,
    fetched_at timestamp with time zone NOT NULL DEFAULT now(),
    is_processed boolean DEFAULT false,
    comment_id text UNIQUE,
    reaction_count integer DEFAULT 0,
    reply_count integer DEFAULT 0,
    CONSTRAINT raw_content_pkey PRIMARY KEY (id)
);
CREATE TABLE public.review_records (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    flagged_claim_id uuid NOT NULL,
    reviewed_by uuid NOT NULL,
    decision text NOT NULL CHECK (decision = ANY (ARRAY['Verified False'::text, 'Verified True'::text, 'Inconclusive'::text])),
    notes text,
    reviewed_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT review_records_pkey PRIMARY KEY (id),
    CONSTRAINT review_records_flagged_claim_id_fkey FOREIGN KEY (flagged_claim_id) REFERENCES public.flagged_claims(id),
    CONSTRAINT review_records_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id)
);