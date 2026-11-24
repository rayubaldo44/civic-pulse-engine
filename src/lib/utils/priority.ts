import type { IssueStatus } from '$lib/types/issues';

export type TopicStatus = 'New' | 'Monitoring' | 'Addressed';

export type TopicCategory =
	'Infrastructure' | 'Healthcare' | 'Waste Management' | 'Public Safety' | 'Other';

export interface TopicWindowStats {
	topic: string;
	commentCount: number;
	negativeCount: number;
	engagementCount: number;
}

export interface TopicPriority {
	topic: string;
	displayName: string;
	rank: number;
	score: number;
	frequencyComponent: number;
	negativityComponent: number;
	engagementComponent: number;
	status: TopicStatus;
	commentCount: number;
	negativeCount: number;
	engagementCount: number;
}

export const PRIORITY_WEIGHTS = {
	frequency: 0.4,
	negativity: 0.35,
	engagement: 0.25
} as const;

export const MIN_SUPPORT = 3;

export const TOPIC_DISPLAY_NAMES: Record<string, string> = {
	Infrastructure: 'Road Repair',
	Healthcare: 'Health Services',
	'Waste Management': 'Waste Collection',
	'Public Safety': 'Public Safety',
	Other: 'Other'
};

// The NLP service emits compound labels outside the five-topic taxonomy
// (e.g. "Public Safety and Peace and Order"). Map observed variants onto
// canonical topics; anything unrecognized folds into "Other".
const TOPIC_ALIASES: Record<string, TopicCategory> = {
	'public safety and peace and order': 'Public Safety',
	'infrastructure and public works': 'Infrastructure',
	'healthcare and medical services': 'Healthcare',
	'health services': 'Healthcare',
	'waste management and sanitation': 'Waste Management'
};

export function normalizeTopic(label: string | null | undefined): TopicCategory {
	const key = (label ?? '').trim().toLowerCase();
	if (!key) return 'Other';

	for (const canonical of Object.keys(TOPIC_DISPLAY_NAMES)) {
		if (canonical.toLowerCase() === key) return canonical as TopicCategory;
	}
	return TOPIC_ALIASES[key] ?? 'Other';
}

/**
 * PriorityScore_t = round(100 × (wF·F̂_t + wN·V_t + wE·Ê_t))
 *   F̂_t = f_t / max(f)        min-max normalized comment frequency in window
 *   V_t  = neg_t / f_t         negativity rate (review/neutral/positive ≠ negative)
 *   Ê_t  = e_t / max(e)        normalized engagement (0 when all engagement is 0)
 * Weights: frequency 0.40 · negativity 0.35 · engagement 0.25.
 * Topics below MIN_SUPPORT are excluded unless no topic clears it,
 * so small datasets still render instead of showing an empty list.
 */
export function computeTopicPriorities(stats: TopicWindowStats[]): TopicPriority[] {
	const valid = stats.filter(
		(s) => s.commentCount > 0 && s.negativeCount >= 0 && s.engagementCount >= 0
	);
	if (valid.length === 0) return [];

	const maxFrequency = Math.max(...valid.map((s) => s.commentCount));
	const maxEngagement = Math.max(...valid.map((s) => s.engagementCount));
	const hasSupportedTopic = valid.some((s) => s.commentCount >= MIN_SUPPORT);
	const eligible = hasSupportedTopic ? valid.filter((s) => s.commentCount >= MIN_SUPPORT) : valid;

	const scored = eligible.map<TopicPriority>((s) => {
		const frequency = clamp01(s.commentCount / maxFrequency);
		const negativity = clamp01(s.negativeCount / s.commentCount);
		const engagement = maxEngagement > 0 ? clamp01(s.engagementCount / maxEngagement) : 0;

		const score = Math.round(
			100 *
				(PRIORITY_WEIGHTS.frequency * frequency +
					PRIORITY_WEIGHTS.negativity * negativity +
					PRIORITY_WEIGHTS.engagement * engagement)
		);

		return {
			topic: s.topic,
			displayName: TOPIC_DISPLAY_NAMES[s.topic] ?? s.topic,
			rank: 0,
			score: Math.min(Math.max(score, 0), 100),
			frequencyComponent: frequency,
			negativityComponent: negativity,
			engagementComponent: engagement,
			status: 'New',
			commentCount: s.commentCount,
			negativeCount: s.negativeCount,
			engagementCount: s.engagementCount
		};
	});

	scored.sort(
		(a, b) =>
			b.score - a.score ||
			b.negativityComponent - a.negativityComponent ||
			b.frequencyComponent - a.frequencyComponent ||
			a.topic.localeCompare(b.topic)
	);

	return scored.map((row, i) => ({ ...row, rank: i + 1 }));
}

/**
 * New          — no civic_issue ticket exists for the topic yet
 * Monitoring   — tickets exist, at least one still active (not Resolved/Closed)
 * Addressed    — every ticket for the topic is Resolved or Closed
 */
export function deriveTopicStatus(issueStatuses: IssueStatus[]): TopicStatus {
	if (issueStatuses.length === 0) return 'New';
	const allSettled = issueStatuses.every((s) => s === 'Resolved' || s === 'Closed');
	return allSettled ? 'Addressed' : 'Monitoring';
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(Math.max(value, 0), 1);
}
