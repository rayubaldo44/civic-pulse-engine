// src/routes/Authenticated/live-data-stream/+page.server.ts
// Loads processed_content joined to raw_content for the live data stream view.
// Ordered newest first; limited to 100 rows for client-side filtering performance.
//
// Optional URL params narrow the feed to a date window (validated server-side):
//   ?range=all|weekly|monthly|yearly|custom   (default: all)
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD            (custom only; Manila civil days)
// Invalid values silently fall back to defaults — never rejected.

import { getServiceSupabase } from '$lib/server/supabase';
import {
	getDateWindow,
	DATE_FILTER_RANGES,
	type DateFilterRange
} from '$lib/server/sentiment-trends';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, depends }) => {
	// Scoped dependency: 60s polling invalidates only this query, never the
	// whole layout (keeps pendingCount/sidebar queries out of the poll path).
	depends('live-stream:feed');

	const rangeParam = url.searchParams.get('range') ?? 'all';
	const range: DateFilterRange = (DATE_FILTER_RANGES as readonly string[]).includes(rangeParam)
		? (rangeParam as DateFilterRange)
		: 'all';

	const { sinceIso, untilIso } = getDateWindow(
		range,
		url.searchParams.get('from'),
		url.searchParams.get('to')
	);

	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');

	const supabase = getServiceSupabase();
	let query = supabase
		.from('processed_content')
		.select(
			`
			id,
			cleaned_text,
			sentiment_label,
			sentiment_score,
			topic_label,
			is_flagged,
			language,
			processed_at,
			raw_content (
				source_platform,
				raw_text,
				created_at
			),
			flagged_claims (
				rag_determination,
				status
			)
		`
		)
		// flagged_claims FK is on flagged_claims.processed_content_id → returns as array
		// raw_content FK is on processed_content.raw_content_id → returns as object
		.order('processed_at', { ascending: false })
		.limit(100);

	if (sinceIso) query = query.gte('processed_at', sinceIso);
	if (untilIso) query = query.lte('processed_at', untilIso);

	const { data, error } = await query;

	if (error) {
		console.error('[live-stream] load error:', error.message);
		// Degrade to empty feed but surface a user-safe banner message —
		// internal error details stay in the server log only. Echo the raw
		// from/to params so a transient error doesn't wipe picked dates.
		return {
			streamItems: [],
			appliedRange: range,
			appliedFrom: fromParam,
			appliedTo: toParam,
			loadError: 'Could not load the feed. It will retry automatically.'
		};
	}

	return {
		streamItems: data ?? [],
		appliedRange: range,
		appliedFrom: fromParam,
		appliedTo: toParam,
		loadError: null
	};
};
