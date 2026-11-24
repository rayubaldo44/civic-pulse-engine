export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';
export type IssueStatus = 'Open' | 'In Progress' | 'Under Review' | 'Resolved' | 'Closed';

// Adjacency list of allowed status transitions — single source shared by the
// API (server-side enforcement) and the UI (dropdown options / action gating)
export const ISSUE_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
	Open: ['In Progress', 'Closed'],
	'In Progress': ['Open'],
	'Under Review': [],
	Resolved: ['Closed', 'Open'],
	Closed: ['Open']
};

// Whether moving an issue from one status to another is allowed. Unknown
// statuses (bad casts, stale rows) always fail closed.
export function isValidTransition(from: IssueStatus, to: IssueStatus): boolean {
	return ISSUE_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface Profile {
	id: string;
	full_name: string | null;
}

export interface Issue {
	id: string;
	title: string;
	description: string | null;
	topic: string | null;
	priority: Priority;
	status: IssueStatus;
	created_at: string;
	updated_at: string;
	resolved_at: string | null;
	source_comment_id: string | null;
	source_flagged_claim_id: string | null;
	assigned_to: string | null;
	created_by: string | null;
	assignee: Profile | null;
	creator: Profile | null;
}

export interface IssueComment {
	id: string;
	body: string;
	created_at: string;
	author: Profile | null;
}

export interface StatusLog {
	id: string;
	from_status: string | null;
	to_status: string | null;
	note: string | null;
	changed_at: string;
	actor: Profile | null;
}

export type ResolutionDecision = 'approve' | 'request_changes';
export type ResolutionRoundStatus = 'pending' | 'passed' | 'failed';

export interface ResolutionReview {
	id: string | null;
	reviewer: Profile | null;
	decision: ResolutionDecision | null;
	actions_completed: boolean | null;
	evidence_sufficient: boolean | null;
	outcome_addresses_issue: boolean | null;
	no_unresolved_blocker: boolean | null;
	comment: string | null;
	assigned_at: string | null;
	due_at: string | null;
	submitted_at: string | null;
	is_mine: boolean;
	is_overdue: boolean;
}

export interface ResolutionRound {
	id: string;
	round_number: number;
	resolution_summary: string;
	actions_taken: string;
	observed_outcome: string;
	evidence_links: string[];
	status: ResolutionRoundStatus;
	submitted_at: string;
	decided_at: string | null;
	submitter: Profile | null;
	review_count: number;
	reviews: ResolutionReview[];
}

export interface IssueDetail extends Issue {
	comments: IssueComment[];
	status_logs: StatusLog[];
	resolution_rounds?: ResolutionRound[];
	source_comment: {
		id: string;
		cleaned_text: string | null;
		sentiment_label: string | null;
		topic_label: string | null;
	} | null;
	source_claim: {
		id: string;
		claim_text: string;
		rag_determination: string | null;
		source_platform: string | null;
	} | null;
}
