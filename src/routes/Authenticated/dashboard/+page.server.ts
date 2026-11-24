// src/routes/Authenticated/dashboard/+page.server.ts
import { getServiceSupabase } from '$lib/server/supabase';
import { computeClaimAccuracyFromTally } from '$lib/server/accuracy';
import { buildTrendData } from '$lib/server/dashboard-trend';
import { cachedDashboardQuery, getDashboardFetchedAt } from '$lib/server/dashboard-cache';
import type { PageServerLoad } from './$types';

// ── Types ─────────────────────────────────────────────────────────────────────

// Aggregated stats per barangay for the heatmap
export type BarangayStat = {
	name: string;
	total: number;
	negative: number;
	flagged: number;
};

// Supabase FK join: processed_content_id → processed_content.id
// Returns a single object (not array) — can be null if row missing or RLS blocks
type JoinedProcessedContent = {
	cleaned_text: string | null;
	sentiment_label: string | null;
	topic_label: string | null;
	language: string | null;
} | null;

type FlaggedClaimRow = {
	id: string;
	claim_text: string;
	rag_determination: string | null;
	rag_evidence_snippet: string | null;
	status: string;
	created_at: string;
	source_platform: string | null;
	language: string | null;
	// Supabase join result — single object or null (many-to-one FK)
	processed_content: JoinedProcessedContent;
};

// Shape each streamed section resolves to. Re-exported so the page can type
// its await branches against the same shapes (Awaited<PageData['statData']>).
export type StatData = {
	totalCount: number;
	accuracyPct: number;
	verifiedAccuracy: ReturnType<typeof computeClaimAccuracyFromTally>;
	sentimentCounts: Record<string, number>;
};

export type ChartsData = {
	trendData: ReturnType<typeof buildTrendData>;
	topicCounts: Record<string, number>;
	totalCount: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Shape of the get_sentiment_counts / get_topic_counts RPC rows.
type CountRow = { label: string | null; count: number | null };

// Shape of the get_review_tally RPC rows (accuracy confusion matrix).
type ReviewTallyRow = { decision: string; rag_determination: string | null; count: number };

/** Turn aggregate RPC rows into the label→count map the UI consumes. */
function rowsToCounts(rows: CountRow[] | null | undefined): Record<string, number> {
	const out: Record<string, number> = {};
	for (const r of rows ?? []) {
		const key = r.label ?? 'Unknown';
		out[key] = (out[key] ?? 0) + (r.count ?? 0);
	}
	return out;
}

// ── Load ──────────────────────────────────────────────────────────────────────

export const load: PageServerLoad = async ({ depends }) => {
	depends('dashboard:summary');
	const summaryFetchedAt = getDashboardFetchedAt();
	const supabase = getServiceSupabase();
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

	// All queries are independent — fire them all without awaiting. Returning
	// them as top-level promises makes SvelteKit stream the page: the dashboard
	// shell (with per-section skeletons) renders immediately and each region
	// swaps to real data as its group of queries resolves. This works on first
	// visit (SSR flush) and on client-side navigation alike.
	// Sentiment/topic counts and the review tally are aggregated in SQL so only
	// the tiny summaries travel to the client (previously the server pulled and
	// re-serialized EVERY processed_content and review_records row). The all-time
	// aggregates are also served from a 45s in-process TTL cache so repeated
	// dashboard loads/logins on a warm instance skip the full-table rescans.
	const sentCountsP = cachedDashboardQuery<CountRow[]>('get_sentiment_counts', () =>
		supabase.rpc('get_sentiment_counts')
	);
	const topicCountsP = cachedDashboardQuery<CountRow[]>('get_topic_counts', () =>
		supabase.rpc('get_topic_counts')
	);
	const reviewTallyP = cachedDashboardQuery<ReviewTallyRow[]>('get_review_tally', () =>
		supabase.rpc('get_review_tally')
	);
	// 7-day trend window served from the same short-TTL cache as the aggregate
	// RPCs — this bounded query previously re-ran on EVERY dashboard load.
	const recentP = cachedDashboardQuery<{ processed_at: string; sentiment_label: string | null }[]>(
		'recent_trend_window',
		() =>
			supabase
				.from('processed_content')
				.select('sentiment_label, processed_at')
				.gte('processed_at', sevenDaysAgo)
				.order('processed_at', { ascending: true })
	);
	const totalP = cachedDashboardQuery<{ total: number }[]>('get_analytics_totals', () =>
		supabase.rpc('get_analytics_totals')
	);
	const barangayP = cachedDashboardQuery<BarangayStat[]>('get_barangay_stats', () =>
		supabase.rpc('get_barangay_stats')
	);
	const flaggedP = supabase
		.from('flagged_claims')
		.select(
			`
			id,
			claim_text,
			rag_determination,
			rag_evidence_snippet,
			status,
			created_at,
			source_platform,
			language,
			processed_content (
				cleaned_text,
				sentiment_label,
				topic_label,
				language
			)
		`
		)
		.eq('status', 'Pending')
		.order('created_at', { ascending: false })
		.limit(3);

	// ── Stat cards + sentiment breakdown ──────────────────────────────────────
	// Counts, accuracy and verified accuracy — all three fed by SQL aggregates
	// (get_sentiment_counts returns per-label counts; get_review_tally returns
	// the accuracy confusion matrix). No raw rows travel to the client.
	const statData: Promise<StatData> = Promise.all([totalP, sentCountsP, reviewTallyP]).then(
		([total, sentCounts, reviewTally]) => {
			if (total.error) {
				console.error('[dashboard] totalCount query failed:', total.error.message);
			}
			if (sentCounts.error) {
				console.error('[dashboard] sentiment counts query failed:', sentCounts.error.message);
			}
			if (reviewTally.error) {
				console.error('[dashboard] review tally query failed:', reviewTally.error.message);
			}

			const sentimentCounts = rowsToCounts((sentCounts.data ?? []) as CountRow[]);
			const totalCount = (total.data as { total: number }[] | null)?.[0]?.total ?? 0;

			// Accuracy estimate: (total − low-confidence flags) / total
			// "review" label = model was below 0.65 confidence threshold
			const reviewCount = sentimentCounts['review'] ?? 0;
			const accuracyPct =
				totalCount > 0 ? Math.round(((totalCount - reviewCount) / totalCount) * 100) : 0;

			const verifiedAccuracy = computeClaimAccuracyFromTally(
				(reviewTally.data ?? []) as {
					decision: string;
					rag_determination: string | null;
					count: number;
				}[]
			);

			return { totalCount, accuracyPct, verifiedAccuracy, sentimentCounts };
		}
	);

	// ── Charts row — trend series + topic distribution ───────────────────────
	// Sentiment trend needs the bounded 7-day window (recentP). Topic counts
	// come from the get_topic_counts RPC, not a full-table pull.
	const charts: Promise<ChartsData> = Promise.all([recentP, topicCountsP, totalP]).then(
		([recent, topicCounts, total]) => {
			if (recent.error) {
				console.error('[dashboard] recentData query failed:', recent.error.message);
			}
			if (topicCounts.error) {
				console.error('[dashboard] topic counts query failed:', topicCounts.error.message);
			}
			if (total.error) {
				console.error('[dashboard] totalCount query failed:', total.error.message);
			}

			return {
				trendData: buildTrendData(
					(recent.data ?? []) as { processed_at: string; sentiment_label: string | null }[]
				),
				topicCounts: rowsToCounts((topicCounts.data ?? []) as CountRow[]),
				totalCount: (total.data as { total: number }[] | null)?.[0]?.total ?? 0
			};
		}
	);

	// ── Recent pending flagged claims ─────────────────────────────────────────
	// Cast rawFlagged to our typed shape — Supabase join type inference is
	// complex; we validate the shape at runtime via nullish checks in the view.
	const flaggedClaims: Promise<FlaggedClaimRow[]> = Promise.resolve(flaggedP).then(
		({ data, error }) => {
			if (error) {
				console.error('[dashboard] flaggedClaims query failed:', error.message);
			}
			return (data ?? []) as unknown as FlaggedClaimRow[];
		}
	);

	// ── Barangay heatmap stats ────────────────────────────────────────────────
	// Pre-aggregated from the get_barangay_stats RPC (computed in SQL, ordered
	// by total descending) — no JS grouping needed.
	const barangayStats: Promise<BarangayStat[]> = Promise.resolve(barangayP).then(
		({ data, error }) => {
			if (error) {
				console.error('[dashboard] barangayRows query failed:', error.message);
			}
			return (data ?? []) as BarangayStat[];
		}
	);

	// NOTE: pendingCount is not loaded here — it's already computed by the
	// /Authenticated layout server load for the sidebar badge. The dashboard
	// reads it from the parent layout data to avoid a duplicated COUNT query.

	return { statData, charts, flaggedClaims, barangayStats, summaryFetchedAt };
};
