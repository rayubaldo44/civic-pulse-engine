import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';

// ── POST /api/issues/[id]/comments ───────────────────────────────────────────
// Add an internal staff comment to an issue thread
export const POST: RequestHandler = async ({ locals: { safeGetSession }, params, request }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const bodyText = typeof body.body === 'string' ? body.body.trim() : '';
	if (!bodyText) {
		return json({ error: 'body is required and must not be empty' }, { status: 400 });
	}

	const supabase = getServiceSupabase();

	// Verify the issue exists before inserting
	const { data: issue } = await supabase
		.from('civic_issues')
		.select('id, status')
		.eq('id', params.id)
		.maybeSingle();

	if (!issue) {
		return json({ error: 'Issue not found' }, { status: 404 });
	}
	if ((issue as { status: string }).status === 'Under Review') {
		return json({ error: 'Comments are locked while peer review is active' }, { status: 409 });
	}

	try {
		const { data, error } = await (supabase.from('issue_comments') as any)
			.insert({
				issue_id: params.id,
				author_id: user.id,
				body: bodyText
			})
			.select(
				`id, body, created_at, author:profiles!issue_comments_author_id_fkey ( id, full_name )`
			)
			.single();

		if (error) throw error;
		return json(data as unknown, { status: 201 });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};
