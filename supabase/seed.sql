-- =============================================================================
-- supabase/seed.sql — deterministic baseline data for `supabase db reset`.
-- =============================================================================
-- Kept deliberately small: the test suites re-seed from
-- tests/shared/seed.ts (JS, service-role) so tests control their own fixtures.
-- This file only guarantees the admin-facing singleton rows the bootstrapped
-- app expects so a manual `db reset` yields a non-empty dashboard.

-- system_config singleton (row 1 already inserted by 000_base_tables.sql).
INSERT INTO public.system_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- A couple of NLP categories so the Reference Docs page has options.
INSERT INTO public.nlp_categories (name, description)
SELECT 'Infrastructure', 'Roads, bridges, drainage, streetlights, public works'
WHERE NOT EXISTS (SELECT 1 FROM public.nlp_categories WHERE name = 'Infrastructure');

INSERT INTO public.nlp_categories (name, description)
SELECT 'Healthcare', 'Health centers, medicines, medical services'
WHERE NOT EXISTS (SELECT 1 FROM public.nlp_categories WHERE name = 'Healthcare');

-- One sample LGU document so the Reference Docs library is non-empty.
INSERT INTO public.lgu_documents (title, content, document_type, is_active)
SELECT 'Synthetic collection schedule', 'Fictional test reference: collection in the sample district runs every Friday. This is not an official ordinance.', 'Ordinance', true
WHERE NOT EXISTS (SELECT 1 FROM public.lgu_documents);