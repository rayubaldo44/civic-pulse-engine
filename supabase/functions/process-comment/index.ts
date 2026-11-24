// supabase/functions/process-comment/index.ts
//
// Civic Pulse Engine — NLP Processing Edge Function v1.4.0
//
// Flow:
//   1. Receive array of raw_content IDs to process
//   2. For each comment: call HF Space /preprocess first
//   3. Skip spam — call /sentiment, /topic-classification, /claim-detection on cleaned text
//   4. Write results to processed_content
//   5. If has_claim → RAG pipeline:
//      a. /embed claim → 768-dim vector
//      b. match_document_chunks() → top matching chunks from pgvector
//         (paragraph-level retrieval; dedup capped at 2 chunks per doc)
//      c. LLM → Supported / Refuted / Insufficient Evidence
//      d. Write to flagged_claims with determination + evidence snippet
//         (including matched_chunk_id for the exact evidence chunk)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseRagDetermination } from '../support/rag.ts';

// ── Config ──────────────────────────────────────────────────────────────
const HF_SPACE_URL = Deno.env.get('HF_SPACE_URL') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';

// ── Types ────────────────────────────────────────────────────────────────
interface RawContent {
	id: string;
	raw_text: string;
	source_platform: string;
	post_id: string;
	author_hash: string;
}

interface PreprocessResult {
	hashed_user_id: string;
	cleaned_text: string;
	language: string;
	is_spam: boolean;
}

interface SentimentResult {
	sentiment: string;
	confidence: number;
	needs_human_review: boolean;
}

interface TopicResult {
	topic: string;
	confidence: number;
	needs_human_review: boolean;
}

interface ClaimResult {
	has_claim: boolean;
	matched_patterns: string[];
}

interface MatchedChunk {
	chunk_id: string;
	document_id: string;
	chunk_index: number;
	chunk_text: string;
	section_label: string | null;
	title: string;
	document_type: string;
	uploaded_at: string;
	similarity: number;
}

type RagDetermination = 'Supported' | 'Refuted' | 'Insufficient Evidence';

interface RagResult {
	determination: RagDetermination;
	evidence_snippet: string;
	matched_document_id: string | null;
	matched_chunk_id: string | null;
}

// ── Barangay detection ───────────────────────────────────────────────────
// Scans cleaned comment text for the name of a Pulilan barangay.
// Uses a fixed allowlist — no user input reaches any query.
const PULILAN_BARANGAYS: readonly string[] = [
	'Alagao',
	'Aulaga',
	'Bagong Buhay',
	'Balubad',
	'Bambang',
	'Dampol 1st-A',
	'Dampol 2nd-A',
	'Dampol 2nd-B',
	'Dulong Malabon',
	'Inaon',
	'Lumbac',
	'Lunt',
	'Magnificat',
	'Marinig',
	'Niugan',
	'Poblacion',
	'Polo',
	'Remlo'
];

function detectBarangay(text: string): string | null {
	const lower = text.toLowerCase();
	for (const name of PULILAN_BARANGAYS) {
		if (lower.includes(name.toLowerCase())) return name;
	}
	return null;
}

// ── HF Space callers ─────────────────────────────────────────────────────
async function callPreprocess(
	text: string,
	userId: string,
	commentId: string
): Promise<PreprocessResult> {
	const res = await fetch(`${HF_SPACE_URL}/preprocess`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, user_id: userId, comment_id: commentId })
	});
	if (!res.ok) throw new Error(`Preprocess API error: ${res.status}`);
	return res.json();
}

async function callEmbed(text: string): Promise<number[]> {
	const res = await fetch(`${HF_SPACE_URL}/embed`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text })
	});
	if (!res.ok) throw new Error(`Embed API error: ${res.status}`);
	const data = await res.json();
	const embedding = data.embedding;
	// Validate shape defensively — a malformed vector must fail loudly instead
	// of silently poisoning the pgvector search.
	if (!Array.isArray(embedding) || embedding.length !== 768) {
		throw new Error('Embed API returned an unexpected embedding shape.');
	}
	return embedding as number[];
}

async function callSentiment(text: string, commentId: string): Promise<SentimentResult> {
	const res = await fetch(`${HF_SPACE_URL}/sentiment`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, comment_id: commentId })
	});
	if (!res.ok) throw new Error(`Sentiment API error: ${res.status}`);
	return res.json();
}

async function callTopic(text: string, commentId: string): Promise<TopicResult> {
	const res = await fetch(`${HF_SPACE_URL}/topic-classification`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, comment_id: commentId })
	});
	if (!res.ok) throw new Error(`Topic API error: ${res.status}`);
	return res.json();
}

async function callClaimDetection(text: string, commentId: string): Promise<ClaimResult> {
	const res = await fetch(`${HF_SPACE_URL}/claim-detection`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, comment_id: commentId })
	});
	if (!res.ok) throw new Error(`Claim detection API error: ${res.status}`);
	return res.json();
}

// ── RAG pipeline ──────────────────────────────────────────────────────────
// Retrieval parameters (plan §5): chunk-level scores are higher and more
// discriminative than whole-doc scores, so the threshold floor can be raised
// to 0.4 and we fetch 5 candidate chunks (up from 3 whole docs).
const MATCH_THRESHOLD = 0.4;
const MATCH_COUNT = 5;
// Cap any single document at 2 chunks in the final LLM context to preserve
// breadth across documents (plan §5 "Dedup").
const MAX_CHUNKS_PER_DOC = 2;

/**
 * Fetch the immediately adjacent chunk(s) (chunk_index ± 1) from the same
 * document so the LLM sees the matched provision in surrounding context,
 * bounded and small (plan §6).
 */
async function fetchSurroundingContext(
	supabase: ReturnType<typeof createClient>,
	doc: MatchedChunk
): Promise<{ chunk_index: number; chunk_text: string }[]> {
	const { data, error } = await supabase
		.from('document_chunks')
		.select('chunk_index, chunk_text')
		.eq('document_id', doc.document_id)
		.in('chunk_index', [doc.chunk_index - 1, doc.chunk_index + 1]);

	if (error || !data) return [];
	return data.filter((c) => c.chunk_index >= 0) as {
		chunk_index: number;
		chunk_text: string;
	}[];
}

/**
 * Prefer diversity: cap any single document at 2 chunks. If the top-k contains
 * 3+ from one doc, keep the 2 highest-scoring and pull the next-highest chunk
 * from a *different* document, skipping over-limit docs (plan §5).
 */
function dedupChunks(matches: MatchedChunk[]): MatchedChunk[] {
	const perDocCount = new Map<string, number>();
	const seen = new Set<string>();
	const result: MatchedChunk[] = [];

	for (const chunk of matches) {
		if (seen.has(chunk.chunk_id)) continue;
		seen.add(chunk.chunk_id);

		const count = perDocCount.get(chunk.document_id) ?? 0;
		if (count >= MAX_CHUNKS_PER_DOC) continue; // skip over-limit doc, pull next
		perDocCount.set(chunk.document_id, count + 1);
		result.push(chunk);
	}
	return result;
}

async function runRagPipeline(
	claimText: string,
	supabase: ReturnType<typeof createClient>
): Promise<RagResult> {
	// Step 1: Embed the claim
	const claimEmbedding = await callEmbed(claimText).catch((err) => {
		throw new Error(`[rag:embed] ${err instanceof Error ? err.message : String(err)}`);
	});

	// Step 2: Search pgvector for top matching LGU document chunks
	const { data: matches, error: matchError } = await supabase.rpc('match_document_chunks', {
		query_embedding: claimEmbedding,
		match_threshold: MATCH_THRESHOLD,
		match_count: MATCH_COUNT
	});

	if (matchError) throw new Error(`[rag:pgvector] ${matchError.message}`);

	let chunks = (matches ?? []) as MatchedChunk[];

	// No chunks matched — return immediately without calling the LLM
	// (matches current early-return and keeps token costs down, plan §5).
	if (chunks.length === 0) {
		return {
			determination: 'Insufficient Evidence',
			evidence_snippet: 'No matching LGU documents found in the knowledge base.',
			matched_document_id: null,
			matched_chunk_id: null
		};
	}

	// Step 3: Dedup — cap any single doc at 2 chunks (diversity preservation).
	chunks = dedupChunks(chunks);

	// Step 4: Fetch bounded surrounding context for each retained chunk.
	const withContext = await Promise.all(
		chunks.map(async (chunk) => ({
			chunk,
			surrounding: await fetchSurroundingContext(supabase, chunk)
		}))
	);

	// Step 5: Build chunk-level context for the LLM.
	const context = withContext
		.map(({ chunk, surrounding }, i) => {
			const uploadedDate = new Date(chunk.uploaded_at).toISOString().slice(0, 10);
			const sectionLabel = chunk.section_label ? `\nSection: ${chunk.section_label}` : '';
			const surroundingText = surrounding
				.sort((a, b) => a.chunk_index - b.chunk_index)
				.map((s) => s.chunk_text)
				.join('\n');
			return (
				`[Document ${i + 1}: ${chunk.title} · ${chunk.document_type} · ${uploadedDate}]` +
				sectionLabel +
				`\n${chunk.chunk_text}` +
				(surroundingText ? `\n[surrounding context]\n${surroundingText}` : '')
			);
		})
		.join('\n\n');

	// Step 6: Call the LLM for determination.
	const prompt = `You are a fact-checking assistant for the Municipality of Pulilan, Bulacan.

A citizen posted the following claim on social media:
"${claimText}"

Below are the relevant official LGU document excerpts retrieved from the knowledge base:

${context}

Based ONLY on the documents provided, determine whether the claim is:
- Supported: the documents confirm the claim is accurate
- Refuted: the documents contradict the claim
- Insufficient Evidence: the documents do not contain enough information to verify the claim

Respond in this exact JSON format with no other text:
{
  "determination": "Supported" | "Refuted" | "Insufficient Evidence",
  "evidence_snippet": "one sentence from the documents that supports your determination"
}`;

	const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${GROQ_API_KEY}`
		},
		body: JSON.stringify({
			model: 'llama-3.1-8b-instant',
			max_tokens: 256,
			messages: [{ role: 'user', content: prompt }]
		})
	});

	if (!groqRes.ok) {
		const errText = await groqRes.text();
		throw new Error(`[rag:llm] Groq API error ${groqRes.status}: ${errText}`);
	}

	const groqData = await groqRes.json();
	const rawText = groqData.choices?.[0]?.message?.content ?? '';

	// Parse JSON response from LLM — enforce the three-value contract so a
	// malformed/hallucinated determination never reaches flagged_claims as fact.
	const { determination, evidence_snippet } = parseRagDetermination(rawText);

	return {
		determination,
		evidence_snippet,
		matched_document_id: chunks[0]?.document_id ?? null,
		matched_chunk_id: chunks[0]?.chunk_id ?? null
	};
}

// ── Main handler ─────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
	if (req.method !== 'POST') {
		return new Response('Method not allowed', { status: 405 });
	}

	const authHeader = req.headers.get('Authorization');
	if (!authHeader) {
		return new Response('Unauthorized', { status: 401 });
	}

	const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

	let idsToProcess: string[] | null = null;
	try {
		const body = await req.json();
		idsToProcess = body.ids ?? null;
	} catch {
		// no body — will fetch all unprocessed
	}

	let query = supabase
		.from('raw_content')
		.select('id, raw_text, source_platform, post_id, author_hash')
		.eq('is_processed', false)
		.limit(50);

	if (idsToProcess && idsToProcess.length > 0) {
		query = supabase
			.from('raw_content')
			.select('id, raw_text, source_platform, post_id, author_hash')
			.in('id', idsToProcess);
	}

	const { data: rawRecords, error: fetchError } = await query;

	if (fetchError) {
		console.error('Failed to fetch raw_content:', fetchError);
		return new Response(JSON.stringify({ error: fetchError.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (!rawRecords || rawRecords.length === 0) {
		return new Response(JSON.stringify({ message: 'No records to process.' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	console.log(`Processing ${rawRecords.length} records...`);

	const results = { processed: 0, skipped_spam: 0, flagged: 0, errors: 0 };

	for (const record of rawRecords as RawContent[]) {
		try {
			// ── Step 1: Pre-process ───────────────────────────────────────────
			const pre = await callPreprocess(
				record.raw_text,
				record.author_hash ?? 'anonymous',
				record.id
			);

			// Mark processed and skip — don't waste NLP calls on spam
			if (pre.is_spam) {
				await supabase.from('raw_content').update({ is_processed: true }).eq('id', record.id);
				results.skipped_spam++;
				continue;
			}

			// ── Step 2: NLP — run all 3 in parallel on cleaned text ───────────
			const [sentiment, topic, claim] = await Promise.all([
				callSentiment(pre.cleaned_text, record.id),
				callTopic(pre.cleaned_text, record.id),
				callClaimDetection(pre.cleaned_text, record.id)
			]);

			const barangayMention = detectBarangay(pre.cleaned_text);

			// ── Step 3: Write to processed_content ───────────────────────────
			const { data: processedRow, error: insertError } = await supabase
				.from('processed_content')
				.insert({
					raw_content_id: record.id,
					content_type: 'facebook_comment',
					cleaned_text: pre.cleaned_text,
					language: pre.language,
					hashed_user_id: pre.hashed_user_id,
					sentiment_label: sentiment.sentiment,
					sentiment_score: sentiment.confidence,
					sentiment_needs_review: sentiment.needs_human_review,
					topic_label: topic.topic,
					topic_score: topic.confidence,
					topic_needs_review: topic.needs_human_review,
					is_flagged: claim.has_claim,
					barangay_mention: barangayMention,
					processed_at: new Date().toISOString()
				})
				.select('id')
				.single();

			if (insertError) {
				console.error(`processed_content insert error for ${record.id}:`, insertError);
				results.errors++;
				continue;
			}

			results.processed++;

			// ── Step 4: RAG pipeline if claim detected ────────────────────────
			// RAG pipeline and the flagged_claims insert are kept in *separate*
			// try/catch blocks so a DB insert failure can't masquerade as a RAG
			// pipeline error (and vice versa) in the manual-review fallback.
			if (claim.has_claim && processedRow) {
				let rag: RagResult | null = null;
				try {
					rag = await runRagPipeline(pre.cleaned_text, supabase);
				} catch (ragErr) {
					// RAG failed — caught at the pipeline boundary. The claim is
					// still saved below with a manual-review placeholder so it's
					// never lost, but the log pinpoints the failing sub-step.
					console.error(`RAG pipeline error for ${record.id}:`, ragErr);
				}

				const insert: {
					processed_content_id: string;
					claim_text: string;
					matched_patterns?: unknown;
					matched_document_id?: string | null;
					matched_chunk_id?: string | null;
					rag_determination?: string;
					rag_evidence_snippet?: string;
					status: string;
					language?: string;
					source_platform?: string;
					created_at: string;
				} = {
					processed_content_id: processedRow.id,
					claim_text: pre.cleaned_text,
					matched_patterns: claim.matched_patterns,
					status: 'Pending',
					language: pre.language,
					source_platform: record.source_platform ?? 'facebook',
					created_at: new Date().toISOString()
				};

				if (rag) {
					insert.matched_document_id = rag.matched_document_id;
					insert.matched_chunk_id = rag.matched_chunk_id;
					insert.rag_determination = rag.determination;
					insert.rag_evidence_snippet = rag.evidence_snippet;
				} else {
					insert.rag_determination = 'Insufficient Evidence';
					insert.rag_evidence_snippet = 'RAG pipeline error — manual review required.';
				}

				const { error: claimError } = await supabase.from('flagged_claims').insert(insert);
				if (claimError) {
					console.error(`flagged_claims insert error for ${record.id}:`, claimError);
				} else {
					results.flagged++;
					if (rag) console.log(`RAG result: ${rag.determination} — ${rag.evidence_snippet}`);
				}
			}

			// ── Step 5: Mark raw record as processed ─────────────────────────
			await supabase.from('raw_content').update({ is_processed: true }).eq('id', record.id);
		} catch (err) {
			console.error(`Error processing record ${record.id}:`, err);
			results.errors++;
		}
	}

	console.log('Processing complete:', results);

	return new Response(JSON.stringify({ success: true, results }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
});
