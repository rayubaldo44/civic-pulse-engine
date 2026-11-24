import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import ReferenceDocuments from '../../../src/routes/Authenticated/reference-docs/+page.svelte';

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
const doc = (id: string, title: string) => ({
	id,
	title,
	document_type: 'Ordinance',
	is_active: true,
	uploaded_at: '2026-01-01T00:00:00Z'
});
const data = {
	documents: [doc('a', 'Road funding'), doc('b', 'Waste services')],
	categories: [],
	documentTypes: ['Ordinance'],
	role: 'analyst',
	total: 151,
	documentCount: 300,
	page: 1,
	pageSize: 25,
	searchTerm: ''
};
function pending<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
}
function response(id: string, content: string) {
	return new Response(JSON.stringify({ ...doc(id, id), content }), { status: 200 });
}

describe('Reference document lazy loading', () => {
	beforeEach(() => vi.unstubAllGlobals());
	it('does not download document content until opened and disables saving until ready', async () => {
		const deferred = pending<Response>();
		const fetchMock = vi.fn(() => deferred.promise);
		vi.stubGlobal('fetch', fetchMock);
		render(ReferenceDocuments, { data: data as any, form: null });
		expect(fetchMock).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: /Road funding/i }));
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/reference-docs/a',
			expect.objectContaining({ signal: expect.any(AbortSignal) })
		);
		expect(
			(screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement).disabled
		).toBe(true);
		deferred.resolve(response('a', 'Road text\n\n[attachment:staff/manual.pdf]'));
		await waitFor(() =>
			expect((screen.getByLabelText('Content / Summary') as HTMLTextAreaElement).value).toBe(
				'Road text'
			)
		);
		expect((document.querySelector('input[name="attachRef"]') as HTMLInputElement).value).toBe(
			'staff/manual.pdf'
		);
		expect(
			(screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement).disabled
		).toBe(false);
	});
	it('shows a recoverable load error and does not allow saving blank content', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response('{}', { status: 500 }))
			.mockResolvedValueOnce(response('a', 'Recovered content'));
		vi.stubGlobal('fetch', fetchMock);
		render(ReferenceDocuments, { data: data as any, form: null });
		await fireEvent.click(screen.getByRole('button', { name: /Road funding/i }));
		await waitFor(() =>
			expect(screen.getByRole('button', { name: 'Retry loading document' })).toBeTruthy()
		);
		expect(
			(screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement).disabled
		).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: 'Retry loading document' }));
		await waitFor(() =>
			expect((screen.getByLabelText('Content / Summary') as HTMLTextAreaElement).value).toBe(
				'Recovered content'
			)
		);
	});
	it('aborts closed requests and ignores late content from a previously selected document', async () => {
		const old = pending<Response>();
		const fetchMock = vi
			.fn()
			.mockReturnValueOnce(old.promise)
			.mockResolvedValueOnce(response('b', 'New content'));
		vi.stubGlobal('fetch', fetchMock);
		render(ReferenceDocuments, { data: data as any, form: null });
		await fireEvent.click(screen.getByRole('button', { name: /Road funding/i }));
		const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
		await fireEvent.click(screen.getByRole('button', { name: 'Close document details' }));
		expect(signal.aborted).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: /Waste services/i }));
		await waitFor(() =>
			expect((screen.getByLabelText('Content / Summary') as HTMLTextAreaElement).value).toBe(
				'New content'
			)
		);
		old.resolve(response('a', 'Old content'));
		await waitFor(() =>
			expect((screen.getByLabelText('Content / Summary') as HTMLTextAreaElement).value).toBe(
				'New content'
			)
		);
	});
	it('shows the whole-library count and server-side search form', () => {
		vi.stubGlobal('fetch', vi.fn());
		render(ReferenceDocuments, { data: data as any, form: null });
		expect(screen.getByText('300')).toBeTruthy();
		expect(screen.getByRole('navigation', { name: 'Pagination' }).textContent).toContain('151');
		const search = screen.getByPlaceholderText(
			'Search document titles or types...'
		) as HTMLInputElement;
		expect(search.name).toBe('q');
		expect(search.form?.method.toLowerCase()).toBe('get');
	});
});
