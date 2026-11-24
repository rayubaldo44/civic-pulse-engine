import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import type { IssueStatus, ResolutionRound, ResolutionReview } from '$lib/types/issues';
import { validatePatchFields } from '$lib/server/issues';
import { notifyIssueAssigned, notifyIssueStatusChanged } from '$lib/server/notify';
import { invalidateBadges } from '$lib/server/badges-cache';
import { logAudit, buildDetails } from '$lib/server/audit';

// ── GET /api/issues/[id] ──────────────────────────────────────────────────────
// Returns full issue with comments + status history
export const GET: RequestHandler = async ({ locals: { safeGetSession }, params }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const supabase = getServiceSupabase();

	try {
		const [issueResult, commentsResult, logsResult, roundsResult, profileResult] =
			await Promise.all([
				supabase
					.from('civic_issues')
					.select(
						`
					id,
					title,
					description,
					topic,
					priority,
					status,
					created_at,
					updated_at,
					resolved_at,
					source_comment_id,
					source_flagged_claim_id,
					assigned_to,
					created_by,
					assignee:profiles!civic_issues_assigned_to_fkey (
						id, full_name
					),
					creator:profiles!civic_issues_created_by_fkey (
						id, full_name
					),
					source_comment:processed_content!civic_issues_source_comment_id_fkey (
						id, cleaned_text, sentiment_label, topic_label
					),
					source_claim:flagged_claims!civic_issues_source_flagged_claim_id_fkey (
						id, claim_text, rag_determination, source_platform
					)
				`
					)
					.eq('id', params.id)
					.maybeSingle(),

				supabase
					.from('issue_comments')
					.select(
						`
					id, body, created_at,
					author:profiles!issue_comments_author_id_fkey (
						id, full_name
					)
				`
					)
					.eq('issue_id', params.id)
					.order('created_at', { ascending: true }),

				supabase
					.from('issue_status_logs')
					.select(
						`
					id, from_status, to_status, note, changed_at,
					actor:profiles!issue_status_logs_changed_by_fkey (
						id, full_name
					)
				`
					)
					.eq('issue_id', params.id)
					.order('changed_at', { ascending: true }),

				(supabase.from('issue_resolution_rounds') as any)
					.select(
						`id, round_number, resolution_summary, actions_taken, observed_outcome,
					evidence_links, status, submitted_at, decided_at,
					submitter:profiles!issue_resolution_rounds_submitted_by_fkey (id, full_name)`
					)
					.eq('issue_id', params.id)
					.order('round_number', { ascending: false }),

				supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
			]);

		if (issueResult.error) throw issueResult.error;
		if (!issueResult.data) return json({ error: 'Issue not found' }, { status: 404 });

		// Cast: table not in generated types yet — safe because select columns are explicit
		const rawRounds = (roundsResult.data ?? []) as Array<Record<string, any>>;
		const roundIds = rawRounds.map((round) => round.id as string);
		const reviewsResult = roundIds.length
			? await (supabase.from('issue_resolution_reviews') as any)
					.select(
						`id, round_id, reviewer_id, decision, actions_completed, evidence_sufficient,
						outcome_addresses_issue, no_unresolved_blocker, comment, assigned_at, due_at,
						submitted_at, reviewer:profiles!issue_resolution_reviews_reviewer_id_fkey (id, full_name)`
					)
					.in('round_id', roundIds)
			: { data: [] };
		const isAdmin = (profileResult.data as { role?: string } | null)?.role === 'admin';
		const now = Date.now();
		const resolutionRounds: ResolutionRound[] = rawRounds.map((round) => {
			const closed = round.status !== 'pending';
			const rawReviews = ((reviewsResult.data ?? []) as Array<Record<string, any>>).filter(
				(review) => review.round_id === round.id
			);
			const reviews: ResolutionReview[] = rawReviews.map((review) => {
				const mine = review.reviewer_id === user.id;
				const revealDecision = closed || mine;
				const revealIdentity = closed || mine || isAdmin;
				return {
					id: revealIdentity ? review.id : null,
					reviewer: revealIdentity ? review.reviewer : null,
					decision: revealDecision ? review.decision : null,
					actions_completed: revealDecision ? review.actions_completed : null,
					evidence_sufficient: revealDecision ? review.evidence_sufficient : null,
					outcome_addresses_issue: revealDecision ? review.outcome_addresses_issue : null,
					no_unresolved_blocker: revealDecision ? review.no_unresolved_blocker : null,
					comment: revealDecision ? review.comment : null,
					assigned_at: revealIdentity ? review.assigned_at : null,
					due_at: revealIdentity ? review.due_at : null,
					submitted_at: review.submitted_at
						? revealIdentity
							? review.submitted_at
							: 'submitted'
						: null,
					is_mine: mine,
					is_overdue:
						Boolean(!review.submitted_at && review.due_at) &&
						new Date(review.due_at).getTime() <= now
				};
			});
			return {
				...round,
				evidence_links: Array.isArray(round.evidence_links) ? round.evidence_links : [],
				review_count: rawReviews.filter((review) => review.submitted_at).length,
				reviews
			} as ResolutionRound;
		});

		const issue = issueResult.data as unknown as Record<string, unknown>;
		return json({
			...issue,
			comments: commentsResult.data ?? [],
			status_logs: logsResult.data ?? [],
			resolution_rounds: resolutionRounds
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};

// ── PATCH /api/issues/[id] ────────────────────────────────────────────────────
// Update priority, status, assigned_to, description
// Status transitions are validated server-side — invalid moves return 400
export const PATCH: RequestHandler = async ({
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

	const ipAddress = getClientAddress();
	const userAgent = request.headers.get('user-agent') ?? null;

	const supabase = getServiceSupabase();

	// Fetch current issue — cast result because civic_issues not yet in generated types
	// Errors resolve after: supabase db push && supabase gen types typescript
	type CurrentRow = {
		id: string;
		title: string;
		status: string;
		priority: string;
		assigned_to: string | null;
	};
	const { data: rawCurrent, error: fetchErr } = await supabase
		.from('civic_issues')
		.select('id, title, status, priority, assigned_to')
		.eq('id', params.id)
		.maybeSingle();
	const current = rawCurrent as unknown as CurrentRow | null;

	if (fetchErr || !current) {
		return json({ error: 'Issue not found' }, { status: 404 });
	}
	if (current.status === 'Under Review') {
		return json({ error: 'This issue is locked while peer review is active' }, { status: 409 });
	}

	// Validate + build the patch. Status transitions are enforced server-side
	// against the shared adjacency map — invalid moves return 400.
	const { patch, error } = await validatePatchFields(body, current, async (id) => {
		const { data: profile } = await supabase
			.from('profiles')
			.select('id')
			.eq('id', id)
			.maybeSingle();
		return Boolean(profile);
	});
	if (error) {
		return json({ error: error.message }, { status: error.status });
	}

	try {
		const civicIssuesQB = supabase.from('civic_issues') as any;
		const { data, error } = await civicIssuesQB
			.update(patch)
			.eq('id', params.id)
			.select(
				`id, title, status, priority, assigned_to, updated_at, resolved_at,
				assignee:profiles!civic_issues_assigned_to_fkey (id, full_name)`
			)
			.single();

		if (error) throw error;

		// Correct the changed_by on the auto-inserted status log row.
		// Trigger uses assigned_to as a fallback; we fix it to the actual actor.
		// UPDATE doesn't support .order/.limit, so we select the row ID first.
		if (patch.status) {
			const { data: logRow } = await supabase
				.from('issue_status_logs')
				.select('id')
				.eq('issue_id', params.id)
				.eq('to_status', patch.status as string)
				.order('changed_at', { ascending: false })
				.limit(1)
				.maybeSingle();

			if (logRow) {
				await (supabase.from('issue_status_logs') as any)
					.update({
						changed_by: user.id,
						note: typeof body.note === 'string' ? body.note : null
					})
					.eq('id', (logRow as { id: string }).id);
			}
		}

		// Notifications — best-effort; deliver() swallows its own errors.
		// Fires on real assignment changes, or on status changes affecting
		// the (other) assignee. Self-actions never trigger email.
		const newAssignee = (
			patch.assigned_to !== undefined ? patch.assigned_to : current.assigned_to
		) as string | null;
		const assignedChanged =
			newAssignee !== null &&
			patch.assigned_to !== undefined &&
			patch.assigned_to !== current.assigned_to;
		const effectivePriority = (patch.priority as string | undefined) ?? current.priority;

		// The sidebar "my tasks" badge changed for the actor (and possibly the
		// new assignee) — drop their cached counts so the next load re-queries.
		invalidateBadges(user.id);
		if (assignedChanged && newAssignee && newAssignee !== user.id) {
			invalidateBadges(newAssignee);
		}

		if (assignedChanged && newAssignee !== user.id) {
			await notifyIssueAssigned({
				issueId: params.id,
				title: current.title,
				priority: effectivePriority,
				assigneeId: newAssignee,
				actorId: user.id
			});
		} else if (patch.status && newAssignee && newAssignee !== user.id) {
			await notifyIssueStatusChanged({
				issueId: params.id,
				title: current.title,
				priority: effectivePriority,
				toStatus: patch.status as IssueStatus,
				assigneeId: newAssignee,
				actorId: user.id
			});
		}

		const change: Record<string, unknown> = {};
		if (patch.status !== undefined) {
			change.status = { from: current.status, to: patch.status };
		}
		if (patch.priority !== undefined) {
			change.priority = { from: current.priority, to: patch.priority };
		}
		if (patch.assigned_to !== undefined) {
			change.assigned_to = { from: current.assigned_to, to: patch.assigned_to };
		}
		if (patch.description !== undefined) {
			change.description = 'updated';
		}

		await logAudit({
			action: 'issue.update',
			actorId: user.id,
			actorEmail: user.email ?? 'system',
			resourceType: 'issue',
			resourceId: params.id,
			ipAddress,
			userAgent,
			details: buildDetails({ issue_title: current.title, changes: change })
		});

		return json(data);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ error: message }, { status: 500 });
	}
};
