// PATCH /api/notifications/read
// Mark notifications as read.
//
// Body: { ids: string[] } to mark specific rows, or { all: true } to mark
// every unread row. Ids are validated as UUIDs and the UPDATE is scoped by
// user_id, so a crafted id owned by another account matches zero rows rather
// than being written to.
//
// Invalid bodies are rejected with a 400 (this is a mutation, not a lenient
// filter — see the whitelist-and-ignore convention in CONTEXT.md, which
// applies to query params, not to a body that decides what gets written).

import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markRead, markAllRead, countUnread } from '$lib/server/notifications';
import { setCachedUnreadCount, invalidateNotifications } from '$lib/server/notifications-cache';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 100;

export const PATCH: RequestHandler = async ({ locals: { safeGetSession }, request }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json(
			{ error: 'Invalid request body — expected { ids } or { all: true }' },
			{ status: 400 }
		);
	}

	try {
		let updated: number;

		if ((body as { all?: unknown }).all === true) {
			updated = await markAllRead(user.id);
		} else {
			const ids = (body as { ids?: unknown }).ids;
			if (!Array.isArray(ids) || ids.length === 0) {
				return json(
					{ error: 'Invalid request body — expected { ids: string[] } or { all: true }' },
					{ status: 400 }
				);
			}
			if (ids.length > MAX_IDS) {
				return json({ error: `Too many ids — max ${MAX_IDS} per request` }, { status: 400 });
			}
			if (!ids.every((id) => typeof id === 'string' && UUID_RE.test(id))) {
				return json({ error: 'Invalid request body — ids must be UUID strings' }, { status: 400 });
			}
			updated = await markRead(user.id, ids as string[]);
		}

		// The acting user's own unread count just changed.
		invalidateNotifications(user.id);

		const unread = await countUnread(user.id);
		setCachedUnreadCount(user.id, unread);

		return json({ success: true, updated, unread });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error('[api/notifications/read] failed:', message);
		return json({ error: message }, { status: 500 });
	}
};
