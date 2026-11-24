import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

import { GET } from '../../src/routes/api/reports/flagged-claims/+server';
import { createFakeSupabase, type FakeResult } from './helpers/fake-supabase';
import { makeGetEvent, expectLoginRedirect, type RouteHandler } from './helpers/api';

const get = GET as unknown as RouteHandler;

function mockDb(opts: { issues?: any[] }) {
	const db = createFakeSupabase({
		match: (call): FakeResult => {
			if (call.verb === 'select' && call.table === 'flagged_claims') {
				return { data: opts.issues ?? [], error: null };
			}
			return { data: null, error: null };
		}
	});
	getServiceSupabase.mockReturnValue(db);
	return db;
}

describe('GET /api/reports/flagged-claims', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('redirects to /login when unauthenticated', async () => {
		await expectLoginRedirect(
			get(makeGetEvent('/api/reports/flagged-claims', { authenticated: false }))
		);
	});

	it('returns CSV of flagged claims', async () => {
		mockDb({
			issues: [
				{
					id: 'fc-1',
					claim_text: 'False claim about LGU',
					rag_determination: 'RAG Refuted',
					rag_evidence_snippet: 'Document XYZ',
					status: 'Pending',
					source_platform: 'facebook',
					created_at: '2024-01-15T10:00:00Z',
					processed_content: { sentiment_label: 'negative', topic_label: 'Public Safety' }
				}
			]
		});

		const res = await get(makeGetEvent('/api/reports/flagged-claims'));
		expect(res.status).toBe(200);

		const csv = await res.text();
		expect(csv).toContain('ID');
		expect(csv).toContain('Claim');
		expect(csv).toContain('False claim about LGU');
		expect(csv).toContain('RAG Refuted');
		expect(csv).toContain('Pending');
	});

	it('handles null processed_content gracefully', async () => {
		mockDb({
			issues: [
				{
					id: 'fc-2',
					claim_text: 'Claim without processed content',
					rag_determination: 'RAG Insufficient Evidence',
					rag_evidence_snippet: '',
					status: 'Pending',
					source_platform: 'test',
					created_at: '2024-01-15T10:00:00Z',
					processed_content: null
				}
			]
		});

		const res = await get(makeGetEvent('/api/reports/flagged-claims'));
		const csv = await res.text();
		expect(csv).toContain('Claim without processed content');
		expect(csv).toContain('RAG Insufficient Evidence');
	});

	it('returns empty CSV for no data', async () => {
		mockDb({ issues: [] });
		const res = await get(makeGetEvent('/api/reports/flagged-claims'));
		const csv = await res.text();
		expect(csv).toContain('ID');
	});

	it('sets CSV content-type', async () => {
		mockDb({ issues: [] });
		const res = await get(makeGetEvent('/api/reports/flagged-claims'));
		expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
	});

	it('sets content-disposition for download', async () => {
		mockDb({ issues: [] });
		const res = await get(makeGetEvent('/api/reports/flagged-claims'));
		expect(res.headers.get('Content-Disposition')).toMatch(
			/attachment; filename="flagged-claims-/i
		);
	});
});
