import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';

// ── GET /api/staff ────────────────────────────────────────────────────────────
// Returns all profiles ordered by name — used by embeddable components that
// need the staff list without a server load (e.g. IssueTracker.svelte).
export const GET: RequestHandler = async ({ locals: { safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const supabase = getServiceSupabase();
	const { data, error } = await supabase
		.from('profiles')
		.select('id, full_name')
		.order('full_name');

	if (error) return json({ error: error.message }, { status: 500 });
	return json(data ?? []);
};
