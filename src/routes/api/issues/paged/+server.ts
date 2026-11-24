import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listIssuePage, readIssueQuery } from '$lib/server/paged-issues';
import { measureServer } from '$lib/server/timing';

export const GET: RequestHandler = async ({ locals, url }) => {
	const { user } = await locals.safeGetSession();
	if (!user) redirect(303, '/login');
	try {
		return json(
			await measureServer(locals, 'issues_db', () =>
				listIssuePage(readIssueQuery(url.searchParams), user.id)
			),
			{
				headers: { 'cache-control': 'private, no-store' }
			}
		);
	} catch {
		return json(
			{ error: 'Unable to load issues. Try again.' },
			{ status: 500, headers: { 'cache-control': 'private, no-store' } }
		);
	}
};
