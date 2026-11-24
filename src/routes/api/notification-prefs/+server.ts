// GET  /api/notification-prefs — the caller's channel/category preferences.
// PATCH /api/notification-prefs — update them.
//
// Body: { in_app?: boolean, email?: boolean, categories?: { [category]: { in_app?, email? } } }
//
// Unknown category keys are IGNORED, not rejected, and missing keys keep their
// current value — a partial body is a legitimate way to toggle one channel.
// That matches the lenient-whitelist convention used by the other /api routes.
//
// Server-side writes go through the service role; the table's own RLS also
// permits a user to upsert their own row directly.

import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPrefs, savePrefs } from '$lib/server/notifications';
import {
	CATEGORY_ORDER,
	isNotificationCategory,
	type NotificationPrefs
} from '$lib/types/notifications';
import { logAudit, buildDetails } from '$lib/server/audit';

export const GET: RequestHandler = async ({ locals: { safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	try {
		return json(await getPrefs(user.id));
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error('[api/notification-prefs] read failed:', message);
		return json({ error: message }, { status: 500 });
	}
};

export const PATCH: RequestHandler = async ({
	locals: { safeGetSession },
	request,
	getClientAddress
}) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	try {
		const current = await getPrefs(user.id);
		const next = mergePrefs(current, body as Record<string, unknown>);

		// Re-read through the normaliser so a crafted body can't persist
		// something normalizeNotificationPrefs() wouldn't produce.
		const saved = await savePrefs(user.id, next);

		await logAudit({
			action: 'notification.prefs_update',
			actorId: user.id,
			actorEmail: user.email ?? 'system',
			resourceType: 'notification_prefs',
			resourceId: user.id,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null,
			details: buildDetails({ prefs: saved })
		});

		return json({ success: true, prefs: saved });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error('[api/notification-prefs] write failed:', message);
		return json({ error: message }, { status: 500 });
	}
};

/** Overlay a partial patch on the current prefs, dropping anything unrecognised. */
function mergePrefs(current: NotificationPrefs, patch: Record<string, unknown>): NotificationPrefs {
	const next: NotificationPrefs = structuredClone(current);

	if (typeof patch.in_app === 'boolean') next.in_app = patch.in_app;
	if (typeof patch.email === 'boolean') next.email = patch.email;

	const categories = patch.categories;
	if (categories && typeof categories === 'object' && !Array.isArray(categories)) {
		for (const [key, value] of Object.entries(categories as Record<string, unknown>)) {
			// Unknown categories are ignored rather than rejected.
			if (!isNotificationCategory(key)) continue;
			if (!value || typeof value !== 'object') continue;

			const channels = value as Record<string, unknown>;
			const target = next.categories[key];
			if (typeof channels.in_app === 'boolean') target.in_app = channels.in_app;
			if (typeof channels.email === 'boolean') target.email = channels.email;
		}
	}

	// Defensive: if a future caller passes a category list the normaliser
	// doesn't know about, drop it rather than persisting an unknown shape.
	for (const key of Object.keys(next.categories)) {
		if (!isNotificationCategory(key)) delete next.categories[key as never];
	}
	for (const category of CATEGORY_ORDER) {
		if (!next.categories[category]) {
			next.categories[category] = { in_app: true, email: true };
		}
	}

	return next;
}
