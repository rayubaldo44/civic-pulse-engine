import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

import { listIssues } from '$lib/server/issues';
import { createFakeSupabase } from './helpers/fake-supabase';

function mockDb(...setup: Parameters<typeof createFakeSupabase>) {
	const db = createFakeSupabase(...setup);
	getServiceSupabase.mockReturnValue(db);
	return db;
}

const ISSUE = {
	id: 'issue-1',
	title: 'Broken streetlight',
	status: 'Open',
	priority: 'High'
};

describe('listIssues', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns rows newest-first with the shared select shape', async () => {
		const db = mockDb({ queue: [{ data: [ISSUE], error: null }] });

		const issues = await listIssues();

		expect(issues).toEqual([ISSUE]);
		const call = db.lastCall();
		expect(call.table).toBe('civic_issues');
		expect(call.order).toEqual({ column: 'created_at', options: { ascending: false } });
		expect(call.select).toContain('assignee:profiles!civic_issues_assigned_to_fkey');
		expect(call.select).toContain('creator:profiles!civic_issues_created_by_fkey');
	});

	it('resolves to an empty array when there is no data', async () => {
		mockDb({ queue: [{ data: null, error: null }] });
		expect(await listIssues()).toEqual([]);
	});

	it('throws the supabase error message on failure', async () => {
		mockDb({ queue: [{ data: null, error: { message: 'db exploded' } }] });
		await expect(listIssues()).rejects.toThrow('db exploded');
	});

	describe('filter leniency — invalid enum values are ignored', () => {
		it.each([
			['status', 'Ope'],
			['status', 'open'], // case-sensitive whitelist
			['priority', 'Urgent'],
			['topic', 'Roads'] // compound NLP variant must never hit eq()
		])('ignores invalid %s value %j', async (field, value) => {
			const db = mockDb({ queue: [{ data: [], error: null }] });

			await listIssues({ [field]: value });

			expect(db.lastCall().filters).toEqual([]);
		});
	});

	describe('filter application — valid values reach the query', () => {
		it('applies a valid status filter', async () => {
			const db = mockDb({ queue: [{ data: [], error: null }] });

			await listIssues({ status: 'In Progress' });

			expect(db.lastCall().filters).toEqual([
				{ type: 'eq', column: 'status', value: 'In Progress' }
			]);
		});

		it('applies a valid priority filter', async () => {
			const db = mockDb({ queue: [{ data: [], error: null }] });

			await listIssues({ priority: 'Critical' });

			expect(db.lastCall().filters).toEqual([
				{ type: 'eq', column: 'priority', value: 'Critical' }
			]);
		});

		it('applies a canonical topic filter', async () => {
			const db = mockDb({ queue: [{ data: [], error: null }] });

			await listIssues({ topic: 'Waste Management' });

			expect(db.lastCall().filters).toEqual([
				{ type: 'eq', column: 'topic', value: 'Waste Management' }
			]);
		});

		it('applies the assignee filter without whitelist validation', async () => {
			const db = mockDb({ queue: [{ data: [], error: null }] });

			await listIssues({ assignee: 'user-abc' });

			expect(db.lastCall().filters).toEqual([
				{ type: 'eq', column: 'assigned_to', value: 'user-abc' }
			]);
		});
	});

	describe('q keyword search', () => {
		it('trims whitespace before building the ilike pattern', async () => {
			const db = mockDb({ queue: [{ data: [], error: null }] });

			await listIssues({ q: '  flood  ' });

			expect(db.lastCall().filters).toEqual([{ type: 'ilike', column: 'title', value: '%flood%' }]);
		});

		it('ignores whitespace-only q', async () => {
			const db = mockDb({ queue: [{ data: [], error: null }] });

			await listIssues({ q: '   ' });

			expect(db.lastCall().filters).toEqual([]);
		});

		it('wraps embedded keywords with wildcards', async () => {
			const db = mockDb({ queue: [{ data: [], error: null }] });

			await listIssues({ q: 'street light' });

			expect(db.lastCall().filters).toEqual([
				{ type: 'ilike', column: 'title', value: '%street light%' }
			]);
		});
	});

	it('chains every valid filter together in one query', async () => {
		const db = mockDb({ queue: [{ data: [], error: null }] });

		await listIssues({
			status: 'Open',
			priority: 'Low',
			topic: 'Other',
			q: 'drainage'
		});

		expect(db.lastCall().filters).toEqual([
			{ type: 'eq', column: 'status', value: 'Open' },
			{ type: 'eq', column: 'priority', value: 'Low' },
			{ type: 'eq', column: 'topic', value: 'Other' },
			{ type: 'ilike', column: 'title', value: '%drainage%' }
		]);
	});
});
