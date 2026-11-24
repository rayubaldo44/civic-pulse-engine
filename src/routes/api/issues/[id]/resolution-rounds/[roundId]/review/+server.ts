import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import { buildDetails, logAudit } from '$lib/server/audit';
import { notifyIssueReviewOutcome } from '$lib/server/notify';
import { invalidateBadges } from '$lib/server/badges-cache';
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
	const decision = body.decision;
	const checks = [
		body.actions_completed,
		body.evidence_sufficient,
		body.outcome_addresses_issue,
		body.no_unresolved_blocker
	];
	const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
	if (
		!['approve', 'request_changes'].includes(String(decision)) ||
		checks.some((value) => typeof value !== 'boolean')
	) {
		return json({ error: 'Decision and all four rubric answers are required' }, { status: 400 });
	}
	if (decision === 'approve' && checks.some((value) => value !== true)) {
		return json({ error: 'Every criterion must pass before approval' }, { status: 400 });
	}
	if (decision === 'request_changes' && !comment) {
		return json({ error: 'Explain what must change' }, { status: 400 });
	}

	const supabase = getServiceSupabase();
	const { data: round } = await (supabase.from('issue_resolution_rounds') as any)
		.select('issue_id, submitted_by, round_number, issue:civic_issues!inner(title, priority)')
		.eq('id', params.roundId)
		.maybeSingle();
	if (!round || round.issue_id !== params.id)
		return json({ error: 'Review round not found' }, { status: 404 });

	const { data: result, error } = await (supabase.rpc as any)('submit_issue_resolution_review', {
		p_round_id: params.roundId,
		p_reviewer_id: user.id,
		p_decision: decision,
		p_actions_completed: checks[0],
		p_evidence_sufficient: checks[1],
		p_outcome_addresses_issue: checks[2],
		p_no_unresolved_blocker: checks[3],
		p_comment: comment || null
	});
	if (error) {
		const conflict = /closed|assigned|already submitted/i.test(error.message);
		return json({ error: error.message }, { status: conflict ? 409 : 400 });
	}

	if (result !== 'pending' && round) {
		await (supabase.rpc as any)('enqueue_notification', {
			p_user_id: round.submitted_by,
			p_category: 'issue_peer_review',
			p_severity: result === 'passed' ? 'info' : 'warning',
			p_title: result === 'passed' ? 'Resolution approved' : 'Resolution needs revision',
			p_body:
				result === 'passed'
					? 'Your issue was resolved by peer majority.'
					: 'Review the peer feedback and resubmit.',
			p_href: `/Authenticated/issues?issue=${params.id}`,
			p_fingerprint: `issue-review-result:${params.roundId}`
		});
		invalidateNotifications(round.submitted_by);
		invalidateBadges(round.submitted_by);
		invalidateBadges(user.id);
		void notifyIssueReviewOutcome({
			issueId: params.id,
			title: round.issue?.title ?? 'Issue',
			priority: round.issue?.priority,
			toStatus: result === 'passed' ? 'Resolved' : 'In Progress',
			assigneeId: round.submitted_by,
			actorId: user.id
		});
	}

	await logAudit({
		action: 'issue.review.vote',
		actorId: user.id,
		actorEmail: user.email ?? 'system',
		resourceType: 'issue',
		resourceId: params.id,
		ipAddress: getClientAddress(),
		userAgent: request.headers.get('user-agent'),
		details: buildDetails({ round_id: params.roundId, decision, result })
	});

	return json({ result });
};
