import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import FlaggedClaims from '../../../src/routes/Authenticated/flagged-claims/+page.svelte';
import VerifiedClaims from '../../../src/routes/Authenticated/verified-claims/+page.svelte';
import { invalidate } from '$app/navigation';

vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}) }));
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/Authenticated/flagged-claims') }
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});
const counts = { Pending: 120, 'Verified True': 80, 'Verified False': 30, Inconclusive: 10 };
const claim = {
	id: 'one',
	claim_text: 'First page claim',
	status: 'Pending',
	rag_determination: null,
	rag_evidence_snippet: null,
	source_platform: 'youtube',
	language: 'tl',
	created_at: '2026-01-01T00:00:00Z',
	processed_content: null,
	lgu_documents: null,
	linked_issue: null
};
const common = {
	counts,
	filters: { q: '', status: 'all' },
	pagination: { page: 1, pageSize: 25, total: 240 }
};

describe('claims pagination UI', () => {
	it('uses all-record counts and replaces flagged records after navigation', async () => {
		const { rerender } = render(FlaggedClaims, {
			data: { ...common, flaggedItems: [claim] } as never
		});
		expect(screen.getByText('120 Pending Review')).toBeTruthy();
		expect(screen.getAllByRole('link', { name: 'Next' })).toHaveLength(2);
		await rerender({
			data: {
				...common,
				flaggedItems: [{ ...claim, id: 'two', claim_text: 'Sixth page claim' }],
				pagination: { page: 6, pageSize: 25, total: 240 }
			} as never
		});
		expect(screen.queryByText(/First page claim/)).toBeNull();
		expect(screen.getByText(/Sixth page claim/)).toBeTruthy();
	});
	it('invalidates the paged query after a successful review', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}'))
		);
		render(FlaggedClaims, { data: { ...common, flaggedItems: [claim] } as never });
		await fireEvent.click(screen.getByRole('button', { name: 'Verify True' }));
		await waitFor(() => expect(invalidate).toHaveBeenCalledWith('claims:list'));
	});
	it('shows archive counts outside this page and synchronizes new server filters', async () => {
		const { rerender } = render(VerifiedClaims, {
			data: { ...common, verifiedItems: [{ ...claim, status: 'Verified True' }] } as never
		});
		expect(screen.getByText('80 True')).toBeTruthy();
		expect(screen.getByRole('option', { name: 'All (120)' })).toBeTruthy();
		await rerender({
			data: {
				...common,
				filters: { q: 'whole archive', status: 'Inconclusive' },
				verifiedItems: [
					{ ...claim, id: 'new', claim_text: 'Latest reviewed page', status: 'Inconclusive' }
				]
			} as never
		});
		expect(screen.queryByText(/First page claim/)).toBeNull();
		expect(screen.getByText(/Latest reviewed page/)).toBeTruthy();
		expect(
			(screen.getByPlaceholderText('Search claims, evidence, documents...') as HTMLInputElement)
				.value
		).toBe('whole archive');
	});
});
