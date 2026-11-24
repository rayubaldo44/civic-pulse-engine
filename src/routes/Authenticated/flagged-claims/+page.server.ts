import { error, redirect } from '@sveltejs/kit';
import { measureServer } from '$lib/server/timing';
import { listClaimsPage } from '$lib/server/claims';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, depends }) => {
	const { user } = await locals.safeGetSession();
	if (!user) redirect(303, '/login');
	depends('claims:list');
	try {
		const result = await measureServer(locals, 'claims_db', () =>
			listClaimsPage(url.searchParams, false)
		);
		return {
			flaggedItems: result.items,
			counts: result.counts,
			filters: { q: result.q, status: result.status },
			pagination: { page: result.page, pageSize: result.pageSize, total: result.total }
		};
	} catch (err) {
		console.error(
			'[flagged-claims] load failed:',
			err instanceof Error ? err.message : 'Database error'
		);
		error(503, 'Claims are temporarily unavailable. Please try again.');
	}
};
