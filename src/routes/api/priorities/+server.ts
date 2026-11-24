// GET /api/priorities?topic=Infrastructure&days=30
// Ranked topic priority scores over a time window.
// Both params are whitelisted: unknown topic values are ignored (matching
// GET /api/issues filter behaviour); days outside {7,30,90} falls back to 30.
//
// Windowed scoring itself lives in $lib/server/topic-window-stats.ts so the
// trend-alert evaluator computes priorities through the exact same code path —
// an alert can never quote a score the Prioritization card wouldn't show.

import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchTopicPriorities } from '$lib/server/topic-window-stats';
import { deriveTopicStatus } from '$lib/utils/priority';
import type { IssueStatus } from '$lib/types/issues';
import { getServiceSupabase } from '$lib/server/supabase';

const VALID_TOPICS = new Set([
	'Infrastructure',
	'Healthcare',
	'Waste Management',
	'Public Safety',
	'Other'
]);

const VALID_RANGE_DAYS = new Set([7, 30, 90]);
const DEFAULT_DAYS = 30;

export const GET: RequestHandler = async ({ locals: { safeGetSession }, url }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	try {
		const topicParam = url.searchParams.get('topic') ?? '';
		const hasTopicFilter = VALID_TOPICS.has(topicParam);

		const daysParam = Number.parseInt(url.searchParams.get('days') ?? '', 10);
		const days = VALID_RANGE_DAYS.has(daysParam) ? daysParam : DEFAULT_DAYS;

		const { priorities: scored, engagementAvailable, sinceIso } = await fetchTopicPriorities(days);

		const priorities = hasTopicFilter ? scored.filter((p) => p.topic === topicParam) : scored;

		// ── Derive workflow status from civic_issues per ranked topic ─────────
		const supabase = getServiceSupabase();
		const rankedTopics = priorities.map((p) => p.topic);
		const statusesByTopic = new Map<string, IssueStatus[]>();

		if (rankedTopics.length > 0) {
			const { data: issueRows, error: issuesError } = await supabase
				.from('civic_issues')
				.select('topic, status')
				.in('topic', rankedTopics);

			if (issuesError) throw issuesError;

			for (const row of (issueRows ?? []) as { topic: string | null; status: IssueStatus }[]) {
				if (!row.topic) continue;
				const list = statusesByTopic.get(row.topic) ?? [];
				list.push(row.status);
				statusesByTopic.set(row.topic, list);
			}
		}

		return json(
			{
				range: { days, since: sinceIso },
				generatedAt: new Date().toISOString(),
				engagementAvailable,
				priorities: priorities.map((p) => ({
					...p,
					status: deriveTopicStatus(statusesByTopic.get(p.topic) ?? [])
				}))
			},
			{
				headers: {
					'Cache-Control': 'private, max-age=30, stale-while-revalidate=60'
				}
			}
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error('[api/priorities] failed:', message);
		return json({ error: message }, { status: 500 });
	}
};
