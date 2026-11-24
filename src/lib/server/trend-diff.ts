// src/lib/server/trend-diff.ts
//
// Pure detection of topic-priority trend crossings.
//
// Pure module (no Supabase imports) so it is unit-testable in isolation, the
// same boundary $lib/server/accuracy.ts draws. The caller
// ($lib/server/trend-evaluator.ts) loads snapshots from the DB, calls
// diffTopicPriorities(), persists the drafts, and upserts nextSnapshots.
//
// ── Why a diff and not a scheduler ──────────────────────────────────────────
// There is no pg_cron, no Vercel cron and no Supabase Realtime in this
// project. Rather than add infrastructure, evaluation happens on read: each
// notification poll recomputes priorities and compares them against the
// caller's stored snapshot. Unchanged polls emit nothing.
//
// ── Tuning ─────────────────────────────────────────────────────────────────
// The thresholds below are deliberately a single exported object so they can be
// retuned in one place. IMPORTANT: computeTopicPriorities() min-max normalizes
// against the busiest topic in the window, so a quiet week compresses every
// score toward zero and HIGH_SCORE will stop firing entirely. That is why
// SCORE_HIGH_MIN_COMMENTS exists — without it, a topic with three comments and
// a 100% negative rate would outrank everything and trigger a "critical" alert.
//
// When retuning, also TRUNCATE notification_snapshots: existing fingerprints
// suppress re-firing, so the first poll after a threshold change under-fires.

import { MIN_SUPPORT, TOPIC_DISPLAY_NAMES, type TopicPriority } from '$lib/utils/priority';
import type { NotificationSeverity } from '$lib/types/notifications';

export const TREND_RULES = {
	/** Score at/above this counts as "hot". */
	HIGH_SCORE: 70,
	/** Absolute score movement between polls that counts as a jump. */
	SCORE_JUMP: 20,
	/** Negativity rate at/above this counts as a spike. */
	NEGATIVITY_SPIKE: 0.6,
	/**
	 * Absolute comment floor for the hot-score rules. Guards against
	 * min-max normalization letting a tiny sample dominate a quiet window.
	 */
	SCORE_HIGH_MIN_COMMENTS: 8
} as const;

export type TrendRuleId =
	'score-high' | 'score-drop' | 'score-jump' | 'new-leader' | 'negativity-spike';

export const TREND_RULE_IDS: TrendRuleId[] = [
	'score-high',
	'score-drop',
	'score-jump',
	'new-leader',
	'negativity-spike'
];

/** One topic's stored state at the previous evaluation. */
export interface TopicSnapshot {
	topic: string;
	score: number;
	rank: number;
	negativity: number;
	commentCount: number;
}

/** A pending alert, not yet persisted. */
export interface TrendAlertDraft {
	category: 'trend_alert';
	severity: NotificationSeverity;
	rule: TrendRuleId;
	topic: string;
	title: string;
	body: string;
	href: string;
	/** Dedupe key. Combined with user_id in a partial unique index. */
	fingerprint: string;
}

export interface TrendDiffResult {
	alerts: TrendAlertDraft[];
	/** Snapshots to persist as this user's new baseline. */
	nextSnapshots: TopicSnapshot[];
	/** True when no prior snapshot existed — baseline written, nothing emitted. */
	baselineEstablished: boolean;
}

function displayName(topic: string): string {
	return TOPIC_DISPLAY_NAMES[topic] ?? topic;
}

function toSnapshot(p: TopicPriority): TopicSnapshot {
	return {
		topic: p.topic,
		score: p.score,
		rank: p.rank,
		negativity: p.negativityComponent,
		commentCount: p.commentCount
	};
}

function fingerprint(topic: string, windowDays: number, rule: TrendRuleId): string {
	return `trend:${topic}:${windowDays}:${rule}`;
}

/** Link into the dashboard, pre-filtered to the topic that moved. */
function topicHref(topic: string): string {
	return `/Authenticated/dashboard?topic=${encodeURIComponent(topic)}`;
}

function makeDraft(
	rule: TrendRuleId,
	topic: string,
	severity: NotificationSeverity,
	title: string,
	body: string,
	windowDays: number
): TrendAlertDraft {
	return {
		category: 'trend_alert',
		severity,
		rule,
		topic,
		title,
		body,
		href: topicHref(topic),
		fingerprint: fingerprint(topic, windowDays, rule)
	};
}

/**
 * Compare current priorities against the caller's previous snapshot.
 *
 * `previous` may be empty (first ever evaluation) — in that case a baseline is
 * written and NO alerts are emitted. Without this guard every user would
 * receive a bogus "everything just spiked" alert on their first login.
 *
 * Topics present now but absent from `previous` (or vice versa) are treated as
 * brand new / resolved and deliberately do not fire score rules, since there is
 * no prior score to have crossed a threshold.
 */
export function diffTopicPriorities(
	current: TopicPriority[],
	previous: TopicSnapshot[],
	windowDays: number
): TrendDiffResult {
	const nextSnapshots = current.map(toSnapshot);

	if (previous.length === 0) {
		return { alerts: [], nextSnapshots, baselineEstablished: true };
	}

	const prevByTopic = new Map(previous.map((s) => [s.topic, s]));
	const prevRank1 = previous.find((s) => s.rank === 1)?.topic ?? null;

	const alerts: TrendAlertDraft[] = [];
	const nowRank1 = current.length > 0 ? current[0].topic : null;

	for (const p of current) {
		const prev = prevByTopic.get(p.topic);
		const name = displayName(p.topic);

		// ── new-leader ──────────────────────────────────────────────────────
		// Only when the leader genuinely changed hands; rank 1 staying rank 1
		// is not news.
		if (p.rank === 1 && nowRank1 !== prevRank1) {
			alerts.push(
				makeDraft(
					'new-leader',
					p.topic,
					'info',
					`${name} is now the top issue`,
					`${name} took the #1 priority rank in the last ${windowDays} days ` +
						`(score ${p.score}, ${p.commentCount} comments).`,
					windowDays
				)
			);
		}

		if (!prev) continue; // no baseline for this topic — nothing to cross

		// ── score-high / score-drop (threshold crossings) ───────────────────
		const isHigh = p.score >= TREND_RULES.HIGH_SCORE;
		const wasHigh = prev.score >= TREND_RULES.HIGH_SCORE;
		// The comment floor only gates entry into "hot" — dropping out of a hot
		// score is always worth reporting, even for a small topic.
		const hasFloor = p.commentCount >= TREND_RULES.SCORE_HIGH_MIN_COMMENTS;

		if (isHigh && !wasHigh && hasFloor) {
			alerts.push(
				makeDraft(
					'score-high',
					p.topic,
					'critical',
					`${name} priority score is now high`,
					`${name} crossed into high priority at ${p.score}/100 (up from ${prev.score}) ` +
						`across ${p.commentCount} comments. ${Math.round(p.negativityComponent * 100)}% negative.`,
					windowDays
				)
			);
		} else if (!isHigh && wasHigh) {
			alerts.push(
				makeDraft(
					'score-drop',
					p.topic,
					'info',
					`${name} priority score is easing`,
					`${name} fell below the high-priority threshold to ${p.score}/100 (down from ${prev.score}).`,
					windowDays
				)
			);
		}

		// ── score-jump ──────────────────────────────────────────────────────
		// Direction-agnostic: a collapse is as actionable as a spike.
		const delta = p.score - prev.score;
		if (Math.abs(delta) >= TREND_RULES.SCORE_JUMP) {
			const direction = delta > 0 ? 'rose' : 'fell';
			alerts.push(
				makeDraft(
					'score-jump',
					p.topic,
					delta > 0 ? 'warning' : 'info',
					`${name} priority score ${direction} sharply`,
					`${name} moved ${Math.abs(delta)} points over the last ${windowDays} days ` +
						`(${prev.score} → ${p.score}).`,
					windowDays
				)
			);
		}

		// ── negativity-spike ────────────────────────────────────────────────
		// Gated on MIN_SUPPORT so three negative comments out of three does not
		// read as a 100% crisis — the same floor the Prioritization card uses.
		if (p.negativityComponent >= TREND_RULES.NEGATIVITY_SPIKE && p.commentCount >= MIN_SUPPORT) {
			alerts.push(
				makeDraft(
					'negativity-spike',
					p.topic,
					'warning',
					`${name} sentiment is heavily negative`,
					`${Math.round(p.negativityComponent * 100)}% of ${p.commentCount} ${name} comments ` +
						`in the last ${windowDays} days are negative.`,
					windowDays
				)
			);
		}
	}

	return { alerts, nextSnapshots, baselineEstablished: false };
}
