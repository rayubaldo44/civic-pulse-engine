import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import { normalizeTopic } from '$lib/utils/priority';
import {
	buildTrendSeries,
	buildTrendSeriesFromCounts,
	getSinceIso,
	TREND_RANGES,
	type SentimentTrend,
	type TrendRange
} from '$lib/server/sentiment-trends';

// Keep in sync with VALID_TOPICS in src/routes/api/issues/+server.ts.
const VALID_TOPICS = new Set([
	'Infrastructure',
	'Healthcare',
	'Waste Management',
	'Public Safety',
	'Other'
]);

// Mirrors the raw_content.source_platform CHECK constraint in schema.sql.
const VALID_PLATFORMS = new Set(['facebook', 'youtube']);

interface TrendRow {
	sentiment_label: string | null;
	topic_label: string | null;
	processed_at: string;
	// Many-to-one FK join — can arrive as object, single-element array or null.
	raw_content?: { source_platform?: string | null } | { source_platform?: string | null }[] | null;
}

// RPC (get_sentiment_window_counts) result row.
interface TrendCountRowResult {
	civil_date: string;
	sentiment_label: string | null;
	topic_label: string | null;
	source_platform: string | null;
	count: number;
}

type PostgrestLikeError = { code?: string; message?: string };

// Migration 012 not applied yet — the RPC is missing. Fall back to the old
// full-window row fetch so the endpoint keeps working until migrations run.
function isMissingFunctionError(err: PostgrestLikeError): boolean {
	return err?.code === 'PGRST205' || /could not find the function/i.test(err?.message ?? '');
}

function joinedPlatform(row: TrendRow): string | null {
	const rc = Array.isArray(row.raw_content) ? row.raw_content[0] : row.raw_content;
	return rc?.source_platform ?? null;
}

/** Legacy full-window fetch (also the eager path for the bounded 'live' range). */
async function fetchTrendRows(
	supabase: ReturnType<typeof getServiceSupabase>,
	sinceIso: string
): Promise<TrendRow[]> {
	const { data, error } = await supabase
		.from('processed_content')
		.select('sentiment_label, topic_label, processed_at, raw_content(source_platform)')
		.gte('processed_at', sinceIso)
		.order('processed_at', { ascending: true });

	if (error) throw error;
	return (data ?? []) as TrendRow[];
}

// ── GET /api/sentiment-trends?range=weekly&topic=Healthcare&platform=facebook ─
// Sentiment trend series (Positive/Negative/Neutral) for the Sentiment
// Overview card. All params are whitelisted; invalid values are ignored
// (fall back to defaults) rather than rejected, matching GET /api/issues.
export const GET: RequestHandler = async ({ locals: { safeGetSession }, url }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const rangeParam = url.searchParams.get('range') ?? 'live';
	const range: TrendRange = (TREND_RANGES as readonly string[]).includes(rangeParam)
		? (rangeParam as TrendRange)
		: 'live';

	const topicParam = url.searchParams.get('topic') ?? '';
	const hasTopicFilter = VALID_TOPICS.has(topicParam);

	const platformParam = url.searchParams.get('platform') ?? '';
	const hasPlatformFilter = VALID_PLATFORMS.has(platformParam);

	try {
		const supabase = getServiceSupabase();
		const sinceIso = getSinceIso(range);

		// Non-live ranges are SQL-aggregated so only a few dozen (day ×
		// sentiment × topic × platform) count rows travel to the lambda
		// instead of every window row. 'live' keeps the bounded 7-day row
		// fetch because its hourly/daily buckets use server-local time and
		// can't be reproduced by the DB.
		let counts: TrendCountRowResult[] | null = null;
		let rows: TrendRow[] | null = null;

		if (range === 'live') {
			rows = await fetchTrendRows(supabase, sinceIso);
		} else {
			const rpc = (await (supabase.rpc as any)('get_sentiment_window_counts', {
				p_since: sinceIso
			})) as { data: TrendCountRowResult[] | null; error: PostgrestLikeError | null };
			if (rpc.error && isMissingFunctionError(rpc.error)) {
				rows = await fetchTrendRows(supabase, sinceIso);
			} else if (rpc.error) {
				throw rpc.error;
			} else {
				counts = (rpc.data ?? []) as TrendCountRowResult[];
			}
		}

		let trend: SentimentTrend;

		if (rows) {
			// Topic labels arrive as compound NLP variants ("Public Safety and
			// Peace and Order"), so filter after normalizeTopic — never eq() on
			// the canonical value in PostgREST.
			let filtered = rows;
			if (hasTopicFilter) {
				filtered = filtered.filter((r) => normalizeTopic(r.topic_label) === topicParam);
			}
			if (hasPlatformFilter) {
				filtered = filtered.filter((r) => joinedPlatform(r) === platformParam);
			}

			trend = buildTrendSeries(
				filtered.map((r) => ({ processed_at: r.processed_at, sentiment_label: r.sentiment_label })),
				range
			);
		} else {
			const filtered = (counts ?? []).filter((r) => {
				if (hasTopicFilter && normalizeTopic(r.topic_label) !== topicParam) return false;
				if (hasPlatformFilter && r.source_platform !== platformParam) return false;
				return true;
			});

			trend = buildTrendSeriesFromCounts(
				filtered.map((r) => ({
					date_key: r.civil_date,
					sentiment_label: r.sentiment_label,
					count: r.count
				})),
				range as Exclude<TrendRange, 'live'>
			);
		}

		return json(
			{
				range,
				generatedAt: new Date().toISOString(),
				labels: trend.labels,
				positive: trend.positive,
				negative: trend.negative,
				neutral: trend.neutral,
				mode: trend.mode
			},
			{
				headers: {
					'Cache-Control': 'private, max-age=30, stale-while-revalidate=60'
				}
			}
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error('[api/sentiment-trends] failed:', message);
		return json({ error: message }, { status: 500 });
	}
};
