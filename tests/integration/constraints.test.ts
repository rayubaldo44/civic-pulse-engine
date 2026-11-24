import { beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase, FIXTURE } from '../shared/seed';
import { analystClient, serviceClient } from './helpers/clients';

beforeAll(async () => {
	await seedDatabase();
});

// CHECK-violation helper: insert returns error with the 23514 check_violation
// SQLSTATE, or a FK/other relation error for cascade tests.
function expectCheckViolation(error: { code?: string; message?: string } | null): void {
	expect(error, 'expected a constraint rejection').toBeTruthy();
	expect(error!.code).toBe('23514');
}

describe('CHECK constraints', () => {
	it('civic_issues rejects invalid priority', async () => {
		const client = serviceClient();
		const { error } = await (client.from('civic_issues') as any).insert({
			title: 'bad priority',
			priority: 'Urgent',
			status: 'Open'
		});
		expectCheckViolation(error);
	});

	it('civic_issues rejects invalid status', async () => {
		const client = serviceClient();
		const { error } = await (client.from('civic_issues') as any).insert({
			title: 'bad status',
			priority: 'High',
			status: 'Done'
		});
		expectCheckViolation(error);
	});

	it('raw_content rejects negative reaction_count', async () => {
		const client = serviceClient();
		const { error } = await (client.from('raw_content') as any).insert({
			comment_id: 'neg',
			raw_text: 'x',
			reaction_count: -1
		});
		expectCheckViolation(error);
	});

	it('processed_content rejects invalid sentiment_label', async () => {
		const client = serviceClient();
		const { error } = await (client.from('processed_content') as any).insert({
			raw_content_id: FIXTURE.raw.road,
			cleaned_text: 'x',
			sentiment_label: 'furious'
		});
		expectCheckViolation(error);
	});

	it('processed_content rejects non-Pulilan barangay_mention values', async () => {
		const client = serviceClient();
		const { error } = await (client.from('processed_content') as any).insert({
			raw_content_id: FIXTURE.raw.road,
			cleaned_text: 'x',
			barangay_mention: 'Quezon City'
		});
		expectCheckViolation(error);
	});

	it('flagged_claims rejects invalid status', async () => {
		const client = serviceClient();
		const { error } = await (client.from('flagged_claims') as any).insert({
			processed_content_id: FIXTURE.processed.road,
			claim_text: 'x',
			status: 'Maybe'
		});
		expectCheckViolation(error);
	});

	it('profiles rejects roles outside analyst/admin', async () => {
		const client = serviceClient();
		const { userId } = await analystClient();
		const { error } = await (client.from('profiles') as any).upsert({
			id: userId,
			role: 'reviewer',
			password_set: true
		});
		expect(error).toBeTruthy();
	});

	it('lgu_documents document_type CHECK accepts Executive Order (migration 006)', async () => {
		const client = serviceClient();
		const { data, error } = await (client.from('lgu_documents') as any)
			.insert({
				title: 'EO temp',
				content: 'temp',
				document_type: 'Executive Order'
			})
			.select('id')
			.single();
		expect(error).toBeNull();
		await (client.from('lgu_documents') as any).delete().eq('id', data.id);

		const invalid = await (client.from('lgu_documents') as any).insert({
			title: 'bad type',
			content: 'temp',
			document_type: 'Comic Book'
		});
		expectCheckViolation(invalid.error);
	});

	it('nlp_categories enforces the 60-char name limit', async () => {
		const client = serviceClient();
		const { error } = await (client.from('nlp_categories') as any).insert({
			name: 'x'.repeat(61)
		});
		expectCheckViolation(error);
	});
});

describe('Referential integrity', () => {
	it('deleting a civic_issue cascades its comments and status logs', async () => {
		const client = serviceClient();

		await (client.from('civic_issues') as any)
			.update({ status: 'In Progress' })
			.eq('id', FIXTURE.issue.open);
		// status change fired log_civic_issue_status_change → a status log now exists

		const preComments = await (client.from('issue_comments') as any)
			.select('id')
			.eq('issue_id', FIXTURE.issue.open);
		expect((preComments.data ?? []).length).toBe(1);

		await (client.from('civic_issues') as any).delete().eq('id', FIXTURE.issue.open);

		const postComments = await (client.from('issue_comments') as any)
			.select('id')
			.eq('issue_id', FIXTURE.issue.open);
		const postLogs = await (client.from('issue_status_logs') as any)
			.select('id')
			.eq('issue_id', FIXTURE.issue.open);
		expect((postComments.data ?? []).length).toBe(0);
		expect((postLogs.data ?? []).length).toBe(0);
	});
});
