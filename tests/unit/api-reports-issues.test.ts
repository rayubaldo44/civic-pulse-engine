import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

import { GET } from '../../src/routes/api/reports/issues/+server';
import { createFakeSupabase, type FakeResult } from './helpers/fake-supabase';
import { makeGetEvent, expectLoginRedirect, type RouteHandler } from './helpers/api';

const get = GET as unknown as RouteHandler;

function mockDb(opts: {
	issues?: any[];
	logCounts?: Array<{ issue_id: string; change_count: number }>;
	issueError?: { message: string } | null;
	logError?: { message: string } | null;
}) {
	const db = createFakeSupabase({
		match: (call): FakeResult => {
			if (call.verb === 'select' && call.table === 'civic_issues') {
				if (opts.issueError) return { data: null, error: opts.issueError };
				return { data: opts.issues ?? [], error: null };
			}
			if (call.verb === 'rpc' && call.table === 'get_status_change_counts') {
				if (opts.logError) return { data: null, error: opts.logError };
				return { data: opts.logCounts ?? [], error: null };
			}
			return { data: null, error: null };
		}
	});
	getServiceSupabase.mockReturnValue(db);
	return db;
}

describe('GET /api/reports/issues', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('redirects to /login when unauthenticated', async () => {
		await expectLoginRedirect(get(makeGetEvent('/api/reports/issues', { authenticated: false })));
	});

	it('returns CSV of issues with their status change counts', async () => {
		mockDb({
			issues: [
				{
					id: 'issue-1',
					title: 'Broken pavement',
					topic: 'Infrastructure',
					priority: 'High',
					status: 'Open',
					created_at: '2024-01-15T10:00:00Z',
					resolved_at: null,
					assignee: { full_name: 'John Doe' }
				}
			],
			logCounts: [{ issue_id: 'issue-1', change_count: 3 }]
		});

		const res = await get(makeGetEvent('/api/reports/issues'));
		expect(res.status).toBe(200);

		const csv = await res.text();
		expect(csv).toContain('ID');
		expect(csv).toContain('issue-1');
		expect(csv).toContain('John Doe');
		expect(csv).toContain('3');
	});

	it('orders issues by created_at descending', async () => {
		mockDb({
			issues: [
				{
					id: 'issue-1',
					title: 'First',
					topic: 'Healthcare',
					priority: 'Medium',
					status: 'Open',
					created_at: '2024-01-10T10:00:00Z',
					resolved_at: null,
					assignee: null
				},
				{
					id: 'issue-2',
					title: 'Second',
					topic: 'Healthcare',
					priority: 'Medium',
					status: 'Open',
					created_at: '2024-01-11T10:00:00Z',
					resolved_at: null,
					assignee: null
				}
			],
			logCounts: []
		});

		const res = await get(makeGetEvent('/api/reports/issues'));
		const csv = await res.text();
		expect(csv.indexOf('Second')).toBeGreaterThan(csv.indexOf('First'));
	});

	it('sets correct CSV content-type with charset', async () => {
		mockDb({ issues: [], logCounts: [] });
		const res = await get(makeGetEvent('/api/reports/issues'));
		expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
	});

	it('sets content-disposition header for download', async () => {
		mockDb({ issues: [], logCounts: [] });
		const res = await get(makeGetEvent('/api/reports/issues'));
		expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="issues-/i);
	});

	it('handles issues with null assignee', async () => {
		mockDb({
			issues: [
				{
					id: 'issue-2',
					title: 'Unassigned issue',
					topic: 'Public Safety',
					priority: 'Medium',
					status: 'Open',
					created_at: '2024-01-01T10:00:00Z',
					resolved_at: null,
					assignee: null
				}
			],
			logCounts: [{ issue_id: 'issue-2', change_count: 0 }]
		});

		const res = await get(makeGetEvent('/api/reports/issues'));
		const csv = await res.text();
		expect(csv).toContain('Unassigned issue');
		expect(csv).toContain('0');
	});
});
