import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonClient, analystClient, serviceClient } from './helpers/clients';

const service = serviceClient();
const marker = `claims-pagination-${randomUUID()}`;
const ids = Array.from({ length: 130 }, () => randomUUID());
const tieId = randomUUID();

beforeAll(async () => {
	const { data: profiles, error: profileError } = await service
		.from('profiles')
		.select('id')
		.limit(1);
	if (profileError || !profiles?.[0])
		throw new Error('Local claims fixture requires a seeded profile');
	const { error } = await service.from('flagged_claims').insert(
		ids.map((id, i) => ({
			id,
			claim_text: `${marker} ${i}`,
			status: i < 100 ? 'Pending' : 'Verified True',
			created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
		}))
	);
	if (error) throw error;
	const reviewedBy = profiles[0].id;
	const { error: reviewError } = await service.from('review_records').insert([
		...ids.slice(100).map((id) => ({
			id: randomUUID(),
			flagged_claim_id: id,
			reviewed_by: reviewedBy,
			decision: 'Verified True',
			reviewed_at: '2026-02-01T00:00:00Z'
		})),
		{
			id: tieId,
			flagged_claim_id: ids[129],
			reviewed_by: reviewedBy,
			decision: 'Inconclusive',
			reviewed_at: '2026-02-02T00:00:00Z'
		}
	]);
	if (reviewError) throw reviewError;
});

afterAll(async () => {
	await service.from('review_records').delete().in('flagged_claim_id', ids);
	await service.from('flagged_claims').delete().in('id', ids);
});

async function claims(archive = false, page = 1, status: string | null = null, search = marker) {
	const { data, error } = await service.rpc('get_claims_page', {
		p_archive: archive,
		p_page: page,
		p_search: search,
		p_status: status
	});
	if (error) throw error;
	return data as {
		items: { id: string; status: string }[];
		total: number;
		counts: Record<string, number>;
	};
}

describe('bounded claims RPC on real PostgreSQL', () => {
	it('orders pending records ahead of newer reviewed records before pagination', async () => {
		const result = await claims();
		expect(result.total).toBe(130);
		expect(result.items).toHaveLength(25);
		expect(result.items.every((item) => item.status === 'Pending')).toBe(true);
		expect(result.counts.Pending).toBe(100);
	});
	it('retrieves records beyond the first hundred without duplicates or omissions', async () => {
		const pages = await Promise.all(Array.from({ length: 6 }, (_, i) => claims(false, i + 1)));
		const returned = pages.flatMap((page) => page.items.map((item) => item.id));
		expect(returned).toHaveLength(130);
		expect(new Set(returned).size).toBe(130);
		expect(pages[5].items).toHaveLength(5);
	});
	it('filters using the latest human decision rather than the stale claim status', async () => {
		const result = await claims(true, 1, 'Inconclusive');
		expect(result.total).toBe(1);
		expect(result.items).toEqual([
			expect.objectContaining({ id: ids[129], status: 'Inconclusive' })
		]);
		expect(result.counts['Verified True']).toBe(29);
		expect(result.counts.Inconclusive).toBe(1);
	});
	it('counts only human-reviewed claims and searches the entire archive', async () => {
		const result = await claims(true, 1, null, `${marker} 129`);
		expect(result.total).toBe(1);
		expect(result.items[0].id).toBe(ids[129]);
	});
	it('does not expose its service-role RPC to anonymous or authenticated clients', async () => {
		const anon = await anonClient().rpc('get_claims_page', {});
		expect(anon.error).not.toBeNull();
		const { client } = await analystClient();
		const staff = await client.rpc('get_claims_page', {});
		expect(staff.error).not.toBeNull();
	});
});
