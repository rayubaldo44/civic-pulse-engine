// supabase/functions/support/rag.ts
//
// Pure parser for the RAG fact-check determination returned by the Groq
// llama-3.1-8b-instant endpoint. Edge Functions run under Deno, so this module
// intentionally has zero imports and is unit-tested directly from the repo.
//
// The LLM is instructed to emit strict JSON but is not guaranteed to comply —
// this parser enforces the three-value contract so a hallucinated or malformed
// determination never reaches flagged_claims as fact.

export type RagDetermination = 'Supported' | 'Refuted' | 'Insufficient Evidence';

export const RAG_DETERMINATIONS: readonly RagDetermination[] = [
	'Supported',
	'Refuted',
	'Insufficient Evidence'
];

export interface ParsedRag {
	determination: RagDetermination;
	evidence_snippet: string;
}

const MAX_EVIDENCE = 300;
const FALLBACK_SNIPPET = 'Unable to parse LLM response.';
const NO_SNIPPET = 'No evidence snippet provided by the model.';

function isDetermination(value: string): value is RagDetermination {
	return RAG_DETERMINATIONS.includes(value as RagDetermination);
}

export function parseRagDetermination(rawText: string): ParsedRag {
	let determination: RagDetermination = 'Insufficient Evidence';
	let evidence_snippet = FALLBACK_SNIPPET;

	try {
		const parsed = JSON.parse(rawText);
		const candidate = typeof parsed?.determination === 'string' ? parsed.determination.trim() : '';
		if (isDetermination(candidate)) {
			determination = candidate;
		}
		evidence_snippet =
			typeof parsed?.evidence_snippet === 'string' ? parsed.evidence_snippet.trim() : '';
	} catch {
		// Non-JSON response — fall back to substring detection from raw text.
		if (rawText.includes('Supported')) {
			determination = 'Supported';
			evidence_snippet = rawText.slice(0, MAX_EVIDENCE);
		} else if (rawText.includes('Refuted')) {
			determination = 'Refuted';
			evidence_snippet = rawText.slice(0, MAX_EVIDENCE);
		}
		// Nothing parseable — keep the generic fallback snippet rather than
		// persisting raw model output as evidence.
	}

	if (!evidence_snippet) evidence_snippet = NO_SNIPPET;
	if (evidence_snippet.length > MAX_EVIDENCE)
		evidence_snippet = evidence_snippet.slice(0, MAX_EVIDENCE);

	return { determination, evidence_snippet };
}
