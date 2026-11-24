import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';

const PAGE_SIZE = 25;

export type AuditLog = {
	id: string;
	action: string;
	actor_id: string | null;
	actor_email: string;
	details: string | null;
	resource_type: string | null;
	resource_id: string | null;
	ip_address: string | null;
	user_agent: string | null;
	created_at: string;
};

export const load: PageServerLoad = async ({ locals: { safeGetSession }, url }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const role = (user.app_metadata?.role ?? user.user_metadata?.role ?? 'analyst') as string;

	const action = url.searchParams.get('action')?.trim().slice(0, 200) ?? '';
	const actor = url.searchParams.get('actor')?.trim().slice(0, 200) ?? '';
	const details = url.searchParams.get('details')?.trim().slice(0, 200) ?? '';
	const resourceType = url.searchParams.get('resource_type')?.trim().slice(0, 100) ?? '';
	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));

	let logs: AuditLog[] = [];
	let total = 0;

	if (role === 'admin') {
		const supabase = getServiceSupabase();

		// PostgREST parameterises .ilike() values — no raw SQL interpolation.
		let query = supabase
			.from('audit_logs')
			.select('*', { count: 'exact' })
			.order('created_at', { ascending: false })
			.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

		if (action) query = query.ilike('action', `%${action}%`);
		if (actor) query = query.ilike('actor_email', `%${actor}%`);
		if (details) query = query.ilike('details', `%${details}%`);
		if (resourceType) query = query.eq('resource_type', resourceType);

		const { data, count } = await query;
		logs = (data ?? []) as AuditLog[];
		total = count ?? 0;
	}

	return {
		role,
		logs,
		total,
		page,
		pageSize: PAGE_SIZE,
		filters: { action, actor, details, resourceType }
	};
};
