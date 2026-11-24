import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import type { Priority } from '$lib/types/issues';
import { VALID_PRIORITIES, VALID_TOPICS, listIssues } from '$lib/server/issues';
import { notifyIssueAssigned } from '$lib/server/notify';
import { invalidateBadges } from '$lib/server/badges-cache';
import { logAudit, buildDetails } from '$lib/server/audit';

// ── GET /api/issues ───────────────────────────────────────────────────────────
// Supports ?status=Open&priority=High&topic=Infrastructure&q=keyword
export const GET: RequestHandler = async ({ locals: { safeGetSession }, url }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	try {
		const issues = await listIssues({
			status: url.searchParams.get('status'),
			priority: url.searchParams.get('priority'),
			topic: url.searchParams.get('topic'),
			q: url.searchParams.get('q')
		});
		return json(issues);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};

// ── POST /api/issues ──────────────────────────────────────────────────────────
// Create a new issue manually or via escalation from flagged claims
export const POST: RequestHandler = async ({
	locals: { safeGetSession },
	request,
	getClientAddress
}) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const ipAddress = getClientAddress();
	const userAgent = request.headers.get('user-agent') ?? null;

	const title = typeof body.title === 'string' ? body.title.trim() : '';
	const description = typeof body.description === 'string' ? body.description.trim() : null;
	const topic = typeof body.topic === 'string' ? body.topic : null;
	const source_comment_id =
		typeof body.source_comment_id === 'string' ? body.source_comment_id : null;
	const source_flagged_claim_id =
		typeof body.source_flagged_claim_id === 'string' ? body.source_flagged_claim_id : null;
	const assigned_to = typeof body.assigned_to === 'string' ? body.assigned_to : null;

	const rawPriority = typeof body.priority === 'string' ? body.priority : 'Medium';
	const priority: Priority = VALID_PRIORITIES.has(rawPriority as Priority)
		? (rawPriority as Priority)
		: 'Medium';

	if (!title) {
		return json({ error: 'title is required' }, { status: 400 });
	}
	if (topic && !VALID_TOPICS.has(topic)) {
		return json({ error: 'Invalid topic value' }, { status: 400 });
	}

	const supabase = getServiceSupabase();

	// Validate assigned_to exists in profiles
	if (assigned_to) {
		const { data: profile } = await supabase
			.from('profiles')
			.select('id')
			.eq('id', assigned_to)
			.maybeSingle();
		if (!profile) {
			return json({ error: 'assigned_to does not reference a valid user' }, { status: 400 });
		}
	}

	try {
		// civic_issues not in generated types yet; resolves after:
		// supabase db push && supabase gen types typescript
		const qb = supabase.from('civic_issues') as any;
		const { data, error } = await qb
			.insert({
				title,
				description,
				topic,
				priority,
				status: 'Open',
				source_comment_id,
				source_flagged_claim_id,
				assigned_to,
				created_by: user.id
			})
			.select('id, title, priority, status, created_at')
			.single();

		if (error) throw error;

		// Notify the initial assignee (no-op when self-assigned or unassigned)
		if (assigned_to) {
			await notifyIssueAssigned({
				issueId: (data as { id: string }).id,
				title,
				priority,
				assigneeId: assigned_to,
				actorId: user.id
			});
		}

		// A new Open issue bumps the assignee's "my tasks" badge — drop the cached count.
		invalidateBadges(user.id);
		if (assigned_to && assigned_to !== user.id) {
			invalidateBadges(assigned_to);
		}

		await logAudit({
			action: 'issue.create',
			actorId: user.id,
			actorEmail: user.email ?? 'system',
			resourceType: 'issue',
			resourceId: (data as { id: string }).id,
			ipAddress,
			userAgent,
			details: buildDetails({
				title,
				topic: topic ?? null,
				priority,
				assigned_to: assigned_to ?? null
			})
		});

		return json(data as unknown, { status: 201 });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};
