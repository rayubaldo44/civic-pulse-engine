import { beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase, FIXTURE } from '../shared/seed';
import { anonClient, analystClient, serviceClient } from './helpers/clients';

beforeAll(async () => {
	await seedDatabase();
});

// PostgREST surfaces RLS-denied writes as a 42501 "permission denied" — the
// exact error a bypass attempt would hit via the public anon key + a JWT.
function expectDenied(error: { code?: string; message?: string } | null): void {
	expect(error, 'write should have been rejected by RLS').toBeTruthy();
	const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
	expect(
		text.includes('42501') ||
			text.includes('permission denied') ||
			text.includes('row-level security') ||
			text.includes('violates row-level security'),
		`expected an RLS denial, got: ${text}`
	).toBe(true);
}

describe('RLS — issue tables (migration 005 hardening)', () => {
	it('authenticated users can SELECT seeded civic_issues', async () => {
		const { client } = await analystClient();
		const { data, error } = await (client.from('civic_issues') as any)
			.select('id, status')
			.in('id', [FIXTURE.issue.open, FIXTURE.issue.resolved]);
		expect(error).toBeNull();
		expect((data ?? []).length).toBe(2);
	});

	it('anon cannot read civic_issues (RLS default-deny)', async () => {
		const client = anonClient();
		const { data, error } = await (client.from('civic_issues') as any).select('id');
		expect(error).toBeNull();
		expect(data ?? []).toEqual([]);
	});

	it('analyst INSERT into civic_issues is blocked', async () => {
		const { client } = await analystClient();
		const { error } = await (client.from('civic_issues') as any).insert({
			title: 'Bypass attempt',
			status: 'Resolved',
			priority: 'Critical'
		});
		expectDenied(error);
	});

	it('analyst UPDATE of civic_issues silently matches zero rows (no status change)', async () => {
		const { client } = await analystClient();
		const { error } = await (client.from('civic_issues') as any)
			.update({ status: 'Resolved' })
			.eq('id', FIXTURE.issue.open);
		// RLS with no UPDATE policy filters the row out — no error, no mutation.
		expect(error).toBeNull();
		const svc = serviceClient();
		const { data } = await (svc.from('civic_issues') as any)
			.select('status')
			.eq('id', FIXTURE.issue.open)
			.single();
		expect(data.status).toBe('Open');
	});

	it('analyst DELETE from civic_issues leaves the row intact', async () => {
		const { client } = await analystClient();
		const { error } = await (client.from('civic_issues') as any)
			.delete()
			.eq('id', FIXTURE.issue.open);
		expect(error).toBeNull();
		const svc = serviceClient();
		const { data } = await (svc.from('civic_issues') as any)
			.select('id')
			.eq('id', FIXTURE.issue.open)
			.maybeSingle();
		expect(data).not.toBeNull();
	});

	it('issue_comments and issue_status_logs writes are blocked for analysts', async () => {
		const { client } = await analystClient();
		const commentError = (
			await (client.from('issue_comments') as any).insert({
				issue_id: FIXTURE.issue.open,
				body: 'forged status log'
			})
		).error;
		expectDenied(commentError);

		const logError = (
			await (client.from('issue_status_logs') as any).insert({
				issue_id: FIXTURE.issue.open,
				from_status: 'Open',
				to_status: 'Resolved'
			})
		).error;
		expectDenied(logError);
	});

	it('service role can write issue rows (the app path)', async () => {
		const client = serviceClient();
		const { data, error } = await (client.from('civic_issues') as any)
			.insert({
				title: 'Service role sanity',
				priority: 'Low',
				status: 'Open'
			})
			.select('id')
			.single();
		expect(error).toBeNull();
		await (client.from('civic_issues') as any).delete().eq('id', data.id);
	});
});

describe('RLS — analytics/feedback tables', () => {
	it('authenticated SELECT on raw_content / processed_content / flagged_claims', async () => {
		const { client } = await analystClient();
		const raw = await (client.from('raw_content') as any).select('id').in('id', [FIXTURE.raw.road]);
		expect(raw.error).toBeNull();
		expect((raw.data ?? []).length).toBe(1);

		const proc = await (client.from('processed_content') as any)
			.select('id')
			.in('id', [FIXTURE.processed.road]);
		expect(proc.error).toBeNull();
		expect((proc.data ?? []).length).toBe(1);

		const claims = await (client.from('flagged_claims') as any)
			.select('id')
			.in('id', [FIXTURE.claim.pending]);
		expect(claims.error).toBeNull();
		expect((claims.data ?? []).length).toBe(1);
	});

	it('analyst writes to raw/processed/flagged are blocked', async () => {
		const { client } = await analystClient();
		expectDenied(
			(
				await (client.from('raw_content') as any).insert({
					comment_id: 'x',
					raw_text: 'poison'
				})
			).error
		);
		expectDenied(
			(
				await (client.from('processed_content') as any).insert({
					raw_content_id: FIXTURE.raw.road,
					cleaned_text: 'poison'
				})
			).error
		);
		expectDenied(
			(
				await (client.from('flagged_claims') as any).insert({
					processed_content_id: FIXTURE.processed.road,
					claim_text: 'poison'
				})
			).error
		);
	});

	it('anon cannot read raw or processed feedback (RLS default-deny)', async () => {
		const client = anonClient();
		const raw = await (client.from('raw_content') as any).select('id');
		const proc = await (client.from('processed_content') as any).select('id');
		expect((raw.data ?? []).length).toBe(0);
		expect((proc.data ?? []).length).toBe(0);
	});
});

describe('RLS — documents', () => {
	it('authenticated SELECT on lgu_documents and document_chunks', async () => {
		const { client } = await analystClient();
		const docs = await (client.from('lgu_documents') as any).select('id').eq('id', FIXTURE.doc);
		const chunks = await (client.from('document_chunks') as any)
			.select('id')
			.eq('document_id', FIXTURE.doc);
		expect(docs.error).toBeNull();
		expect((docs.data ?? []).length).toBe(1);
		expect(chunks.error).toBeNull();
		expect((chunks.data ?? []).length).toBe(2);
	});

	it('authenticated INSERT on lgu_documents is allowed (Reference Docs upload)', async () => {
		const { client } = await analystClient();
		const { data, error } = await (client.from('lgu_documents') as any)
			.insert({
				title: 'Temp doc',
				content: 'temp',
				document_type: 'Advisory'
			})
			.select('id')
			.single();
		expect(error).toBeNull();
		await (serviceClient().from('lgu_documents') as any).delete().eq('id', data.id);
	});

	it('document_chunks writes are blocked for analysts', async () => {
		const { client } = await analystClient();
		const embedding = Array.from({ length: 768 }, () => 0.5);
		const { error } = await (client.from('document_chunks') as any).insert({
			document_id: FIXTURE.doc,
			chunk_index: 99,
			chunk_text: 'poisoned embedding',
			embedding
		});
		expectDenied(error);
	});

	it('profiles are readable by authenticated staff', async () => {
		const { client } = await analystClient();
		const { data, error } = await (client.from('profiles') as any).select('id, role');
		expect(error).toBeNull();
		// seedDatabase includes the dedicated logout analyst as well as admin/analyst.
		expect((data ?? []).length).toBe(3);
		expect((data ?? []).map((p: { role: string }) => p.role).sort()).toEqual([
			'admin',
			'analyst',
			'analyst'
		]);
	});
});
