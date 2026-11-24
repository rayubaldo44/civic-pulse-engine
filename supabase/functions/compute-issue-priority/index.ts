// supabase/functions/compute-issue-priority/index.ts
//
// Called after a processed_content row is written by process-comment.
// Computes a priority score from NLP labels and auto-creates a civic_issues row.
//
// Invocation (POST):
//   { "processed_content_id": "<uuid>" }
//   or batch: { "processed_content_ids": ["<uuid>", ...] }
//
// Returns:
//   { "created": true,  "issue_id": "<uuid>" }
//   { "created": false, "reason": "duplicate" }
//   { "created": false, "reason": "not_found" }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeTopic } from '../support/topic.ts';

// ── Env ──────────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SYSTEM_USER_ID = Deno.env.get('SYSTEM_USER_ID') ?? null;

// ── Types ─────────────────────────────────────────────────────────────────────
type Priority = 'Critical' | 'High' | 'Medium' | 'Low';

interface ProcessedRow {
	id: string;
	cleaned_text: string | null;
	sentiment_label: string | null;
	topic_label: string | null;
}

interface FlaggedClaimRow {
	rag_determination: string | null;
}

// ── Scoring ───────────────────────────────────────────────────────────────────
function computePriority(
	sentiment: string | null,
	topic: string | null,
	ragDetermination: string | null
): { score: number; priority: Priority } {
	let score = 0;

	if (sentiment === 'negative') score += 2;
	// NLP emits compound topic variants ("Infrastructure and Public Works") —
	// normalize before comparing so infra/health never miss the bonus.
	const canonicalTopic = normalizeTopic(topic);
	if (canonicalTopic === 'Infrastructure' || canonicalTopic === 'Healthcare') score += 2;
	if (ragDetermination === 'Refuted') score += 3;

	// Future: comment volume spike → +1 (placeholder — logged only, not scored)
	console.log('[compute-issue-priority] volume spike check: not yet implemented');

	let priority: Priority;
	if (score >= 5) priority = 'Critical';
	else if (score >= 3) priority = 'High';
	else if (score >= 1) priority = 'Medium';
	else priority = 'Low';

	return { score, priority };
}

// ── Core logic — one processed_content_id ─────────────────────────────────────
async function processOne(
	processedContentId: string,
	supabase: ReturnType<typeof createClient>
): Promise<{ created: boolean; issue_id?: string; reason?: string }> {
	// ── 1. Idempotency check ───────────────────────────────────────────────────
	const { data: existing } = await supabase
		.from('civic_issues')
		.select('id')
		.eq('source_comment_id', processedContentId)
		.maybeSingle();

	if (existing) {
		return { created: false, reason: 'duplicate' };
	}

	// ── 2. Fetch NLP output ────────────────────────────────────────────────────
	const { data: processed, error: fetchError } = await supabase
		.from('processed_content')
		.select('id, cleaned_text, sentiment_label, topic_label')
		.eq('id', processedContentId)
		.maybeSingle();

	if (fetchError || !processed) {
		console.error('[compute-issue-priority] processed_content not found:', processedContentId);
		return { created: false, reason: 'not_found' };
	}

	const row = processed as ProcessedRow;

	// ── 3. Fetch RAG determination (may not exist if no claim detected) ─────────
	const { data: claimRow } = await supabase
		.from('flagged_claims')
		.select('rag_determination')
		.eq('processed_content_id', processedContentId)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	const ragDetermination = (claimRow as FlaggedClaimRow | null)?.rag_determination ?? null;

	// ── 4. Compute score + priority ────────────────────────────────────────────
	const { score, priority } = computePriority(
		row.sentiment_label,
		row.topic_label,
		ragDetermination
	);

	console.log(
		`[compute-issue-priority] id=${processedContentId} sentiment=${row.sentiment_label} ` +
			`topic=${row.topic_label} rag=${ragDetermination} score=${score} priority=${priority}`
	);

	// ── 5. Build title: first 80 chars of cleaned_text ────────────────────────
	const rawTitle = (row.cleaned_text ?? '').trim();
	const title = rawTitle.length > 80 ? rawTitle.slice(0, 80) + '...' : rawTitle || '(no text)';

	// ── 6. Insert civic_issues row ─────────────────────────────────────────────
	const { data: inserted, error: insertError } = await supabase
		.from('civic_issues')
		.insert({
			title,
			topic: normalizeTopic(row.topic_label),
			priority,
			status: 'Open',
			source_comment_id: processedContentId,
			created_by: SYSTEM_USER_ID
		})
		.select('id')
		.single();

	if (insertError || !inserted) {
		console.error('[compute-issue-priority] insert error:', insertError?.message);
		throw new Error(insertError?.message ?? 'Insert failed');
	}

	return { created: true, issue_id: inserted.id };
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
	if (req.method !== 'POST') {
		return new Response('Method not allowed', { status: 405 });
	}

	if (!req.headers.get('Authorization')) {
		return new Response('Unauthorized', { status: 401 });
	}

	const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

	let body: Record<string, unknown>;
	try {
		body = await req.json();
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Support single ID or batch array
	const ids: string[] = (() => {
		if (typeof body.processed_content_id === 'string') {
			return [body.processed_content_id];
		}
		if (Array.isArray(body.processed_content_ids)) {
			return body.processed_content_ids.filter((v): v is string => typeof v === 'string');
		}
		return [];
	})();

	if (ids.length === 0) {
		return new Response(
			JSON.stringify({ error: 'processed_content_id or processed_content_ids required' }),
			{ status: 400, headers: { 'Content-Type': 'application/json' } }
		);
	}

	try {
		if (ids.length === 1) {
			const result = await processOne(ids[0], supabase);
			return new Response(JSON.stringify(result), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Batch mode — process sequentially to avoid overwhelming the DB
		const results = [];
		for (const id of ids) {
			try {
				const r = await processOne(id, supabase);
				results.push({ processed_content_id: id, ...r });
			} catch (err) {
				results.push({
					processed_content_id: id,
					created: false,
					reason: err instanceof Error ? err.message : 'unknown_error'
				});
			}
		}

		return new Response(JSON.stringify({ results }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('[compute-issue-priority] unhandled error:', err);
		return new Response(
			JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
});
