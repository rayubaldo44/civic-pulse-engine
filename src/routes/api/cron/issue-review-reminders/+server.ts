import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import { notifyIssueReviewReminder } from '$lib/server/notify';
import { invalidateNotifications } from '$lib/server/notifications-cache';

export const GET: RequestHandler = async ({ request }) => {
	if (!env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const supabase = getServiceSupabase();
	const { data, error } = await (supabase.rpc as any)('claim_overdue_issue_reviews');
	if (error) return json({ error: error.message }, { status: 500 });

	for (const review of (data ?? []) as Array<{
		review_id: string;
		reviewer_id: string;
		issue_id: string;
		issue_title: string;
	}>) {
		await (supabase.rpc as any)('enqueue_notification', {
			p_user_id: review.reviewer_id,
			p_category: 'issue_peer_review',
			p_severity: 'warning',
			p_title: 'Peer review overdue',
			p_body: `Complete the review for “${review.issue_title}” or ask an admin to reassign it.`,
			p_href: `/Authenticated/issues?issue=${review.issue_id}`,
			p_fingerprint: `issue-review-overdue:${review.review_id}`
		});
		invalidateNotifications(review.reviewer_id);
		void notifyIssueReviewReminder({
			issueId: review.issue_id,
			title: review.issue_title,
			assigneeId: review.reviewer_id,
			actorId: '00000000-0000-0000-0000-000000000000'
		});
	}

	return json({ reminded: data?.length ?? 0 });
};
