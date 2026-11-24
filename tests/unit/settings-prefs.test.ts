import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

const { logAudit } = vi.hoisted(() => ({ logAudit: vi.fn() }));
vi.mock('$lib/server/audit', () => ({
	logAudit,
	buildDetails: (pairs: Record<string, unknown>) => JSON.stringify(pairs)
}));

const { getPrefs, savePrefs } = vi.hoisted(() => ({ getPrefs: vi.fn(), savePrefs: vi.fn() }));
vi.mock('$lib/server/notifications', () => ({ getPrefs, savePrefs }));

import { actions } from '../../src/routes/Authenticated/settings/+page.server';
import { makeFormEvent, type ActionHandler } from './helpers/api';

const updatePrefs = actions.updatePrefs as unknown as ActionHandler;

const DEFAULTS = {
	in_app: true,
	email: true,
	categories: {
		trend_alert: { in_app: true, email: true },
		issue_peer_review: { in_app: true, email: true }
	}
};

function form(fields: Record<string, string>) {
	// A bare key with an empty value stands in for a checked checkbox, which is
	// what the browser actually submits.
	return makeFormEvent('/Authenticated/settings?/updatePrefs', fields);
}

describe('settings — updatePrefs action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		savePrefs.mockImplementation(async (_id: string, prefs: unknown) => prefs);
	});

	it('returns 401 when the session is gone', async () => {
		const res = await updatePrefs(
			makeFormEvent('/Authenticated/settings?/updatePrefs', {}, { authenticated: false })
		);
		expect(res).toMatchObject({ status: 401 });
		expect(savePrefs).not.toHaveBeenCalled();
	});

	it('persists a fully-checked form', async () => {
		getPrefs.mockResolvedValue(structuredClone(DEFAULTS));

		const res = await updatePrefs(
			form({
				in_app: 'on',
				email: 'on',
				cat_trend_alert_in_app: 'on',
				cat_trend_alert_email: 'on',
				cat_issue_peer_review_in_app: 'on',
				cat_issue_peer_review_email: 'on'
			})
		);

		expect(res).toMatchObject({ prefsSuccess: true });
		expect(savePrefs).toHaveBeenCalledWith('actor-1', {
			in_app: true,
			email: true,
			categories: {
				trend_alert: { in_app: true, email: true },
				issue_peer_review: { in_app: true, email: true }
			}
		});
	});

	it('records a child opt-out while its master switch is on', async () => {
		// email master is on, so the child checkbox is enabled and visible. The
		// user unticked it, so the opt-out is real and must be written.
		getPrefs.mockResolvedValue(structuredClone(DEFAULTS));

		await updatePrefs(
			form({
				in_app: 'on',
				cat_trend_alert_in_app: 'on',
				cat_issue_peer_review_in_app: 'on',
				email: 'on',
				cat_issue_peer_review_email: 'on'
			})
		);

		expect(savePrefs).toHaveBeenCalledWith(
			'actor-1',
			expect.objectContaining({
				email: true,
				categories: {
					trend_alert: { in_app: true, email: false },
					issue_peer_review: { in_app: true, email: true }
				}
			})
		);
	});

	it('preserves a per-category preference when its master switch is off', async () => {
		// The user had trend_alert email ON, then muted email entirely. The
		// child checkbox is then disabled — and a disabled checkbox is absent
		// from the payload — so the stored preference must survive rather than
		// being clobbered to false. The master switch alone carries the mute.
		getPrefs.mockResolvedValue(structuredClone(DEFAULTS));

		await updatePrefs(
			form({ in_app: 'on', cat_trend_alert_in_app: 'on', cat_issue_peer_review_in_app: 'on' })
		);

		expect(savePrefs).toHaveBeenCalledWith(
			'actor-1',
			expect.objectContaining({
				email: false,
				categories: {
					trend_alert: { in_app: true, email: true },
					issue_peer_review: { in_app: true, email: true }
				}
			})
		);
	});

	it('mutes everything when no master switch is checked', async () => {
		getPrefs.mockResolvedValue(structuredClone(DEFAULTS));

		await updatePrefs(form({}));

		expect(savePrefs).toHaveBeenCalledWith('actor-1', {
			in_app: false,
			email: false,
			categories: {
				trend_alert: { in_app: true, email: true },
				issue_peer_review: { in_app: true, email: true }
			}
		});
	});

	it('returns 500 and skips the audit when the write fails', async () => {
		getPrefs.mockResolvedValue(structuredClone(DEFAULTS));
		savePrefs.mockRejectedValueOnce(new Error('db down'));

		const res = await updatePrefs(form({ in_app: 'on' }));

		expect(res).toMatchObject({ status: 500 });
		expect(logAudit).not.toHaveBeenCalled();
	});

	it('audits a successful save', async () => {
		getPrefs.mockResolvedValue(structuredClone(DEFAULTS));

		await updatePrefs(form({ in_app: 'on', email: 'on' }));

		expect(logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'notification.prefs_update',
				actorId: 'actor-1',
				resourceType: 'notification_prefs'
			})
		);
	});
});
