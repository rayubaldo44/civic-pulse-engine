-- 008_create_review_records.sql
-- Creates the review_records table for human audit trail of flagged claim decisions.
-- Referenced in schema.sql but never migrated — this fixes verified accuracy being zero.

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

-- RLS: authenticated users can read review records; only the reviewer can insert their own.
ALTER TABLE public.review_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read review records"
    ON public.review_records
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Reviewers can insert their own records"
    ON public.review_records
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = reviewed_by);
