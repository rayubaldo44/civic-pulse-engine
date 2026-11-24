import { describe, expect, it } from 'vitest';
import { parseRagDetermination } from '../../supabase/functions/support/rag';

describe('parseRagDetermination (edge support/rag.ts)', () => {
	it('accepts well-formed JSON with a valid determination', () => {
		const parsed = parseRagDetermination(
			JSON.stringify({ determination: 'Supported', evidence_snippet: 'Sec. 3 states the curfew.' })
		);
		expect(parsed.determination).toBe('Supported');
		expect(parsed.evidence_snippet).toBe('Sec. 3 states the curfew.');
	});

	it('accepts all three valid determinations', () => {
		for (const determination of ['Supported', 'Refuted', 'Insufficient Evidence']) {
			const parsed = parseRagDetermination(
				JSON.stringify({ determination, evidence_snippet: 'evidence' })
			);
			expect(parsed.determination).toBe(determination);
		}
	});

	it('rejects an out-of-contract determination value', () => {
		const parsed = parseRagDetermination(
			JSON.stringify({ determination: 'Seems likely', evidence_snippet: 'zzz' })
		);
		expect(parsed.determination).toBe('Insufficient Evidence');
	});

	it('rejects a non-string determination', () => {
		const parsed = parseRagDetermination(
			JSON.stringify({ determination: 42, evidence_snippet: 'zzz' })
		);
		expect(parsed.determination).toBe('Insufficient Evidence');
	});

	it('falls back to substring detection on unparseable text', () => {
		expect(parseRagDetermination('The claim is Supported by Sec. 2.').determination).toBe(
			'Supported'
		);
		expect(parseRagDetermination('clearly Refuted by the ordinance').determination).toBe('Refuted');
	});

	it('uses the fallback snippet for non-JSON text', () => {
		const parsed = parseRagDetermination('garbage output with no markers');
		expect(parsed.determination).toBe('Insufficient Evidence');
		expect(parsed.evidence_snippet).toBe('Unable to parse LLM response.');
	});

	it('fills an empty evidence snippet', () => {
		const parsed = parseRagDetermination(
			JSON.stringify({ determination: 'Refuted', evidence_snippet: '   ' })
		);
		expect(parsed.determination).toBe('Refuted');
		expect(parsed.evidence_snippet).toBe('No evidence snippet provided by the model.');
	});

	it('caps overly long evidence snippets at 300 chars', () => {
		const long = 'x'.repeat(500);
		const parsed = parseRagDetermination(
			JSON.stringify({ determination: 'Refuted', evidence_snippet: long })
		);
		expect(parsed.evidence_snippet.length).toBe(300);
		expect(parsed.determination).toBe('Refuted');
	});

	it('trims the evidence snippet', () => {
		const parsed = parseRagDetermination(
			JSON.stringify({ determination: 'Supported', evidence_snippet: '  padded  ' })
		);
		expect(parsed.evidence_snippet).toBe('padded');
	});
});
