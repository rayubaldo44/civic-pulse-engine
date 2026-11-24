// src/routes/api/sidebar-badges/+server.ts
// Sidebar badge counts (pending flagged claims + my open tasks) for the
// client. Previously these were resolved inside the /Authenticated SSR layout
// load, which re-ran (and re-queried) on EVERY client-side navigation. They are
// now fetched here, throttled client-side to 45s, so navigating between pages
// no longer waits on the RPC — while keeping the same server RPC + cache.
//
// Session-gated like every /api route (safeGetSession → redirect /login).

import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import { getBadgesFetchedAt, getCachedBadges, setCachedBadges } from '$lib/server/badges-cache';

export const GET: RequestHandler = async ({ locals: { safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const supabase = getServiceSupabase();

	let badges = getCachedBadges(user.id);
	let fetchedAt = badges ? (getBadgesFetchedAt(user.id) ?? Date.now()) : Date.now();
	if (!badges) {
		// get_sidebar_badges isn't in generated types yet — cast for the args
		// overload, same convention as `(supabase.from('civic_issues') as any)`.
		const { data, error } = await (supabase.rpc as any)('get_sidebar_badges', {
			p_user_id: user.id
		}).maybeSingle();
		if (error) {
			console.error('[sidebar-badges] query failed:', error.message);
			return json(
				{ error: 'Unable to refresh sidebar counts.' },
				{ status: 503, headers: { 'Cache-Control': 'private, no-store' } }
			);
		} else {
			badges = {
				pending: (data as { pending?: number } | null)?.pending ?? 0,
				myTasks: (data as { my_tasks?: number } | null)?.my_tasks ?? 0
			};
			// Only cache successful reads — never poison the cache with errors.
			setCachedBadges(user.id, badges, fetchedAt);
		}
	}

	return json(
		{ pending: badges.pending, my_tasks: badges.myTasks, fetchedAt },
		{ headers: { 'Cache-Control': 'private, no-store' } }
	);
};
