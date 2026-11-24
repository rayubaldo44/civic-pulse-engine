-- Bounded claims lists: evaluate latest human review/search/order in PostgreSQL,
-- then join the 25 visible records. Only the verified app server may call this.
CREATE OR REPLACE FUNCTION public.get_claims_page(
    p_archive boolean DEFAULT false,
    p_page integer DEFAULT 1,
    p_search text DEFAULT '',
    p_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
    WITH candidates AS MATERIALIZED (
        SELECT fc.id, fc.created_at,
            CASE WHEN p_archive THEN latest.decision ELSE fc.status END AS effective_status
        FROM public.flagged_claims fc
        LEFT JOIN public.processed_content pc ON pc.id = fc.processed_content_id
        LEFT JOIN public.lgu_documents doc ON doc.id = fc.matched_document_id
        LEFT JOIN LATERAL (
            SELECT rr.decision FROM public.review_records rr
            WHERE rr.flagged_claim_id = fc.id
            ORDER BY rr.reviewed_at DESC, rr.id DESC LIMIT 1
        ) latest ON true
        WHERE (NOT p_archive OR latest.decision IS NOT NULL)
          AND (coalesce(trim(p_search), '') = ''
            OR strpos(lower(concat_ws(' ', fc.claim_text, fc.rag_evidence_snippet,
                pc.cleaned_text, doc.title)), lower(trim(p_search))) > 0)
    ), filtered AS MATERIALIZED (
        SELECT * FROM candidates
        WHERE p_status IS NULL OR effective_status = p_status
    ), page_rows AS (
        SELECT * FROM filtered
        ORDER BY CASE WHEN NOT p_archive AND effective_status = 'Pending' THEN 0 ELSE 1 END,
            created_at DESC, id DESC
        LIMIT 25 OFFSET (greatest(coalesce(p_page, 1), 1)::bigint - 1) * 25
    ), items AS (
        SELECT jsonb_build_object(
            'id', fc.id, 'claim_text', fc.claim_text,
            'rag_determination', fc.rag_determination,
            'rag_evidence_snippet', fc.rag_evidence_snippet,
            'status', pr.effective_status, 'source_platform', fc.source_platform,
            'language', fc.language, 'created_at', fc.created_at,
            'processed_content', CASE WHEN pc.id IS NOT NULL THEN jsonb_build_object(
                'cleaned_text', pc.cleaned_text, 'sentiment_label', pc.sentiment_label,
                'topic_label', pc.topic_label) ELSE NULL END,
            'lgu_documents', CASE WHEN doc.id IS NOT NULL THEN jsonb_build_object(
                'title', doc.title, 'document_type', doc.document_type) ELSE NULL END,
            'linked_issue', linked.item
        ) AS item, pr.effective_status, pr.created_at, pr.id
        FROM page_rows pr
        JOIN public.flagged_claims fc ON fc.id = pr.id
        LEFT JOIN public.processed_content pc ON pc.id = fc.processed_content_id
        LEFT JOIN public.lgu_documents doc ON doc.id = fc.matched_document_id
        LEFT JOIN LATERAL (
            SELECT jsonb_build_object('id', ci.id, 'title', ci.title, 'status', ci.status) item
            FROM public.civic_issues ci WHERE ci.source_flagged_claim_id = fc.id
            ORDER BY ci.created_at DESC, ci.id DESC LIMIT 1
        ) linked ON true
    )
    SELECT jsonb_build_object(
        'items', coalesce((SELECT jsonb_agg(item ORDER BY
            CASE WHEN NOT p_archive AND effective_status = 'Pending' THEN 0 ELSE 1 END,
            created_at DESC, id DESC) FROM items), '[]'::jsonb),
        'total', (SELECT count(*) FROM filtered),
        'counts', (SELECT jsonb_build_object(
            'Pending', count(*) FILTER (WHERE effective_status = 'Pending'),
            'Verified True', count(*) FILTER (WHERE effective_status = 'Verified True'),
            'Verified False', count(*) FILTER (WHERE effective_status = 'Verified False'),
            'Inconclusive', count(*) FILTER (WHERE effective_status = 'Inconclusive')
        ) FROM candidates)
    );
$$;
REVOKE ALL ON FUNCTION public.get_claims_page(boolean, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_claims_page(boolean, integer, text, text) TO service_role;
