// src/lib/server/trend-evaluator.ts
//
// The impure shell around the pure diff in $lib/server/trend-diff.ts. This
// module owns persistence; trend-diff.ts owns all decision logic.
//
// ── Why evaluation happens here, on read ────────────────────────────────────
// The project has no scheduler: no pg_cron, no Vercel cron, no Supabase
// Realtime. Rather than add infrastructure, the notification poll evaluates
// trends on the way through and compares them to the caller's stored snapshot
// (notification_snapshots). Unchanged polls emit nothing, so the cost of an
// idle evaluation is one window-stats query.
//
// ── The catch-up sweep ──────────────────────────────────────────────────────
// A pure on-read diff only ever notifies users who happen to be polling —
// which is the one case a "trend" alert does not need to serve. The first
// poller after a quiet period therefore evaluates on behalf of every active
// profile before serving its own request, so alerts accumulate for staff who
// haven't logged in and their email preference has something to deliver.
//
// claim_trend_evaluation_sweep() uses a conditional UPDATE as a lock, so
// concurrent pollers cannot both win; the loser skips straight to its own
// evaluation.
//
// Server-only (lives under $lib/server/) so Vite blocks any client import.

import { getServiceSupabase } from '$lib/server/supabase';
import { fetchTopicPriorities, type TopicPrioritiesResult } from '$lib/server/topic-window-stats';
import {
	diffTopicPriorities,
	type TopicSnapshot,
	type TrendAlertDraft
} from '$lib/server/trend-diff';
import { getPrefs, pruneReadNotifications } from '$lib/server/notifications';
import { notifyTrendAlertEmail } from '$lib/server/notify';
import { isChannelEnabled } from '$lib/types/notifications';
import type { TopicPriority } from '$lib/utils/priority';

/** The window alerts are evaluated over. Matches /api/priorities' default. */
export const TREND_WINDOW_DAYS = 30;

/** Minimum gap between catch-up sweeps, mirroring the poll interval. */
const SWEEP_INTERVAL_SECONDS = 900;

/** Sample rate for retention pruning — 1 in N evaluations. */
const PRUNE_EVERY = 20;

let evaluationsSincePrune = 0;

export interface EvaluationSummary {
	alertsCreated: number;
	baselineEstablished: boolean;
}

/**
 * Evaluate trends for one user against their stored snapshot, persisting any
 * alerts and advancing their baseline.
 *
 * Never throws: evaluation is a side effect of reading the notification feed,
 * so a failure here must degrade to "no new alerts" rather than break the
 * request. Alert creation is idempotent via the fingerprint unique index, so a
 * partially-completed evaluation cannot produce duplicates on retry.
 */
export async function evaluateTrendsForUser(
	userId: string,
	windowDays: number = TREND_WINDOW_DAYS,
	precomputed?: TopicPrioritiesResult
): Promise<EvaluationSummary> {
	const summary: EvaluationSummary = {
		alertsCreated: 0,
		baselineEstablished: false
	};

	try {
		const [{ priorities, engagementAvailable }, previous, prefs] = await Promise.all([
			precomputed ?? fetchTopicPriorities(windowDays),
			loadSnapshots(userId, windowDays),
			getPrefs(userId)
		]);

		// A degraded score (no engagement data) still drives alerts, but log it
		// once per evaluation so a misconfigured DB is visible rather than
		// silently skewing every threshold crossing.
		if (!engagementAvailable) {
			console.debug(
				'[trend-evaluator] scoring without engagement (apply 004_issue_prioritization.sql)'
			);
		}

		const diff = diffTopicPriorities(priorities, previous, windowDays);
		summary.baselineEstablished = diff.baselineEstablished;

		// Diagnostic breadcrumb: retuning thresholds is impossible without
		// knowing what the engine actually observed and why it stayed quiet.
		logDecisions(priorities, previous, diff.alerts, windowDays);

		if (diff.alerts.length > 0) {
			const wantsInApp = isChannelEnabled(prefs, 'trend_alert', 'in_app');
			const wantsEmail = isChannelEnabled(prefs, 'trend_alert', 'email');

			for (const draft of diff.alerts) {
				if (wantsInApp && (await enqueue(userId, draft))) summary.alertsCreated++;
				if (wantsEmail) {
					// Fire-and-forget: notifyTrendAlertEmail swallows its own
					// errors, and holding the response open for SMTP is wrong.
					void notifyTrendAlertEmail({
						userId,
						title: draft.title,
						body: draft.body,
						href: draft.href,
						severity: draft.severity
					});
				}
			}
		}

		await saveSnapshots(userId, windowDays, diff.nextSnapshots);
		maybePrune();

		return summary;
	} catch (err) {
		console.error('[trend-evaluator] evaluation failed:', err);
		return summary;
	}
}

/**
 * Run the catch-up sweep for every active profile, then evaluate the caller.
 *
 * Called on the notification poll. Only one concurrent caller wins the sweep
 * lock; the rest fall through to their own evaluation, which is cheap.
 */
export async function evaluateTrendsWithSweep(
	userId: string,
	windowDays: number = TREND_WINDOW_DAYS
): Promise<EvaluationSummary> {
	try {
		if (await claimSweep()) {
			const [stats, others] = await Promise.all([
				fetchTopicPriorities(windowDays),
				listActiveProfileIds()
			]);
			await Promise.all(others.map((id) => evaluateTrendsForUser(id, windowDays, stats)));
			return { alertsCreated: 0, baselineEstablished: false };
		}
	} catch (err) {
		console.error('[trend-evaluator] catch-up sweep failed:', err);
	}
	return evaluateTrendsForUser(userId, windowDays);
}

// ── Persistence helpers ─────────────────────────────────────────────────────

async function loadSnapshots(userId: string, windowDays: number): Promise<TopicSnapshot[]> {
	const supabase = getServiceSupabase();
	const { data, error } = await (supabase.from('notification_snapshots') as any)
		.select('topic, score, rank, negativity, comment_count')
		.eq('user_id', userId)
		.eq('window_days', windowDays);

	if (error) throw new Error(`load snapshots: ${error.message}`);

	return (
		(data ?? []) as {
			topic: string;
			score: number;
			rank: number;
			negativity: number;
			comment_count: number;
		}[]
	).map((row) => ({
		topic: row.topic,
		score: row.score,
		rank: row.rank,
		negativity: row.negativity,
		commentCount: row.comment_count
	}));
}

async function saveSnapshots(
	userId: string,
	windowDays: number,
	snapshots: TopicSnapshot[]
): Promise<void> {
	if (snapshots.length === 0) return;
	const supabase = getServiceSupabase();
	const capturedAt = new Date().toISOString();

	const { error } = await (supabase.from('notification_snapshots') as any).upsert(
		snapshots.map((s) => ({
			user_id: userId,
			window_days: windowDays,
			topic: s.topic,
			score: s.score,
			rank: s.rank,
			negativity: s.negativity,
			comment_count: s.commentCount,
			captured_at: capturedAt
		})),
		{ onConflict: 'user_id,window_days,topic' }
	);

	if (error) throw new Error(`save snapshots: ${error.message}`);
}

/**
 * Insert one alert via the enqueue_notification RPC.
 *
 * Returns true when a row was created, false when the RPC declined (prefs
 * opt-out) or the fingerprint already exists. The RPC is SECURITY DEFINER and
 * revoked from `authenticated` — see migration 014 — because it takes an
 * arbitrary p_user_id and must only ever be reachable service-side.
 */
async function enqueue(userId: string, draft: TrendAlertDraft): Promise<boolean> {
	const supabase = getServiceSupabase();
	const { data, error } = await (supabase.rpc as any)('enqueue_notification', {
		p_user_id: userId,
		p_category: draft.category,
		p_severity: draft.severity,
		p_title: draft.title,
		p_body: draft.body,
		p_href: draft.href,
		p_fingerprint: draft.fingerprint
	});

	if (error) {
		console.error('[trend-evaluator] enqueue failed:', error.message);
		return false;
	}
	// The function returns the new id, or NULL when it declined.
	return typeof data === 'string';
}

async function claimSweep(): Promise<boolean> {
	const supabase = getServiceSupabase();
	const { data, error } = await (supabase.rpc as any)('claim_trend_evaluation_sweep', {
		p_min_interval_seconds: SWEEP_INTERVAL_SECONDS
	});
	if (error) {
		console.error('[trend-evaluator] sweep claim failed:', error.message);
		return false;
	}
	return data === true;
}

async function listActiveProfileIds(): Promise<string[]> {
	const supabase = getServiceSupabase();
	const { data, error } = await (supabase.from('profiles') as any).select('id');
	if (error) {
		console.error('[trend-evaluator] profile list failed:', error.message);
		return [];
	}
	return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

function maybePrune(): void {
	evaluationsSincePrune++;
	if (evaluationsSincePrune < PRUNE_EVERY) return;
	evaluationsSincePrune = 0;
	void pruneReadNotifications();
}

function logDecisions(
	priorities: TopicPriority[],
	previous: TopicSnapshot[],
	alerts: TrendAlertDraft[],
	windowDays: number
): void {
	const prevByTopic = new Map(previous.map((s) => [s.topic, s]));
	for (const p of priorities) {
		const prev = prevByTopic.get(p.topic);
		const fired = alerts
			.filter((a) => a.topic === p.topic)
			.map((a) => a.rule)
			.join(',');
		console.debug(
			`[trend-evaluator] ${windowDays}d ${p.topic}: score=${p.score} (was ${prev?.score ?? 'none'}) ` +
				`rank=${p.rank} neg=${p.negativityComponent.toFixed(2)} n=${p.commentCount}` +
				(fired ? ` → ${fired}` : ' → quiet')
		);
	}
}
