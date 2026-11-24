import { getServiceSupabase } from '$lib/server/supabase';
import type { Issue, IssueStatus, Priority, Profile } from '$lib/types/issues';
import { isValidTransition } from '$lib/types/issues';

export const VALID_PRIORITIES = new Set<Priority>(['Critical', 'High', 'Medium', 'Low']);
export const VALID_STATUSES = new Set<IssueStatus>([
	'Open',
	'In Progress',
	'Under Review',
	'Resolved',
	'Closed'
]);
export const VALID_TOPICS = new Set([
	'Infrastructure',
	'Healthcare',
	'Waste Management',
	'Public Safety',
	'Other'
]);

// Shared list shape — single source used by GET /api/issues and the
// /Authenticated/issues SSR load so they can never drift apart
const ISSUE_SELECT = `
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
	)
`;

export interface IssueFilters {
	status?: string | null;
	priority?: string | null;
	topic?: string | null;
	q?: string | null;
	assignee?: string | null;
}

// List issues newest-first. Filters are lenient: invalid enum values are
// ignored rather than rejected (house convention).
// civic_issues not in generated types yet; cast resolves after:
// supabase db push && supabase gen types typescript
export async function listIssues(filters: IssueFilters = {}): Promise<Issue[]> {
	const supabase = getServiceSupabase();

	let query = supabase.from('civic_issues').select(ISSUE_SELECT).order('created_at', {
		ascending: false
	});

	if (filters.status && VALID_STATUSES.has(filters.status as IssueStatus)) {
		query = query.eq('status', filters.status);
	}
	if (filters.priority && VALID_PRIORITIES.has(filters.priority as Priority)) {
		query = query.eq('priority', filters.priority);
	}
	if (filters.topic && VALID_TOPICS.has(filters.topic)) {
		query = query.eq('topic', filters.topic);
	}
	if (filters.assignee) {
		query = query.eq('assigned_to', filters.assignee);
	}
	const q = filters.q?.trim();
	if (q) {
		// ilike is parameterized by Supabase — no raw string injection
		query = query.ilike('title', `%${q}%`);
	}

	const { data, error } = await query;
	if (error) throw error;
	return (data ?? []) as unknown as Issue[];
}

export async function listStaff(): Promise<Profile[]> {
	const supabase = getServiceSupabase();
	const { data, error } = await supabase
		.from('profiles')
		.select('id, full_name')
		.order('full_name');
	if (error) throw error;
	return (data ?? []) as Profile[];
}

export async function listMyReviewIssueIds(userId: string): Promise<string[]> {
	const supabase = getServiceSupabase();
	const { data, error } = await (supabase.from('issue_resolution_reviews') as any)
		.select('submitted_at, round:issue_resolution_rounds!inner(issue_id, status)')
		.eq('reviewer_id', userId);
	if (error) throw error;
	return (data ?? [])
		.filter((row: any) => !row.submitted_at && row.round?.status === 'pending')
		.map((row: any) => row.round.issue_id as string);
}

// ── PATCH field validation ───────────────────────────────────────────────────
export interface PatchFieldError {
	status: number;
	message: string;
}

export interface PatchValidationResult {
	patch: Record<string, unknown>;
	error?: PatchFieldError;
}

// Pure validator for PATCH /api/issues/[id] bodies. Mirrors the original
// inline logic exactly — evaluation order is significant:
//   status transition → priority → assigned_to → description → empty check.
// `isValidAssignee` is injected so the DB lookup stays at the call site; it is
// only invoked when body.assigned_to carries a non-null string value.
export async function validatePatchFields(
	body: Record<string, unknown>,
	current: { status: string },
	isValidAssignee: (id: string) => Promise<boolean>
): Promise<PatchValidationResult> {
	const patch: Record<string, unknown> = {};

	// ── Status change ────────────────────────────────────────────────────────
	if (typeof body.status === 'string') {
		const newStatus = body.status as IssueStatus;
		const oldStatus = current.status as IssueStatus;

		if (newStatus === oldStatus) {
			// No-op — skip without error
		} else if (!isValidTransition(oldStatus, newStatus)) {
			return {
				patch,
				error: {
					status: 400,
					message: `Invalid transition: ${oldStatus} → ${newStatus}`
				}
			};
		} else {
			patch.status = newStatus;
		}
	}

	// ── Priority ─────────────────────────────────────────────────────────────
	if (typeof body.priority === 'string') {
		if (!VALID_PRIORITIES.has(body.priority as Priority)) {
			return { patch, error: { status: 400, message: 'Invalid priority value' } };
		}
		patch.priority = body.priority;
	}

	// ── Assigned_to ──────────────────────────────────────────────────────────
	if (body.assigned_to !== undefined) {
		if (body.assigned_to === null) {
			patch.assigned_to = null;
		} else if (typeof body.assigned_to === 'string') {
			const valid = await isValidAssignee(body.assigned_to);
			if (!valid) {
				return {
					patch,
					error: {
						status: 400,
						message: 'assigned_to does not reference a valid user'
					}
				};
			}
			patch.assigned_to = body.assigned_to;
		}
	}

	// ── Description ──────────────────────────────────────────────────────────
	if (typeof body.description === 'string') {
		patch.description = body.description.trim();
	}

	if (Object.keys(patch).length === 0) {
		return { patch, error: { status: 400, message: 'No valid fields to update' } };
	}

	return { patch };
}
