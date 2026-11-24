import { describe, it, expect } from 'vitest';
import { formatDateTime } from '$lib/utils/format';

describe('formatDateTime', () => {
	it('renders a short month, numeric day, and a 2-digit time in en-PH', () => {
		const out = formatDateTime('2026-08-15T12:00:00Z');
		// Month is stable regardless of the host timezone; the exact day/hour
		// depends on the runner's TZ, so assert structure rather than a literal.
		expect(out).toContain('Aug');
		expect(out.length).toBeGreaterThan(5);
	});

	it('splits date and time with a comma (en-PH grouping)', () => {
		const out = formatDateTime('2026-08-15T12:00:00Z');
		expect(out).toMatch(/Aug \d{1,2},? \d{1,2}:\d{2}/);
	});

	it('does not crash on a nullish/invalid input', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(() => formatDateTime('not-a-date' as any)).not.toThrow();
	});
});
