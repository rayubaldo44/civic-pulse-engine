import { tick } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { AppNotification } from '$lib/types/notifications';

// Stub the SvelteKit virtual modules the component imports.
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import NotificationBell from '$lib/components/NotificationBell.svelte';

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
	return {
		id: 'n1',
		category: 'trend_alert',
		severity: 'info',
		title: 'Road Repair priority score is now high',
		body: 'Road Repair crossed into high priority at 78/100.',
		href: '/Authenticated/dashboard?topic=Infrastructure',
		entity_type: null,
		entity_id: null,
		read_at: null,
		created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
		...overrides
	};
}

/** Stub fetch so the component never touches the network in tests. */
function stubFetch(body: { notifications?: AppNotification[]; unread?: number }) {
	const fetchMock = vi.fn(
		async () =>
			new Response(JSON.stringify({ notifications: [], unread: 0, ...body }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('NotificationBell', () => {
	beforeEach(() => vi.unstubAllGlobals());

	it('renders the bell with the SSR-seeded unread count', () => {
		stubFetch({});
		render(NotificationBell, { initialUnread: 3, pollIntervalMs: 0 });

		const button = screen.getByRole('button', { name: /notifications, 3 unread/i });
		expect(button).toBeTruthy();
		expect(screen.getByText('3')).toBeTruthy();
	});

	it('refreshes from the original SSR read time without an immediate duplicate request', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(100_000);
		const fetchMock = stubFetch({ unread: 2 });
		render(NotificationBell, { initialUnread: 3, initialFetchedAt: 60_000 });
		await tick();
		expect(fetchMock).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(4_999);
		expect(fetchMock).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await tick();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: /notifications, 2 unread/i })).toBeTruthy();
	});

	it('does not let an older layout seed overwrite a newer notification read', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(100_000);
		stubFetch({ unread: 2 });
		const component = render(NotificationBell, {
			initialUnread: 3,
			initialFetchedAt: 60_000,
			pollIntervalMs: 0
		});
		await fireEvent.click(screen.getByRole('button', { name: /notifications, 3 unread/i }));
		await tick();
		expect(screen.getByRole('button', { name: /notifications, 2 unread/i })).toBeTruthy();
		await component.rerender({ initialUnread: 8, initialFetchedAt: 65_000, pollIntervalMs: 0 });
		await tick();
		expect(screen.getByRole('button', { name: /notifications, 2 unread/i })).toBeTruthy();
	});

	it('shows no badge when there are no unread notifications', () => {
		stubFetch({});
		render(NotificationBell, { initialUnread: 0, pollIntervalMs: 0 });

		expect(screen.getByRole('button', { name: /^notifications$/i })).toBeTruthy();
	});

	it('caps the badge at 99+', () => {
		stubFetch({});
		render(NotificationBell, { initialUnread: 150, pollIntervalMs: 0 });

		expect(screen.getByText('99+')).toBeTruthy();
	});

	it('fetches the feed when the panel is opened', async () => {
		const fetchMock = stubFetch({ notifications: [makeNotification()], unread: 1 });
		render(NotificationBell, { initialUnread: 0, pollIntervalMs: 0 });

		expect(fetchMock).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: /^notifications$/i }));

		await waitFor(() => {
			expect(screen.getByText('Road Repair priority score is now high')).toBeTruthy();
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('renders an explanatory empty state rather than a bare message', async () => {
		stubFetch({ notifications: [], unread: 0 });
		render(NotificationBell, { initialUnread: 0, pollIntervalMs: 0 });

		await fireEvent.click(screen.getByRole('button', { name: /^notifications$/i }));

		await waitFor(() => {
			expect(screen.getByText('Nothing new right now')).toBeTruthy();
		});
		// The empty state should explain what will appear, not just that nothing did.
		expect(screen.getByText(/priority score spikes/i)).toBeTruthy();
	});

	it('marks all read and sends the correct payload', async () => {
		const patchCalls: [input: RequestInfo | URL, init: RequestInit][] = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'PATCH') {
				patchCalls.push([input, init]);
				return new Response(JSON.stringify({ success: true, updated: 1, unread: 0 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
			return new Response(JSON.stringify({ notifications: [makeNotification()], unread: 1 }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		render(NotificationBell, { initialUnread: 1, pollIntervalMs: 0 });
		await fireEvent.click(screen.getByRole('button', { name: /notifications, 1 unread/i }));

		await waitFor(() => expect(screen.getByText('Mark all read')).toBeTruthy());
		await fireEvent.click(screen.getByText('Mark all read'));

		// Allow the async fetch to complete.
		await waitFor(() => expect(patchCalls).toHaveLength(1));
		expect(JSON.parse(String(patchCalls[0][1]!.body))).toEqual({ all: true });
	});

	it('marks a single item read when it is opened', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'PATCH') {
				return new Response(JSON.stringify({ success: true, updated: 1, unread: 0 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
			return new Response(JSON.stringify({ notifications: [makeNotification()], unread: 1 }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		render(NotificationBell, { initialUnread: 1, pollIntervalMs: 0 });
		await fireEvent.click(screen.getByRole('button', { name: /notifications, 1 unread/i }));

		await waitFor(() =>
			expect(screen.getByText('Road Repair priority score is now high')).toBeTruthy()
		);
		await fireEvent.click(screen.getByText('Road Repair priority score is now high'));

		await waitFor(() => {
			const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
			expect(patchCall).toBeDefined();
			expect(JSON.parse(String(patchCall![1]!.body))).toEqual({ ids: ['n1'] });
		});
	});

	it('closes the panel on Escape', async () => {
		stubFetch({ notifications: [makeNotification()], unread: 1 });
		render(NotificationBell, { initialUnread: 1, pollIntervalMs: 0 });

		await fireEvent.click(screen.getByRole('button', { name: /notifications, 1 unread/i }));
		await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

		await fireEvent.keyDown(window, { key: 'Escape' });

		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});

	it('exposes the panel as a labelled dialog', async () => {
		stubFetch({ notifications: [], unread: 0 });
		render(NotificationBell, { initialUnread: 0, pollIntervalMs: 0 });

		await fireEvent.click(screen.getByRole('button', { name: /^notifications$/i }));

		await waitFor(() => {
			expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeTruthy();
		});
	});

	it('announces the unread count politely for screen readers', () => {
		stubFetch({});
		render(NotificationBell, { initialUnread: 2, pollIntervalMs: 0 });

		const status = screen.getByRole('status');
		expect(status.textContent).toContain('2 unread notifications');
	});

	it('does not poll when pollIntervalMs is 0', async () => {
		const fetchMock = stubFetch({});
		render(NotificationBell, { initialUnread: 0, pollIntervalMs: 0 });

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('surfaces an API failure without throwing', async () => {
		const fetchMock = vi.fn(async () => new Response('server error', { status: 500 }));
		vi.stubGlobal('fetch', fetchMock);

		render(NotificationBell, { initialUnread: 0, pollIntervalMs: 0 });
		await fireEvent.click(screen.getByRole('button', { name: /^notifications$/i }));

		// The panel still opens — a failed fetch leaves the seed count intact
		// rather than breaking the sidebar.
		await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
	});
});
