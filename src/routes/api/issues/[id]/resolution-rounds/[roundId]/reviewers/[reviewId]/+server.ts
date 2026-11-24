import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import { buildDetails, logAudit } from '$lib/server/audit';
import { notifyIssuePeerReviewAssigned } from '$lib/server/notify';
import { invalidateNotifications } from '$lib/server/notifications-cache';

export const PATCH: RequestHandler = async ({
	locals: { safeGetSession },
	params,
	request,
	getClientAddress
}) => {
	const { user } = await safeGetSession();
	if (!user) return json({ error: 'Authentication required' }, { status: 401 });
	if (user.app_metadata?.role !== 'admin')
		return json({ error: 'Admin access required' }, { status: 403 });

	const supabase = getServiceSupabase();
	const { data: profile } = await (supabase.from('profiles') as any)
		.select('role')
		.eq('id', user.id)
		.single();
	if (profile?.role !== 'admin') return json({ error: 'Admin access required' }, { status: 403 });
	const { data: assignment } = await (supabase.from('issue_resolution_reviews') as any)
		.select('round_id, round:issue_resolution_rounds!inner(issue_id)')
		.eq('id', params.reviewId)
		.maybeSingle();
	if (
		!assignment ||
		assignment.round_id !== params.roundId ||
		assignment.round?.issue_id !== params.id
	)
		return json({ error: 'Review assignment not found' }, { status: 404 });

	const { data: reviewerId, error } = await (supabase.rpc as any)(
		'reassign_issue_resolution_reviewer',
		{ p_review_id: params.reviewId }
	);
	if (error) return json({ error: error.message }, { status: 409 });

	const { data: issue } = await (supabase.from('civic_issues') as any)
		.select('title, priority')
		.eq('id', params.id)
		.single();
	await (supabase.rpc as any)('enqueue_notification', {
		p_user_id: reviewerId,
		p_category: 'issue_peer_review',
		p_severity: 'info',
		p_title: 'Peer review assigned',
		p_body: `Review the proposed resolution for “${issue?.title ?? 'Issue'}”.`,
		p_href: `/Authenticated/issues?issue=${params.id}`,
		p_fingerprint: `issue-review-reassigned:${params.roundId}:${params.reviewId}:${reviewerId}`
	});
	invalidateNotifications(reviewerId);
	void notifyIssuePeerReviewAssigned({
		issueId: params.id,
		title: issue?.title ?? 'Issue',
		priority: issue?.priority,
		assigneeId: reviewerId,
		actorId: user.id
	});
	await logAudit({
		action: 'issue.review.reassign',
		actorId: user.id,
		actorEmail: user.email ?? 'system',
		resourceType: 'issue',
		resourceId: params.id,
		ipAddress: getClientAddress(),
		userAgent: request.headers.get('user-agent'),
		details: buildDetails({
			round_id: params.roundId,
			review_id: params.reviewId,
			reviewer_id: reviewerId
		})
	});
	return json({ reviewer_id: reviewerId });
};
