import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import { csvCell } from '$lib/server/csv';

export const GET: RequestHandler = async ({ locals: { safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const supabase = getServiceSupabase();

	const { data } = await supabase
		.from('flagged_claims')
		.select(
			`
			id,
			claim_text,
			rag_determination,
			rag_evidence_snippet,
			status,
			source_platform,
			created_at,
			processed_content!processed_content_id (sentiment_label, topic_label)
		`
		)
		.order('created_at', { ascending: false });

	const header = [
		'ID',
		'Claim',
		'RAG Determination',
		'Evidence Snippet',
		'Status',
		'Sentiment',
		'Topic',
		'Platform',
		'Created At'
	];

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const rows = (data ?? []).map((r: any) => [
		r.id,
		r.claim_text,
		r.rag_determination,
		r.rag_evidence_snippet,
		r.status,
		r.processed_content?.sentiment_label ?? '',
		r.processed_content?.topic_label ?? '',
		r.source_platform ?? '',
		r.created_at
	]);

	const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');

	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="flagged-claims-${Date.now()}.csv"`
		}
	});
};
