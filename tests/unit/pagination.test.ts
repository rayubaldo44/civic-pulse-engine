import { describe, expect, it } from 'vitest';
import { getPagination, pageHref } from '$lib/utils/pagination';

describe('pagination', () => {
	it('defaults invalid and unsafe pages to one', () => {
		for (const value of [
			null,
			'',
			'0',
			'-2',
			'2x',
			'1.5',
			'Infinity',
			'9007199254740992',
			'2147483648'
		]) {
			expect(getPagination(new URLSearchParams(value ? { page: value } : {}))).toMatchObject({
				page: 1,
				pageSize: 25,
				from: 0,
				to: 24
			});
		}
	});
	it('bounds queries at 25 records beyond the first hundred', () => {
		expect(getPagination(new URLSearchParams('page=6'))).toEqual({
			page: 6,
			pageSize: 25,
			from: 125,
			to: 149
		});
	});
	it('preserves filters in links without mutating the source URL', () => {
		const url = new URL('https://example.test/claims?q=bridge&status=Pending&page=2');
		expect(pageHref(url, 3)).toBe('/claims?q=bridge&status=Pending&page=3');
		expect(url.searchParams.get('page')).toBe('2');
	});
});
