import { getServiceSupabase } from '$lib/server/supabase';
import { getPagination } from '$lib/utils/pagination';

export type ClaimStatus = 'Pending' | 'Verified True' | 'Verified False' | 'Inconclusive';
export interface ClaimListItem {
	id: string;
	claim_text: string;
	rag_determination: string | null;
	rag_evidence_snippet: string | null;
	status: ClaimStatus;
	source_platform: string | null;
	language: string | null;
	created_at: string;
	processed_content: {
		cleaned_text: string | null;
		sentiment_label: string | null;
		topic_label: string | null;
	} | null;
	lgu_documents: { title: string | null; document_type: string | null } | null;
	linked_issue: { id: string; title: string; status: string } | null;
}
interface ClaimsResult {
	items: ClaimListItem[];
	total: number;
	counts: Record<ClaimStatus, number>;
}
const STATUSES = new Set<ClaimStatus>([
	'Pending',
	'Verified True',
	'Verified False',
	'Inconclusive'
]);

export async function listClaimsPage(params: URLSearchParams, archive: boolean) {
	const { page, pageSize } = getPagination(params);
	const rawStatus = params.get('status') as ClaimStatus | null;
	const status =
		rawStatus && STATUSES.has(rawStatus) && (!archive || rawStatus !== 'Pending')
			? rawStatus
			: null;
	const q = (params.get('q') ?? '').trim();
	const { data, error } = await (getServiceSupabase().rpc as any)('get_claims_page', {
		p_archive: archive,
		p_page: page,
		p_search: q,
		p_status: status
	});
	if (error) throw error;
	if (!data) throw new Error('Claims query returned no result');
	const result = data as unknown as ClaimsResult;
	return { ...result, page, pageSize, q, status: status ?? 'all' };
}
