import { error, redirect } from '@sveltejs/kit';
import { measureServer } from '$lib/server/timing';
import type { PageServerLoad } from './$types';
import { listMyReviewIssueIds, listStaff } from '$lib/server/issues';
import { listIssueBoard, listIssuePage, readIssueQuery } from '$lib/server/paged-issues';

export const load: PageServerLoad = async ({ depends, locals, url }) => {
	depends('issues:list');
	const { user } = await locals.safeGetSession();
	if (!user) redirect(303, '/login');
	const query = readIssueQuery(url.searchParams);
	const view = url.searchParams.get('view') === 'table' ? 'table' : 'board';
	try {
		const [pages, staff, myReviewIssueIds] = await measureServer(locals, 'issues_db', () =>
			Promise.all([
				view === 'board' ? listIssueBoard(query, user.id) : listIssuePage(query, user.id),
				listStaff(),
				listMyReviewIssueIds(user.id)
			])
		);
		return {
			issueData: {
				query,
				view,
				columns: view === 'board' ? pages : null,
				table: view === 'table' ? pages : null
			} as import('$lib/utils/issue-pages.svelte').IssuePageSeed,
			staff,
			myReviewIssueIds,
			userId: user.id
		};
	} catch {
		error(503, 'Unable to load issues. Please try again.');
	}
};
