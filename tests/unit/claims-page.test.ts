import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listClaimsPage } from '$lib/server/claims';
import { getServiceSupabase } from '$lib/server/supabase';
import { createFakeSupabase } from './helpers/fake-supabase';
import { makeGetEvent, expectRedirect } from './helpers/api';
import { load as flaggedLoad } from '../../src/routes/Authenticated/flagged-claims/+page.server';
import { load as verifiedLoad } from '../../src/routes/Authenticated/verified-claims/+page.server';

vi.mock('$lib/server/supabase', () => ({ getServiceSupabase: vi.fn() }));
const getService = vi.mocked(getServiceSupabase);
const empty = {
	items: [],
	total: 0,
	counts: { Pending: 0, 'Verified True': 0, 'Verified False': 0, Inconclusive: 0 }
};

beforeEach(() => vi.clearAllMocks());

describe('claims page queries', () => {
	it('asks the database for the sixth bounded page and full-record search/counts', async () => {
		const db = createFakeSupabase({
			queue: [
				{
					data: { ...empty, total: 151, items: [{ id: 'claim-126', status: 'Verified True' }] },
					error: null
				}
			]
		});
		getService.mockReturnValue(db as never);
		const result = await listClaimsPage(
			new URLSearchParams('page=6&q=bridge&status=Verified+True'),
			true
		);
		expect(result).toMatchObject({
			page: 6,
			pageSize: 25,
			total: 151,
			items: [{ id: 'claim-126' }]
		});
		expect(db.lastCall().rpc).toEqual({
			name: 'get_claims_page',
			args: { p_archive: true, p_page: 6, p_search: 'bridge', p_status: 'Verified True' }
		});
	});
	it('uses safe defaults for unknown status and malformed page', async () => {
		const db = createFakeSupabase({ queue: [{ data: empty, error: null }] });
		getService.mockReturnValue(db as never);
		await listClaimsPage(new URLSearchParams('page=1x&status=evil'), false);
		expect(db.lastCall().rpc?.args).toEqual({
			p_archive: false,
			p_page: 1,
			p_search: '',
			p_status: null
		});
	});
	it('preserves database authoritative latest review and global decision counts', async () => {
		const db = createFakeSupabase({
			queue: [
				{
					data: {
						...empty,
						items: [{ id: 'old-row', status: 'Inconclusive' }],
						total: 150,
						counts: { Pending: 0, 'Verified True': 50, 'Verified False': 50, Inconclusive: 50 }
					},
					error: null
				}
			]
		});
		getService.mockReturnValue(db as never);
		const result = await listClaimsPage(new URLSearchParams('status=Inconclusive'), true);
		expect(result.items[0].status).toBe('Inconclusive');
		expect(result.counts.Inconclusive).toBe(50);
		expect(result.total).toBe(150);
	});
	it('surfaces database failure instead of a successful empty list', async () => {
		getService.mockReturnValue(
			createFakeSupabase({ queue: [{ data: null, error: { message: 'missing RPC' } }] }) as never
		);
		await expect(listClaimsPage(new URLSearchParams(), false)).rejects.toMatchObject({
			message: 'missing RPC'
		});
	});
});

describe('claims routes', () => {
	it.each([flaggedLoad, verifiedLoad])(
		'requires a verified session before service-role reads',
		async (load) => {
			await expectRedirect(
				load({
					...makeGetEvent('/Authenticated/flagged-claims', { authenticated: false }),
					depends: vi.fn()
				} as never),
				{ location: '/login' }
			);
			expect(getService).not.toHaveBeenCalled();
		}
	);
	it('returns page metadata and scoped dependency for flagged claims', async () => {
		getService.mockReturnValue(
			createFakeSupabase({ queue: [{ data: { ...empty, total: 130 }, error: null }] }) as never
		);
		const depends = vi.fn();
		const result = await flaggedLoad({
			...makeGetEvent('/Authenticated/flagged-claims?page=6'),
			depends
		} as never);
		expect(result).toMatchObject({
			flaggedItems: [],
			pagination: { page: 6, pageSize: 25, total: 130 }
		});
		expect(depends).toHaveBeenCalledWith('claims:list');
	});
});
