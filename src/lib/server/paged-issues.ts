import { getServiceSupabase } from './supabase';
import { getPagination } from '$lib/utils/pagination';
import {
	ISSUE_STATUSES,
	emptyIssuePage,
	ISSUE_PRIORITIES,
	ISSUE_TOPICS,
	type IssueListQuery,
	type IssuePage,
	type IssueColumns,
	type IssueSort
} from '$lib/types/paged-issues';

export function readIssueQuery(params: URLSearchParams): IssueListQuery {
	const sort = params.get('sort') as IssueSort;
	return {
		page: Math.min(getPagination(params).page, 85899345),
		statuses: ISSUE_STATUSES.filter((s) => params.getAll('status').includes(s)),
		priorities: ISSUE_PRIORITIES.filter((p) => params.getAll('priority').includes(p)),
		topics: ISSUE_TOPICS.filter((t) => params.getAll('topic').includes(t)),
		q: (params.get('q') ?? '').trim(),
		sort: ['created_at', 'title', 'topic', 'priority', 'status'].includes(sort)
			? sort
			: 'created_at',
		direction: params.get('direction') === 'asc' ? 'asc' : 'desc',
		scope:
			params.get('scope') === 'mine'
				? 'mine'
				: params.get('scope') === 'reviews'
					? 'reviews'
					: 'all'
	};
}

export async function listIssuePage(query: IssueListQuery, userId: string): Promise<IssuePage> {
	const { data, error } = await (getServiceSupabase().rpc as any)('get_issue_page', {
		p_user_id: userId,
		p_page: query.page,
		p_statuses: query.statuses,
		p_priorities: query.priorities,
		p_topics: query.topics,
		p_q: query.q,
		p_sort: query.sort,
		p_direction: query.direction,
		p_scope: query.scope
	});
	if (error) throw new Error(error.message);
	if (!data) throw new Error('Issue data is unavailable');
	return data as IssuePage;
}

export async function listIssueBoard(query: IssueListQuery, userId: string): Promise<IssueColumns> {
	const selected = ISSUE_STATUSES.filter(
		(status) => query.statuses.length === 0 || query.statuses.includes(status)
	);
	const entries = await Promise.all(
		selected.map(
			async (status) =>
				[status, await listIssuePage({ ...query, page: 1, statuses: [status] }, userId)] as const
		)
	);
	const loaded = Object.fromEntries(entries) as Partial<IssueColumns>;
	const counts = entries[0][1].counts;
	return Object.fromEntries(
		ISSUE_STATUSES.map((status) => [status, loaded[status] ?? emptyIssuePage(counts)])
	) as IssueColumns;
}
