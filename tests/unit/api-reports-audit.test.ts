import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

// Mock exceljs - need to mock the default export which has Workbook constructor
const mockWriteBuffer = vi.fn(() => Promise.resolve(Buffer.from('mock-xlsx-data')));

const mockSheet = {
	columns: [],
	addRow: vi.fn(),
	getRow: vi.fn(() => ({ font: vi.fn() }))
};

const mockWorkbook = {
	addWorksheet: vi.fn(() => mockSheet),
	xlsx: { writeBuffer: mockWriteBuffer }
};

vi.mock('exceljs', () => ({
	default: {
		Workbook: class {
			constructor() {
				return mockWorkbook;
			}
		}
	}
}));

import { GET } from '../../src/routes/api/reports/audit/+server';
import { createFakeSupabase, type FakeResult } from './helpers/fake-supabase';
import {
	makeGetEvent,
	expectLoginRedirect,
	type RouteHandler,
	type IssueRouteEvent
} from './helpers/api';

const get = GET as unknown as RouteHandler;

function mockDb(opts: {
	user?: { id: string; app_metadata?: { role?: string } };
	profile?: { role?: string } | null;
	auditLogs?: any[];
}): IssueRouteEvent {
	const db = createFakeSupabase({
		match: (call): FakeResult => {
			if (call.verb === 'select' && call.table === 'profiles') {
				return { data: opts.profile ?? null, error: null };
			}
			if (call.verb === 'select' && call.table === 'audit_logs') {
				return { data: opts.auditLogs ?? [], error: null };
			}
			return { data: null, error: null };
		}
	});
	getServiceSupabase.mockReturnValue(db);

	// Create base event and override supabase
	const event = makeGetEvent('/api/reports/audit', { user: opts.user });
	(event as any).locals.supabase = db;
	return event;
}

async function runRoute(
	handler: any,
	event: IssueRouteEvent
): Promise<{ status: number; headers: Headers; body: string | null; error?: any }> {
	try {
		const res = await handler(event);
		return {
			status: res.status,
			headers: res.headers,
			body: await res.text().catch(() => null)
		};
	} catch (err: any) {
		console.error('Route error:', err);
		return {
			status: err.status ?? 500,
			headers: new Headers(),
			body: err.body ?? null,
			error: err.message ?? err
		};
	}
}

describe('GET /api/reports/audit', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWriteBuffer.mockClear();
		mockSheet.addRow.mockClear();
		mockSheet.getRow.mockClear();
		mockWorkbook.addWorksheet.mockClear();
	});

	it('redirects to /login when unauthenticated', async () => {
		await expectLoginRedirect(get(makeGetEvent('/api/reports/audit', { authenticated: false })));
	});

	it('forbids access when JWT role is not admin (403)', async () => {
		const event = mockDb({
			user: { id: 'user-123', app_metadata: { role: 'analyst' } },
			profile: { role: 'analyst' }
		});

		const result = await runRoute(get, event);
		expect(result.status).toBe(403);
	});

	it('forbids access when database role is not admin (403)', async () => {
		const event = mockDb({
			user: { id: 'user-123', app_metadata: { role: 'admin' } },
			profile: { role: 'analyst' }
		});

		const result = await runRoute(get, event);
		expect(result.status).toBe(403);
	});

	it('allows access when both JWT and database roles are admin', async () => {
		const event = mockDb({
			user: { id: 'user-123', app_metadata: { role: 'admin' } },
			profile: { role: 'admin' },
			auditLogs: []
		});

		const result = await runRoute(get, event);
		expect(result.status).toBe(200);
	});

	it('returns Excel file with correct headers', async () => {
		const event = mockDb({
			user: { id: 'user-123', app_metadata: { role: 'admin' } },
			profile: { role: 'admin' },
			auditLogs: [
				{
					id: 'log-1',
					action: 'INSERT',
					actor_email: 'admin@example.com',
					details: '{"table":"profiles"}',
					resource_type: 'profiles',
					resource_id: 'prof-1',
					ip_address: '127.0.0.1',
					user_agent: 'test-agent',
					created_at: '2024-01-15T10:00:00Z'
				}
			]
		});

		const result = await runRoute(get, event);
		expect(result.status).toBe(200);
		expect(result.headers.get('Content-Type')).toBe(
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		);
		expect(result.headers.get('Content-Disposition')).toMatch(
			/attachment; filename="system-audit-/i
		);
		expect(mockWorkbook.addWorksheet).toHaveBeenCalledWith('Audit Logs');
		expect(mockWriteBuffer).toHaveBeenCalled();
	});

	it('handles empty audit logs gracefully', async () => {
		const event = mockDb({
			user: { id: 'user-123', app_metadata: { role: 'admin' } },
			profile: { role: 'admin' },
			auditLogs: []
		});

		const result = await runRoute(get, event);
		expect(result.status).toBe(200);
		expect(mockWriteBuffer).toHaveBeenCalled();
	});
});
