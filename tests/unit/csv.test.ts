import { describe, it, expect } from 'vitest';
import { csvCell } from '$lib/server/csv';

describe('csvCell', () => {
	it('wraps plain values in quotes', () => {
		expect(csvCell('Flooded road')).toBe('"Flooded road"');
	});

	it('serializes non-strings through String()', () => {
		expect(csvCell(0)).toBe('"0"');
		expect(csvCell(true)).toBe('"true"');
		expect(csvCell(12.5)).toBe('"12.5"');
	});

	it('emits an empty quoted cell for null/undefined/empty', () => {
		expect(csvCell(null)).toBe('""');
		expect(csvCell(undefined)).toBe('""');
		expect(csvCell('')).toBe('""');
	});

	it.each(['=', '+', '-', '@', '\t', '\r'])(
		'neutralizes formula-prefix %j with a leading apostrophe',
		(prefix) => {
			expect(csvCell(`${prefix}SUM(A1:A2)`)).toBe(`"\'${prefix}SUM(A1:A2)"`);
		}
	);

	it('leaves a value alone when the formula char is not the first character', () => {
		expect(csvCell(' budget = 100')).toBe('" budget = 100"');
	});

	it('doubles embedded double quotes', () => {
		expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
	});

	it('handles object values defensively', () => {
		expect(csvCell({ toString: () => 'obj' })).toBe('"obj"');
	});
});
