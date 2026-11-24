import type { Issue, IssueStatus, Priority } from './issues';
import type { PageResult } from '$lib/utils/pagination';

export const ISSUE_STATUSES: IssueStatus[] = [
	'Open',
	'In Progress',
	'Under Review',
	'Resolved',
	'Closed'
];
export const ISSUE_PRIORITIES: Priority[] = ['Critical', 'High', 'Medium', 'Low'];
export const ISSUE_TOPICS = [
	'Infrastructure',
	'Healthcare',
	'Waste Management',
	'Public Safety',
	'Other'
];
export type IssueSort = 'created_at' | 'title' | 'topic' | 'priority' | 'status';
export interface IssueListQuery {
	page: number;
	statuses: IssueStatus[];
	priorities: Priority[];
	topics: string[];
	q: string;
	sort: IssueSort;
	direction: 'asc' | 'desc';
	scope: 'all' | 'mine' | 'reviews';
}
export interface IssuePage extends PageResult<Issue> {
	counts: { open: number; mine: number; critical: number };
}
export type IssueColumns = Record<IssueStatus, IssuePage>;

export function issueQueryParams(query: IssueListQuery): URLSearchParams {
	const params = new URLSearchParams({
		page: String(query.page),
		sort: query.sort,
		direction: query.direction,
		scope: query.scope
	});
	if (query.q) params.set('q', query.q);
	query.statuses.forEach((s) => params.append('status', s));
	query.priorities.forEach((p) => params.append('priority', p));
	query.topics.forEach((t) => params.append('topic', t));
	return params;
}

/** An excluded board column is empty while its header counts remain global. */
export function emptyIssuePage(counts: IssuePage['counts']): IssuePage {
	return { items: [], total: 0, page: 1, pageSize: 25, counts };
}
