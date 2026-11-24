import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { envMock, getServiceSupabase } = vi.hoisted(() => ({
	envMock: { env: {} as Record<string, string | undefined> },
	getServiceSupabase: vi.fn()
}));

vi.mock('$env/dynamic/private', () => envMock);
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

import { notifyIssueAssigned, notifyIssueStatusChanged } from '$lib/server/notify';
import type { IssueStatus } from '$lib/types/issues';
import { createFakeSupabase } from './helpers/fake-supabase';
import { ACTOR_ID } from './helpers/api';

type NotifyArgs = {
	issueId: string;
	title: string;
	priority?: string;
	toStatus?: IssueStatus;
	assigneeId: string;
	actorId: string;
};

function makeSupabaseMock(
	cfg: { emails?: Record<string, string | null>; names?: Record<string, string | null> } = {}
) {
	const { emails = {}, names = {} } = cfg;
	const db = createFakeSupabase({
		match: (call) => {
			if (call.table === 'profiles') {
				const id = call.filters.find((f) => f.type === 'eq' && f.column === 'id')?.value as string;
				return { data: { full_name: names[id] ?? null }, error: null };
			}
			return { data: null, error: null };
		}
	});
	return {
		...db,
		auth: {
			admin: {
				getUserById: vi.fn(async (id: string) => ({
					data: Object.prototype.hasOwnProperty.call(emails, id)
						? { user: { email: emails[id] } }
						: { user: null },
					error: null
				}))
			}
		}
	};
}

function okFetch() {
	return vi.fn(async () => ({ ok: true, text: async () => '' }));
}

function lastFetchBody(): Record<string, unknown> {
	const call = vi.mocked(fetch).mock.calls.at(-1);
	const body = call?.[1]?.body;
	return JSON.parse(String(body)) as Record<string, unknown>;
}

const BASE: NotifyArgs = {
	issueId: 'issue-1',
	title: 'Broken streetlight',
	priority: 'High',
	assigneeId: 'staff-9',
	actorId: ACTOR_ID
};

describe('notifyIssueAssigned / notifyIssueStatusChanged', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.unstubAllGlobals();
		envMock.env = {};
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('skips entirely when assigning to yourself', async () => {
		envMock.env = { RESEND_API_KEY: 'key' };
		vi.stubGlobal('fetch', okFetch());

		await notifyIssueAssigned({ ...BASE, assigneeId: ACTOR_ID });

		expect(getServiceSupabase).not.toHaveBeenCalled();
		expect(vi.mocked(fetch)).not.toHaveBeenCalled();
	});

	it('skips entirely without an assignee', async () => {
		envMock.env = { RESEND_API_KEY: 'key' };
		vi.stubGlobal('fetch', okFetch());

		await notifyIssueAssigned({ ...BASE, assigneeId: '' });

		expect(getServiceSupabase).not.toHaveBeenCalled();
		expect(vi.mocked(fetch)).not.toHaveBeenCalled();
	});

	it('is a silent dev no-op without a RESEND_API_KEY', async () => {
		getServiceSupabase.mockReturnValue(
			makeSupabaseMock({
				emails: { 'staff-9': 'staff@example.com', [ACTOR_ID]: 'actor@example.com' }
			})
		);
		const fetchMock = okFetch();
		vi.stubGlobal('fetch', fetchMock);

		await notifyIssueAssigned(BASE);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('resolves the recipient email and sends the payload to Resend', async () => {
		envMock.env = {
			RESEND_API_KEY: 're_key',
			MAIL_FROM: 'Civic Pulse <no-reply@pulilan.gov.ph>'
		};
		getServiceSupabase.mockReturnValue(
			makeSupabaseMock({
				emails: { 'staff-9': 'staff@example.com', [ACTOR_ID]: 'actor@example.com' }
			})
		);
		const fetchMock = okFetch();
		vi.stubGlobal('fetch', fetchMock);

		await notifyIssueAssigned(BASE);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://api.resend.com/emails');
		expect(init.method).toBe('POST');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_key');
		const body = JSON.parse(String(init.body));
		expect(body.from).toBe('Civic Pulse <no-reply@pulilan.gov.ph>');
		expect(body.to).toBe('staff@example.com');
		expect(body.subject).toBe('[Civic Pulse] Issue assigned to you: Broken streetlight');
		expect(body.html).toContain('Broken streetlight');
		expect(body.html).toContain('Priority: High');
	});

	it('includes the actor full name in the body when available', async () => {
		envMock.env = { RESEND_API_KEY: 'key' };
		getServiceSupabase.mockReturnValue(
			makeSupabaseMock({
				emails: { 'staff-9': 's@e.c', [ACTOR_ID]: 'a@e.c' },
				names: { [ACTOR_ID]: 'Ana Reyes', 'staff-9': null }
			})
		);
		vi.stubGlobal('fetch', okFetch());

		await notifyIssueAssigned(BASE);

		const body = lastFetchBody();
		expect(body.html).toContain('Ana Reyes');
	});

	it('falls back to "A staff member" when the actor has no name', async () => {
		envMock.env = { RESEND_API_KEY: 'key' };
		getServiceSupabase.mockReturnValue(
			makeSupabaseMock({
				emails: { 'staff-9': 's@e.c', [ACTOR_ID]: 'a@e.c' },
				names: { 'staff-9': null }
			})
		);
		vi.stubGlobal('fetch', okFetch());

		await notifyIssueAssigned(BASE);

		const body = lastFetchBody();
		expect(body.html).toContain('A staff member');
	});

	it('skips when the recipient has no verified email', async () => {
		envMock.env = { RESEND_API_KEY: 'key' };
		getServiceSupabase.mockReturnValue(
			makeSupabaseMock({ emails: { 'staff-9': null, [ACTOR_ID]: 'a@e.c' } })
		);
		const fetchMock = okFetch();
		vi.stubGlobal('fetch', fetchMock);

		await notifyIssueAssigned(BASE);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('swallows a Resend failure without rejecting the caller', async () => {
		envMock.env = { RESEND_API_KEY: 'key' };
		getServiceSupabase.mockReturnValue(
			makeSupabaseMock({ emails: { 'staff-9': 's@e.c', [ACTOR_ID]: 'a@e.c' } })
		);
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 422, text: async () => 'nope' }))
		);

		await expect(notifyIssueAssigned(BASE)).resolves.toBeUndefined();
		expect(errSpy).toHaveBeenCalledWith('[notify] issue email failed:', expect.anything());
	});

	it('builds the status-changed subject and body from the target status', async () => {
		envMock.env = { RESEND_API_KEY: 'key' };
		getServiceSupabase.mockReturnValue(
			makeSupabaseMock({ emails: { 'staff-9': 's@e.c', [ACTOR_ID]: 'a@e.c' } })
		);
		vi.stubGlobal('fetch', okFetch());

		await notifyIssueStatusChanged({ ...BASE, toStatus: 'In Progress' });

		const body = lastFetchBody();
		expect(body.subject).toBe('[Civic Pulse] Broken streetlight → In Progress');
		expect(body.html).toContain('In Progress');
	});

	it('defaults the origin to localhost when no env hints exist', async () => {
		envMock.env = { RESEND_API_KEY: 'key' };
		getServiceSupabase.mockReturnValue(
			makeSupabaseMock({ emails: { 'staff-9': 's@e.c', [ACTOR_ID]: 'a@e.c' } })
		);
		vi.stubGlobal('fetch', okFetch());

		await notifyIssueAssigned(BASE);

		const body = lastFetchBody();
		expect(body.html).toContain('http://localhost:5173/Authenticated/issues');
	});

	it('prefers APP_ORIGIN over VERCEL_URL for the tracked link', async () => {
		envMock.env = {
			RESEND_API_KEY: 'key',
			APP_ORIGIN: 'https://pulilan.example',
			VERCEL_URL: 'fallback.vercel.app'
		};
		getServiceSupabase.mockReturnValue(
			makeSupabaseMock({ emails: { 'staff-9': 's@e.c', [ACTOR_ID]: 'a@e.c' } })
		);
		vi.stubGlobal('fetch', okFetch());

		await notifyIssueAssigned(BASE);

		const body = lastFetchBody();
		expect(body.html).toContain('https://pulilan.example/Authenticated/issues');
		expect(body.html).not.toContain('fallback.vercel.app');
	});

	it('derives the origin from VERCEL_URL when APP_ORIGIN is unset', async () => {
		envMock.env = { RESEND_API_KEY: 'key', VERCEL_URL: 'pulilan.vercel.app' };
		getServiceSupabase.mockReturnValue(
			makeSupabaseMock({ emails: { 'staff-9': 's@e.c', [ACTOR_ID]: 'a@e.c' } })
		);
		vi.stubGlobal('fetch', okFetch());

		await notifyIssueAssigned(BASE);

		const body = lastFetchBody();
		expect(body.html).toContain('https://pulilan.vercel.app/Authenticated/issues');
	});
});
