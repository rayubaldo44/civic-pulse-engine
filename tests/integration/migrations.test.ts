import { beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase, FIXTURE } from '../shared/seed';
import { adminClient, analystClient, serviceClient } from './helpers/clients';

beforeAll(async () => {
	await seedDatabase();
});

function vecLiteral(fill: (i: number) => number): string {
	return `[${Array.from({ length: 768 }, (_, i) => String(fill(i))).join(',')}]`;
}

const SINGLE_ONE = vecLiteral((i) => (i === 0 ? 1 : 0));
const HALF = vecLiteral(() => 0.5);

describe('Migration surface (schema drift canaries)', () => {
	it('004 — raw_content exposes engagement counters', async () => {
		const client = serviceClient();
		const { data, error } = await (client.from('raw_content') as any)
			.select('reaction_count, reply_count')
			.eq('id', FIXTURE.raw.road)
			.single();
		expect(error).toBeNull();
		expect(data).toMatchObject({ reaction_count: 12, reply_count: 3 });
	});

	it('006 — document_chunks table is queryable', async () => {
		const { client } = await analystClient();
		const { data, error } = await (client.from('document_chunks') as any).select('id');
		expect(error).toBeNull();
		expect((data ?? []).length).toBe(2);
	});

	it('008 — review_records table is queryable', async () => {
		const { client } = await analystClient();
		const { data, error } = await (client.from('review_records') as any).select('id');
		expect(error).toBeNull();
		expect((data ?? []).length).toBe(2);
	});

	it('011 — audit_logs has the enriched resource columns', async () => {
		const admin = await adminClient();
		const { data, error } = await (admin.client.from('audit_logs') as any)
			.select('id, resource_type, resource_id, ip_address, user_agent, actor_email')
			.limit(1);
		expect(error).toBeNull();
		expect((data ?? []).length).toBe(1);
	});

	it('012 — get_analytics_totals exists', async () => {
		const { client } = await analystClient();
		const { data, error } = await (client.rpc as any)('get_analytics_totals');
		expect(error).toBeNull();
		expect(data).toBeDefined();
	});
});

describe('match_document_chunks (RAG retrieval, migration 006)', () => {
	it('returns nothing for an unrelated embedding (threshold respected)', async () => {
		const { client } = await analystClient();
		const { data, error } = await (client.rpc as any)('match_document_chunks', {
			query_embedding: SINGLE_ONE,
			match_threshold: 0.4,
			match_count: 5
		});
		expect(error).toBeNull();
		expect(data ?? []).toEqual([]);
	});

	it('returns the evidence chunk for a matching embedding', async () => {
		const { client } = await analystClient();
		const { data, error } = await (client.rpc as any)('match_document_chunks', {
			query_embedding: HALF,
			match_threshold: 0.4,
			match_count: 5
		});
		expect(error).toBeNull();
		const ids = (data ?? []).map((r: { chunk_id: string }) => r.chunk_id);
		expect(ids).toContain(FIXTURE.chunk.road);
		const hit = (data ?? []).find((r: { chunk_id: string }) => r.chunk_id === FIXTURE.chunk.road);
		expect(hit.similarity).toBeCloseTo(1, 4);
	});
});
