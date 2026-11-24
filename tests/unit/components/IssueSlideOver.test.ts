import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import IssueSlideOver from '$lib/components/IssueSlideOver.svelte';
import type { IssueDetail, Profile } from '$lib/types/issues';

afterEach(cleanup);

const STAFF: Profile[] = [
	{ id: 'staff-a', full_name: 'Ana Reyes' },
	{ id: 'staff-b', full_name: 'Ben Cruz' }
];

function makeDetail(overrides: Partial<IssueDetail> = {}): IssueDetail {
	return {
		id: 'issue-1',
		title: 'Broken streetlight',
		description: 'Dark corner near the school',
		topic: 'Public Safety',
		priority: 'High',
		status: 'Open',
		created_at: '2026-08-01T00:00:00Z',
		updated_at: '2026-08-01T00:00:00Z',
		resolved_at: null,
		source_comment_id: null,
		source_flagged_claim_id: null,
		assigned_to: null,
		created_by: null,
		assignee: null,
		creator: null,
		comments: [],
		status_logs: [],
		source_comment: null,
		source_claim: null,
		...overrides
	};
}

type Reply = { ok?: boolean; status?: number; body?: unknown };

type Handlers = {
	detail?: IssueDetail | null;
	open?: boolean;
	loading?: boolean;
	fetchReply?: (url: string) => Reply;
};

function setup(handlers: Handlers = {}) {
	const replies: (url: string) => Reply = handlers.fetchReply ?? (() => ({ body: {} }));
	const fetchMock = vi.fn((url: string, init?: RequestInit) =>
		Promise.resolve({
			ok: replies(url).ok ?? true,
			status: replies(url).status ?? 200,
			json: async () => replies(url).body ?? {}
		} as Response)
	);
	vi.stubGlobal('fetch', fetchMock);

	const onClose = vi.fn();
	const onUpdate = vi.fn();
	const onRefetch = vi.fn();
	const result = render(IssueSlideOver, {
		detail: handlers.detail === undefined ? makeDetail() : handlers.detail,
		loading: handlers.loading ?? false,
		open: handlers.open ?? true,
		staff: STAFF,
		onClose,
		onUpdate,
		onRefetch
	});
	return { ...result, fetchMock, onClose, onUpdate, onRefetch };
}

const patchCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
	fetchMock.mock.calls.filter(([url]) => !String(url).endsWith('/comments'));

describe('IssueSlideOver — rendering', () => {
	it('renders the issue title and description when open', () => {
		setup();

		expect(screen.getByText('Broken streetlight')).toBeTruthy();
		expect(screen.getByText(/Dark corner near the school/)).toBeTruthy();
	});

	it('offers only the current status plus legal transitions', () => {
		setup({ detail: makeDetail({ status: 'Open' }) });

		const options = [...screen.getAllByRole('option')].map((o) => o.textContent);
		expect(options).toContain('Open');
		expect(options).toContain('In Progress');
		expect(options).toContain('Closed');
		expect(options).not.toContain('Resolved'); // Open → Resolved is illegal
	});

	it('lists staff members in the assignee dropdown', () => {
		setup();

		const options = [...screen.getAllByRole('option')].map((o) => o.textContent);
		expect(options).toContain('Ana Reyes');
		expect(options).toContain('Ben Cruz');
	});
});

describe('IssueSlideOver — keyboard', () => {
	it('closes via Escape while open', async () => {
		const { onClose } = setup({ open: true });

		await fireEvent.keyDown(document, { key: 'Escape' });

		expect(onClose).toHaveBeenCalledOnce();
	});
});

describe('IssueSlideOver — comments', () => {
	beforeEach(() => vi.unstubAllGlobals());
	afterEach(() => vi.unstubAllGlobals());

	it('posts the trimmed comment and appends it optimistically', async () => {
		const posted = {
			id: 'c-new',
			body: 'Crew dispatched',
			created_at: '2026-08-02T00:00:00Z',
			author: { id: 'staff-a', full_name: 'Ana Reyes' }
		};
		const io = setup({
			detail: makeDetail(),
			fetchReply: () => ({ body: posted })
		});

		const textarea = screen.getByPlaceholderText(/Add an internal comment/);
		await fireEvent.input(textarea, { target: { value: '  Crew dispatched  ' } });

		const submit = screen.getByRole('button', { name: /Post Comment/ });
		expect((submit as HTMLButtonElement).disabled).toBe(false);
		await fireEvent.click(submit);

		const [url, init] = io.fetchMock.mock.calls[0];
		expect(url).toBe('/api/issues/issue-1/comments');
		expect(init?.method).toBe('POST');
		expect(JSON.parse(String(init?.body))).toEqual({ body: 'Crew dispatched' });
		expect(screen.getByText('Crew dispatched')).toBeTruthy();
		expect((textarea as HTMLTextAreaElement).value).toBe('');
	});

	it('shows the server error message when posting fails', async () => {
		setup({
			detail: makeDetail(),
			fetchReply: () => ({ ok: false, status: 400, body: { error: 'body is required' } })
		});

		await fireEvent.input(screen.getByPlaceholderText(/Add an internal comment/), {
			target: { value: 'hello' }
		});
		await fireEvent.click(screen.getByRole('button', { name: /Post Comment/ }));

		expect(await screen.findByText('body is required')).toBeTruthy();
	});
});

describe('IssueSlideOver — auto-saving controls', () => {
	beforeEach(() => vi.unstubAllGlobals());
	afterEach(() => vi.unstubAllGlobals());

	it('PATCHes priority changes without triggering a refetch', async () => {
		const updated = makeDetail({ priority: 'Critical' });
		const io = setup({ detail: makeDetail(), fetchReply: () => ({ body: updated }) });

		await fireEvent.change(screen.getByLabelText('Priority'), {
			target: { value: 'Critical' }
		});

		const [call] = patchCalls(io.fetchMock);
		expect(call?.[0]).toBe('/api/issues/issue-1');
		expect(call?.[1]?.method).toBe('PATCH');
		expect(JSON.parse(String(call?.[1]?.body))).toEqual({ priority: 'Critical' });
		expect(io.onUpdate).toHaveBeenCalledWith(updated);
		expect(io.onRefetch).not.toHaveBeenCalled();
	});

	it('PATCHes status changes and refetches so history stays fresh', async () => {
		const updated = makeDetail({ status: 'In Progress' });
		const io = setup({
			detail: makeDetail({ status: 'Open' }),
			fetchReply: () => ({ body: updated })
		});

		await fireEvent.change(screen.getByLabelText('Status'), {
			target: { value: 'In Progress' }
		});

		const [call] = patchCalls(io.fetchMock);
		expect(JSON.parse(String(call?.[1]?.body))).toEqual({ status: 'In Progress' });
		expect(io.onRefetch).toHaveBeenCalled();
	});

	it('reverts the select and shows an error banner on failed PATCHes', async () => {
		const io = setup({
			detail: makeDetail({ priority: 'High' }),
			fetchReply: () => ({ ok: false, status: 500 })
		});

		const select = screen.getByLabelText('Priority') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'Low' } });

		// Waiting on the error banner guarantees the async onchange handler
		// (including the select revert) has fully settled.
		expect(await screen.findByText('Update failed')).toBeTruthy();
		expect(io.onUpdate).not.toHaveBeenCalled();
		expect(select.value).toBe('High');
	});
});
