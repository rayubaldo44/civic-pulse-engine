import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

import { GET } from '../../src/routes/api/sentiment-trends/+server';
import { createFakeSupabase, type FakeResult } from './helpers/fake-supabase';
import { makeGetEvent, expectLoginRedirect, type RouteHandler } from './helpers/api';
import { TREND_RANGES } from '$lib/server/sentiment-trends';

const get = GET as unknown as RouteHandler;
const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

function mockDb(opts: {
	rows?: Array<{
		processed_at: string;
		sentiment_label: string | null;
		topic_label: string | null;
		raw_content?: any;
	}>;
	grpc?: { data?: any[] | null; error?: { message: string; code?: string } | null };
}) {
	const db = createFakeSupabase({
		match: (call): FakeResult => {
			if (call.verb === 'select' && call.table === 'processed_content') {
				return { data: opts.rows ?? [], error: null };
			}
			if (call.verb === 'rpc' && call.table === 'get_sentiment_window_counts') {
				return { data: opts.grpc?.data ?? null, error: opts.grpc?.error ?? null };
			}
			return { data: null, error: null };
		}
	});
	getServiceSupabase.mockReturnValue(db);
	return db;
}

describe('GET /api/sentiment-trends', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		errSpy.mockClear();
	});

	it('redirects to /login when unauthenticated', async () => {
		await expectLoginRedirect(get(makeGetEvent('/api/sentiment-trends', { authenticated: false })));
	});

	it('returns live range trend data', async () => {
		mockDb({
			rows: [
				{
					processed_at: '2024-01-01T10:00:00Z',
					sentiment_label: 'positive',
					topic_label: 'Healthcare'
				},
				{
					processed_at: '2024-01-01T12:00:00Z',
					sentiment_label: 'negative',
					topic_label: 'Healthcare'
				}
			]
		});

		const res = await get(makeGetEvent('/api/sentiment-trends?range=live'));
		expect(res.status).toBe(200);

		const body = (await res.json()) as {
			range: string;
			positive: number[];
			negative: number[];
			neutral: number[];
			mode: string;
		};
		expect(body.range).toBe('live');
	});

	it('validates range parameter against TREND_RANGES whitelist', async () => {
		mockDb({ rows: [] });

		for (const invalidRange of ['invalid', 'monthlyy', '123']) {
			const res = await get(makeGetEvent(`/api/sentiment-trends?range=${invalidRange}`));
			const body = (await res.json()) as { range: string };
			expect(body.range, `range=${invalidRange}`).toBe('live');
		}
	});

	it('honors valid topic filter', async () => {
		const db = mockDb({
			rows: [
				{
					processed_at: '2024-01-01T10:00:00Z',
					sentiment_label: 'positive',
					topic_label: 'Healthcare'
				},
				{
					processed_at: '2024-01-01T12:00:00Z',
					sentiment_label: 'negative',
					topic_label: 'Public Safety'
				}
			]
		});

		const res = await get(makeGetEvent('/api/sentiment-trends?topic=Healthcare'));
		expect(res.status).toBe(200);
	});

	it('ignores invalid topic filter and processes the request', async () => {
		mockDb({ rows: [] });
		const res = await get(makeGetEvent('/api/sentiment-trends?topic=NotATopic'));
		expect(res.status).toBe(200);
	});

	it('honors valid platform filter', async () => {
		mockDb({
			rows: [
				{
					processed_at: '2024-01-01T10:00:00Z',
					sentiment_label: 'positive',
					topic_label: 'Healthcare',
					raw_content: { source_platform: 'facebook' }
				}
			]
		});

		const res = await get(makeGetEvent('/api/sentiment-trends?platform=facebook'));
		expect(res.status).toBe(200);
	});

	it('ignores invalid platform filter and processes the request', async () => {
		mockDb({ rows: [] });
		const res = await get(makeGetEvent('/api/sentiment-trends?platform=invalid'));
		expect(res.status).toBe(200);
	});

	it('returns cache-control headers', async () => {
		mockDb({ rows: [] });
		const res = await get(makeGetEvent('/api/sentiment-trends'));
		expect(res.headers.get('Cache-Control')).toBe('private, max-age=30, stale-while-revalidate=60');
	});

	it('catches errors and returns 500 with message', async () => {
		getServiceSupabase.mockImplementation(() => {
			throw new Error('unexpected db error');
		});

		const res = await get(makeGetEvent('/api/sentiment-trends'));
		expect(res.status).toBe(500);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe('unexpected db error');
		expect(errSpy).toHaveBeenCalled();
	});

	it('falls back to row fetch when RPC is missing (PGRST205)', async () => {
		const db = mockDb({
			grpc: { error: { code: 'PGRST205', message: 'Could not find the function' } },
			rows: [
				{
					processed_at: '2024-01-01T10:00:00Z',
					sentiment_label: 'positive',
					topic_label: 'Healthcare'
				}
			]
		});

		const res = await get(makeGetEvent('/api/sentiment-trends?range=weekly'));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { range: string };
		expect(body.range).toBe('weekly');
	});
});
