import { beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../shared/seed';
import { adminClient, analystClient } from './helpers/clients';

beforeAll(async () => {
	await seedDatabase();
});

describe('Role authorization (admin vs analyst)', () => {
	it('audit_logs is SELECT-visible only to admins', async () => {
		const admin = await adminClient();
		const analyst = await analystClient();

		const { data: adminRows } = await (admin.client.from('audit_logs') as any)
			.select('id')
			.limit(50);
		// seed.sql / migration 011 boot seeds system events → non-empty.
		expect((adminRows ?? []).length).toBeGreaterThan(0);

		const { data: analystRows } = await (analyst.client.from('audit_logs') as any)
			.select('id')
			.limit(50);
		expect(analystRows ?? []).toEqual([]);
	});

	it('audit_logs INSERT is open to all authenticated users (app audit trail)', async () => {
		const { client } = await analystClient();
		const { error } = await (client.from('audit_logs') as any).insert({
			action: 'integration.role_test',
			actor_email: 'analyst@civicpulse.test'
		});
		expect(error).toBeNull();
	});

	it('nlp_categories INSERT is admin-only at the DB layer', async () => {
		const admin = await adminClient();
		const analyst = await analystClient();

		const adminInsert = await (admin.client.from('nlp_categories') as any).insert({
			name: `disaster ${Date.now()}`,
			description: 'temp'
		});
		expect(adminInsert.error).toBeNull();

		const analystInsert = await (analyst.client.from('nlp_categories') as any).insert({
			name: `forbidden ${Date.now()}`,
			description: 'temp'
		});
		expect(analystInsert.error).toBeTruthy();
	});
});

describe('Aggregate RPCs against seeded data', () => {
	it('get_sidebar_badges counts pending claims and my open tasks', async () => {
		const analyst = await analystClient();
		const admin = await adminClient();

		const { data: analystBadges } = await (analyst.client.rpc as any)('get_sidebar_badges', {
			p_user_id: analyst.userId
		});
		expect((analystBadges ?? [])[0]).toMatchObject({ pending: 1, my_tasks: 1 });

		const { data: adminBadges } = await (admin.client.rpc as any)('get_sidebar_badges', {
			p_user_id: admin.userId
		});
		expect((adminBadges ?? [])[0]).toMatchObject({ pending: 1, my_tasks: 0 });
	});

	it('get_analytics_totals returns every processed row', async () => {
		const { client } = await analystClient();
		const { data } = await (client.rpc as any)('get_analytics_totals');
		expect((data ?? [])[0]).toMatchObject({ total: 6 });
	});

	it('get_sentiment_counts reflects seeded labels', async () => {
		const { client } = await analystClient();
		const { data } = await (client.rpc as any)('get_sentiment_counts');
		const counts = Object.fromEntries((data ?? []).map((r: any) => [r.label, r.count]));
		expect(counts['negative']).toBe(3);
		expect(counts['positive']).toBe(1);
		expect(counts['neutral']).toBe(1);
		expect(counts['review']).toBe(1);
	});

	it('get_topic_counts covers all six processed rows', async () => {
		const { client } = await analystClient();
		const { data } = await (client.rpc as any)('get_topic_counts');
		const total = (data ?? []).reduce((sum: number, r: any) => sum + r.count, 0);
		expect(total).toBe(6);
	});

	it('get_review_tally maps human decisions to RAG determinations', async () => {
		const { client } = await analystClient();
		const { data } = await (client.rpc as any)('get_review_tally');
		const matrix = (data ?? []).map((r: any) => `${r.decision}|${r.rag_determination}`);
		expect(matrix).toContain('Verified True|Supported');
		expect(matrix).toContain('Inconclusive|Insufficient Evidence');
	});

	it('get_barangay_stats aggregates per barangay', async () => {
		const { client } = await analystClient();
		const { data } = await (client.rpc as any)('get_barangay_stats');
		const byName = Object.fromEntries((data ?? []).map((r: any) => [r.name, r]));
		expect(byName['Poblacion']).toMatchObject({ total: 1, negative: 1, flagged: 0 });
		expect(byName['Bambang']).toMatchObject({ total: 1, negative: 1, flagged: 1 });
	});

	it('get_topic_window_stats folds engagement from raw_content', async () => {
		const { client } = await analystClient();
		const since = new Date(Date.now() - 370 * 24 * 60 * 60 * 1000).toISOString();
		const { data } = await (client.rpc as any)('get_topic_window_stats', { p_since: since });
		const labels = (data ?? []).map((r: any) => r.topic_label);
		// Compound NLP variants are kept intact (normalization happens in $lib).
		expect(labels).toContain('Infrastructure');
		expect(labels).toContain('Infrastructure and Public Works');
		expect(labels).toContain('Public Safety and Peace and Order');
	});
});
