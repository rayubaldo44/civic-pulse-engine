import { describe, expect, it } from 'vitest';
import { load } from '../../src/routes/Authenticated/reference-docs/+page.server';
import { GET } from '../../src/routes/api/reference-docs/[id]/+server';

const ID = 'b2e9ddaa-d839-462d-87bc-908fc94ea261';
function client(results: Record<string, any>) {
	const calls: {
		table: string;
		select?: string;
		options?: unknown;
		range?: number[];
		orders: string[];
		filter?: string;
		id?: string;
	}[] = [];
	return {
		calls,
		from(table: string) {
			const call = { table, orders: [] as string[] } as (typeof calls)[number];
			calls.push(call);
			const builder = {
				select(columns: string, options?: unknown) {
					call.select = columns;
					call.options = options;
					return this;
				},
				order(column: string) {
					call.orders.push(column);
					return this;
				},
				range(from: number, to: number) {
					call.range = [from, to];
					return this;
				},
				limit() {
					return this;
				},
				or(value: string) {
					call.filter = value;
					return this;
				},
				eq(_column: string, value: string) {
					call.id = value;
					return this;
				},
				maybeSingle() {
					return Promise.resolve(results[table]);
				},
				then(resolve: (value: any) => unknown) {
					return Promise.resolve(results[table]).then(resolve);
				}
			};
			return builder;
		}
	};
}
function event(db: ReturnType<typeof client>, query = '', authenticated = true) {
	return {
		url: new URL(`http://localhost/Authenticated/reference-docs${query}`),
		params: { id: ID },
		depends: () => {},
		setHeaders: () => {},
		locals: {
			safeGetSession: async () => ({ user: authenticated ? { id: 'u1' } : null }),
			supabase: db
		}
	} as any;
}
describe('reference library loading', () => {
	it('returns only 25 metadata rows beyond the first 100, with full-result totals', async () => {
		const db = client({
			lgu_documents: { data: [{ id: ID, title: 'Budget' }], count: 151, error: null },
			nlp_categories: { data: [], error: null }
		});
		const result = (await load(event(db, '?page=6'))) as any;
		expect(result).toMatchObject({ total: 151, page: 6, pageSize: 25, documentCount: 151 });
		const call = db.calls.find((c) => c.table === 'lgu_documents')!;
		expect(call.range).toEqual([125, 149]);
		expect(call.select?.split(',').map((s) => s.trim())).not.toContain('content');
		expect(call.orders).toEqual(['uploaded_at', 'id']);
	});
	it('searches titles and types in the database and escapes filter syntax', async () => {
		const db = client({
			lgu_documents: { data: [], count: 151, error: null },
			nlp_categories: { data: [], error: null }
		});
		const result = (await load(event(db, '?q=road%2Cbridge%25&page=2'))) as any;
		expect(result.searchTerm).toBe('road,bridge%');
		const call = db.calls.find((c) => c.filter)!;
		expect(call.filter).toBe(
			'title.ilike."%road,bridge\\\\%%",document_type.ilike."%road,bridge\\\\%%"'
		);
		expect(call.range).toEqual([25, 49]);
	});
	it('surfaces a failed list rather than claiming the library is empty', async () => {
		const db = client({
			lgu_documents: { data: null, error: { message: 'offline' } },
			nlp_categories: { data: [], error: null }
		});
		await expect(load(event(db))).rejects.toMatchObject({ status: 500 });
	});
	it('redirects signed-out visitors before querying', async () => {
		const db = client({});
		await expect(load(event(db, '', false))).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(db.calls).toHaveLength(0);
	});
});
describe('reference document detail', () => {
	it('returns one full document using the authenticated client', async () => {
		const document = { id: ID, title: 'Budget', content: 'Full content' };
		const db = client({ lgu_documents: { data: document, error: null } });
		const response = (await GET(event(db))) as Response;
		expect(await response.json()).toEqual(document);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(db.calls[0].id).toBe(ID);
	});
	it('returns 404 for absent documents', async () => {
		const db = client({ lgu_documents: { data: null, error: null } });
		const response = (await GET(event(db))) as Response;
		expect(response.status).toBe(404);
	});
	it('returns a generic recoverable error without exposing database details', async () => {
		const db = client({ lgu_documents: { data: null, error: { message: 'private db detail' } } });
		const response = (await GET(event(db))) as Response;
		expect(response.status).toBe(500);
		expect(await response.text()).not.toContain('private db detail');
	});
	it('does not query for a signed-out request', async () => {
		const db = client({});
		await expect(GET(event(db, '', false))).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(db.calls).toHaveLength(0);
	});
});
