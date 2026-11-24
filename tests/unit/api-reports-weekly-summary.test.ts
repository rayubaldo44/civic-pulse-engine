import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

// Mock pdfkit
vi.mock('pdfkit', () => {
	return {
		default: class MockPDFDocument {
			chunks: Uint8Array[] = [];
			on(event: string, cb: any) {
				if (event === 'data') {
					this.dataCb = cb;
				} else if (event === 'end') {
					this.endCb = cb;
				} else if (event === 'error') {
					this.errorCb = cb;
				}
				return this;
			}
			dataCb!: (chunk: Uint8Array) => void;
			endCb!: () => void;
			errorCb!: (err: any) => void;
			fontSize() {
				return this;
			}
			font() {
				return this;
			}
			text() {
				return this;
			}
			moveDown() {
				return this;
			}
			fillColor() {
				return this;
			}
			align() {
				return this;
			}
			end() {
				const buf = new Uint8Array([0x50, 0x44, 0x46, 0x0d, 0x0a]); // PDF magic
				this.dataCb(buf);
				this.endCb();
				return this;
			}
		}
	};
});

import { GET } from '../../src/routes/api/reports/weekly-summary/+server';
import { createFakeSupabase, type FakeResult } from './helpers/fake-supabase';
import { makeGetEvent, expectLoginRedirect, type RouteHandler } from './helpers/api';

const get = GET as unknown as RouteHandler;

function mockDb(opts: {
	processedRows?: Array<{ sentiment_label?: string; topic_label?: string }>;
	flaggedCount?: number;
}) {
	const db = createFakeSupabase({
		match: (call): FakeResult => {
			if (call.verb === 'select' && call.table === 'processed_content') {
				return { data: opts.processedRows ?? [], error: null };
			}
			if (call.verb === 'select' && call.table === 'flagged_claims') {
				return { data: [], count: opts.flaggedCount ?? 0, error: null };
			}
			return { data: null, error: null };
		}
	});
	getServiceSupabase.mockReturnValue(db);
	return db;
}

describe('GET /api/reports/weekly-summary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('redirects to /login when unauthenticated', async () => {
		await expectLoginRedirect(
			get(makeGetEvent('/api/reports/weekly-summary', { authenticated: false }))
		);
	});

	it('generates PDF with correct headers', async () => {
		mockDb({
			processedRows: [
				{ sentiment_label: 'positive', topic_label: 'Healthcare' },
				{ sentiment_label: 'negative', topic_label: 'Public Safety' },
				{ sentiment_label: 'neutral', topic_label: 'Healthcare' }
			],
			flaggedCount: 2
		});

		const res = await get(makeGetEvent('/api/reports/weekly-summary'));
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/pdf');
		expect(res.headers.get('Content-Disposition')).toMatch(
			/attachment; filename="weekly-summary-/i
		);
	});

	it('handles empty processed_content gracefully', async () => {
		mockDb({ processedRows: [], flaggedCount: 0 });
		const res = await get(makeGetEvent('/api/reports/weekly-summary'));
		expect(res.status).toBe(200);
	});
});
