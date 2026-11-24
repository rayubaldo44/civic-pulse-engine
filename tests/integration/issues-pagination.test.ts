import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../shared/seed';
import { serviceClient, anonClient, analystClient } from './helpers/clients';

const prefix = 'Pagination integration issue ';
const svc = serviceClient();
let analystId: string;
beforeAll(async () => {
	const seed = await seedDatabase();
	analystId = seed.analystUserId;
	const { data: issues, error } = await svc
		.from('civic_issues')
		.insert(
			Array.from({ length: 126 }, (_, index) => ({
				title: prefix + String(index).padStart(3, '0'),
				status: index === 125 ? 'Under Review' : 'Open',
				priority: index === 125 ? 'Critical' : 'High',
				assigned_to: index === 125 ? analystId : null,
				created_at: '2026-10-01T00:00:00Z'
			}))
		)
		.select('id,title');
	if (error) throw error;
	const issue = issues!.find((i) => i.title === prefix + '125')!;
	const { data: round, error: roundError } = await svc
		.from('issue_resolution_rounds')
		.insert({
			issue_id: issue.id,
			round_number: 1,
			submitted_by: seed.adminUserId,
			resolution_summary: 'Repaired',
			actions_taken: 'Replaced pipe',
			observed_outcome: 'Water restored',
			evidence_links: ['https://example.test/evidence']
		})
		.select('id')
		.single();
	if (roundError) throw roundError;
	const { error: reviewError } = await svc
		.from('issue_resolution_reviews')
		.insert({ round_id: round.id, reviewer_id: analystId });
	if (reviewError) throw reviewError;
});
afterAll(async () => {
	await svc
		.from('civic_issues')
		.delete()
		.like('title', prefix + '%');
});

describe('bounded SQL issue pages', () => {
	const query = (extra: Record<string, unknown> = {}) =>
		svc.rpc('get_issue_page', {
			p_user_id: analystId,
			p_q: prefix,
			p_sort: 'title',
			p_direction: 'asc',
			...extra
		});
	it('returns every record across six pages with stable tie ordering and global totals', async () => {
		const ids: string[] = [];
		for (let page = 1; page <= 6; page++) {
			const { data, error } = await query({ p_page: page });
			expect(error).toBeNull();
			expect(data.total).toBe(126);
			expect(data.items.length).toBeLessThanOrEqual(25);
			ids.push(...data.items.map((i: any) => i.id));
		}
		expect(ids).toHaveLength(126);
		expect(new Set(ids).size).toBe(126);
	});
	it('searches and applies mine scope before the limit', async () => {
		const { data, error } = await query({ p_q: prefix + '125', p_scope: 'mine' });
		expect(error).toBeNull();
		expect(data.total).toBe(1);
		expect(data.items[0].title).toBe(prefix + '125');
	});
	it('applies pending-review scope before pagination', async () => {
		const { data, error } = await query({ p_scope: 'reviews' });
		expect(error).toBeNull();
		expect(data.total).toBe(1);
		expect(data.items[0].title).toBe(prefix + '125');
	});
	it('sorts priority by severity across all records', async () => {
		const { data, error } = await query({ p_sort: 'priority' });
		expect(error).toBeNull();
		expect(data.items[0].priority).toBe('Critical');
	});
	it('exposes global counts rather than the current page length', async () => {
		const { data, error } = await query();
		expect(error).toBeNull();
		expect(data.counts.open).toBeGreaterThanOrEqual(125);
		expect(data.counts.mine).toBeGreaterThanOrEqual(1);
	});
	it('denies direct anon and authenticated RPC access', async () => {
		const analyst = await analystClient();
		for (const client of [anonClient(), analyst.client]) {
			const { error } = await client.rpc('get_issue_page', { p_user_id: analystId });
			expect(error).toBeTruthy();
		}
	});
});
