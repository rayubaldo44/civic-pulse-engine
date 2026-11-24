// src/lib/server/topic-window-stats.ts
//
// Windowed topic-priority computation, shared by GET /api/priorities and the
// trend-alert evaluator.
//
// This module owns the single code path that turns processed_content rows into
// ranked TopicPriority values. Extracted so a trend alert can never quote a
// score that differs from the one the Prioritization card renders — the alert
// text and the widget are generated from the same call.
//
// The window is a ROLLING INSTANT window (`now - days * 86_400_000`), not
// Manila civil days. That is deliberate and must not be "fixed": the
// Asia/Manila rule in $lib/server/sentiment-trends.ts governs *bucketing*
// (assigning a row to a chart column), not a `since` filter. A rolling instant
// `since` is timezone-independent. Using civil-day bounds here would make
// alerts disagree with /api/priorities, which is the exact bug this module
// exists to prevent.
//
// Graceful degradation is load-bearing and must be preserved: migrations 004
// (raw_content.reaction_count/reply_count) and 012 (get_topic_window_stats) may
// not be applied yet, in which case scoring proceeds without engagement.

import { getServiceSupabase } from '$lib/server/supabase';
import {
	computeTopicPriorities,
	normalizeTopic,
	type TopicPriority,
	type TopicWindowStats
} from '$lib/utils/priority';

const DAY_MS = 86_400_000;

export interface WindowRow {
	topic_label: string | null;
	sentiment_label: string | null;
	raw_content?: { reaction_count: number | null; reply_count: number | null } | null;
}

// get_topic_window_stats RPC rows.
interface TopicWindowStatsRow {
	topic_label: string | null;
	comment_count: number;
	negative_count: number;
	engagement_count: number;
}

// get_topic_window_stats_basic RPC rows (migration 004 not applied).
interface TopicWindowStatsBasicRow {
	topic_label: string | null;
	comment_count: number;
	negative_count: number;
}

// Per raw topic_label aggregation the two RPC paths compress into.
interface PerLabelStat {
	topic_label: string | null;
	commentCount: number;
	negativeCount: number;
	engagementCount: number;
}

type PostgrestLikeError = { code?: string; message?: string };

// Postgres 42703 = undefined_column. Happens when migration 004
// (raw_content.reaction_count / reply_count) has not been applied yet.
function isUndefinedColumnError(err: PostgrestLikeError): boolean {
	return err?.code === '42703' || /does not exist/i.test(err?.message ?? '');
}

// Migration 012 not applied yet — the RPC is missing. Fall back to the old
// full-window row fetch so callers keep working until migrations run.
function isMissingFunctionError(err: PostgrestLikeError): boolean {
	return err?.code === 'PGRST205' || /could not find the function/i.test(err?.message ?? '');
}

export interface TopicPrioritiesResult {
	priorities: TopicPriority[];
	/** False when migration 004 is unapplied and the score omits engagement. */
	engagementAvailable: boolean;
	/** Rolling-window lower bound, ISO 8601. */
	sinceIso: string;
}

/**
 * Ranked topic priorities over the trailing `days`-day window.
 *
 * Aggregation runs in SQL (per raw topic_label counts) so the serverless
 * function receives a handful of rows rather than every window row. NLP labels
 * still arrive as compound variants ("Public Safety and Peace and Order"), so
 * the compact per-raw-label groups are folded through normalizeTopic()
 * afterward on the small result — never eq()-filtered on canonical values.
 */
export async function fetchTopicPriorities(
	days: number,
	now: Date = new Date()
): Promise<TopicPrioritiesResult> {
	const sinceIso = new Date(now.getTime() - days * DAY_MS).toISOString();
	const supabase = getServiceSupabase();

	// Aggregate the window in SQL: SQL-side per-raw-label counts return a
	// handful of rows instead of every window row.
	let perLabel: PerLabelStat[] | null = null;
	let engagementAvailable = true;

	const rpc = (await (supabase.rpc as any)('get_topic_window_stats', {
		p_since: sinceIso
	})) as { data: TopicWindowStatsRow[] | null; error: PostgrestLikeError | null };
	if (rpc.error) {
		if (isMissingFunctionError(rpc.error)) {
			perLabel = null; // legacy row fetch below
		} else if (isUndefinedColumnError(rpc.error)) {
			// Migration 004 pending — fall back to the engagement-less variant.
			console.warn(
				'[topic-window-stats] engagement columns missing (apply 004_issue_prioritization.sql); scoring without engagement'
			);
			engagementAvailable = false;
			const fallback = (await (supabase.rpc as any)('get_topic_window_stats_basic', {
				p_since: sinceIso
			})) as { data: TopicWindowStatsBasicRow[] | null; error: PostgrestLikeError | null };
			if (fallback.error) throw fallback.error;
			perLabel = ((fallback.data ?? []) as TopicWindowStatsBasicRow[]).map((r) => ({
				topic_label: r.topic_label,
				commentCount: r.comment_count,
				negativeCount: r.negative_count,
				engagementCount: 0
			}));
		} else {
			throw rpc.error;
		}
	} else {
		perLabel = ((rpc.data ?? []) as TopicWindowStatsRow[]).map((r) => ({
			topic_label: r.topic_label,
			commentCount: r.comment_count,
			negativeCount: r.negative_count,
			engagementCount: r.engagement_count
		}));
	}

	// ── Fold per-raw-label stats into canonical-topic stats ──────────────────
	const statsByTopic = new Map<string, TopicWindowStats>();

	if (perLabel) {
		// RPC rows are already grouped per raw topic_label — add their counts.
		for (const row of perLabel) {
			const stat = bucket(statsByTopic, row);
			stat.commentCount += row.commentCount;
			stat.negativeCount += row.negativeCount;
			stat.engagementCount += row.engagementCount;
		}
	} else {
		// Legacy fallback — migration 012 pending: fetch the whole window and
		// aggregate rows in JS (previous behaviour, kept for deploy safety).
		const buildQuery = (select: string) =>
			supabase
				.from('processed_content')
				.select(select)
				.gte('processed_at', sinceIso)
				.not('topic_label', 'is', null)
				.order('processed_at', { ascending: true });

		let rows: WindowRow[] | null;
		const joined = await buildQuery(
			'topic_label, sentiment_label, raw_content (reaction_count, reply_count)'
		);
		if (joined.error) {
			if (!isUndefinedColumnError(joined.error)) throw joined.error;
			console.warn(
				'[topic-window-stats] engagement columns missing (apply 004_issue_prioritization.sql); scoring without engagement'
			);
			engagementAvailable = false;
			const retry = await buildQuery('topic_label, sentiment_label');
			if (retry.error) throw retry.error;
			rows = (retry.data ?? []) as WindowRow[];
		} else {
			rows = (joined.data ?? []) as WindowRow[];
		}

		for (const row of rows ?? []) {
			// Legacy path rows are single records — count each one.
			const stat = bucket(statsByTopic, row);
			stat.commentCount++;
			if (row.sentiment_label === 'negative') stat.negativeCount++;
			if (!engagementAvailable) continue;

			// Supabase many-to-one joins can arrive as object, single-element
			// array, or null depending on relationship resolution — normalise.
			const rc = Array.isArray(row.raw_content) ? row.raw_content[0] : row.raw_content;
			stat.engagementCount += Math.max(rc?.reaction_count ?? 0, 0);
			stat.engagementCount += Math.max(rc?.reply_count ?? 0, 0);
		}
	}

	return {
		priorities: computeTopicPriorities(Array.from(statsByTopic.values())),
		engagementAvailable,
		sinceIso
	};
}

/** Resolve (creating on first sight) the canonical bucket a raw label folds into. */
function bucket(
	statsByTopic: Map<string, TopicWindowStats>,
	row: { topic_label: string | null }
): TopicWindowStats {
	const topic = normalizeTopic(row.topic_label);

	let stat = statsByTopic.get(topic);
	if (!stat) {
		stat = { topic, commentCount: 0, negativeCount: 0, engagementCount: 0 };
		statsByTopic.set(topic, stat);
	}
	return stat;
}
