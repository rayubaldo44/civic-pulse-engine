import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import { buildDetails, logAudit } from '$lib/server/audit';
import { notifyIssuePeerReviewAssigned } from '$lib/server/notify';
import { invalidateNotifications } from '$lib/server/notifications-cache';

export const POST: RequestHandler = async ({
	locals: { safeGetSession },
	params,
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

	const resolutionSummary =
		typeof body.resolution_summary === 'string' ? body.resolution_summary.trim() : '';
	const actionsTaken = typeof body.actions_taken === 'string' ? body.actions_taken.trim() : '';
	const observedOutcome =
		typeof body.observed_outcome === 'string' ? body.observed_outcome.trim() : '';
	const evidenceLinks = Array.isArray(body.evidence_links)
		? body.evidence_links.filter((link): link is string => {
				if (typeof link !== 'string') return false;
				try {
					return ['http:', 'https:'].includes(new URL(link).protocol);
				} catch {
					return false;
				}
			})
		: [];
	if (!resolutionSummary || !actionsTaken || !observedOutcome || evidenceLinks.length === 0) {
		return json(
			{
				error:
					'Add a summary, actions taken, observed outcome, and at least one valid evidence link'
			},
			{ status: 400 }
		);
	}

	const supabase = getServiceSupabase();
	const { data: roundId, error } = await (supabase.rpc as any)('start_issue_resolution_round', {
		p_issue_id: params.id,
		p_submitted_by: user.id,
		p_resolution_summary: resolutionSummary,
		p_actions_taken: actionsTaken,
		p_observed_outcome: observedOutcome,
		p_evidence_links: evidenceLinks
	});
	if (error) {
		const conflict = /assigned analyst|In Progress|eligible reviewers|required/i.test(
			error.message
		);
		return json({ error: error.message }, { status: conflict ? 409 : 500 });
	}

	const [{ data: issue }, { data: assignments }] = await Promise.all([
		(supabase.from('civic_issues') as any).select('title, priority').eq('id', params.id).single(),
		(supabase.from('issue_resolution_reviews') as any).select('reviewer_id').eq('round_id', roundId)
	]);
	for (const assignment of (assignments ?? []) as Array<{ reviewer_id: string }>) {
		await (supabase.rpc as any)('enqueue_notification', {
			p_user_id: assignment.reviewer_id,
			p_category: 'issue_peer_review',
			p_severity: 'info',
			p_title: 'Peer review assigned',
			p_body: `Review the proposed resolution for “${issue?.title ?? 'Issue'}”.`,
			p_href: `/Authenticated/issues?issue=${params.id}`,
			p_fingerprint: `issue-review:${roundId}:${assignment.reviewer_id}`
		});
		invalidateNotifications(assignment.reviewer_id);
		void notifyIssuePeerReviewAssigned({
			issueId: params.id,
			title: issue?.title ?? 'Issue',
			priority: issue?.priority,
			assigneeId: assignment.reviewer_id,
			actorId: user.id
		});
	}

	await logAudit({
		action: 'issue.review.submit',
		actorId: user.id,
		actorEmail: user.email ?? 'system',
		resourceType: 'issue',
		resourceId: params.id,
		ipAddress: getClientAddress(),
		userAgent: request.headers.get('user-agent'),
		details: buildDetails({ round_id: roundId, reviewers: 3 })
	});

	return json({ round_id: roundId, status: 'pending' }, { status: 201 });
};
