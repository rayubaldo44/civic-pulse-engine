// GET /api/notifications
// The caller's notification feed plus their unread count.
//
// This endpoint also drives trend evaluation: it runs the catch-up sweep and
// the caller's own diff BEFORE reading rows, so one round-trip per poll
// refreshes both the feed and the badge. Evaluation is idempotent (fingerprint
// unique index) and never throws, so a degraded evaluation still serves the
// last known feed rather than failing the request.
//
// Params are whitelisted with lenient fallbacks, matching the other /api
// routes: unknown values are ignored rather than rejected.
//
// Session-gated like every /api route (safeGetSession → redirect /login).

import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listNotifications, countUnread } from '$lib/server/notifications';
import { evaluateTrendsWithSweep } from '$lib/server/trend-evaluator';
import {
	getUnreadFetchedAt,
	getCachedUnreadCount,
	setCachedUnreadCount
} from '$lib/server/notifications-cache';

const VALID_LIMITS = new Set([20, 50, 100]);
const DEFAULT_LIMIT = 20;

export const GET: RequestHandler = async ({ locals: { safeGetSession }, url }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const limitParam = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
	const limit = VALID_LIMITS.has(limitParam) ? limitParam : DEFAULT_LIMIT;
	const unreadOnly = url.searchParams.get('unread_only') === '1';

	try {
		// Evaluate before reading, so a crossing detected on this poll is
		// visible in the same response rather than one poll later.
		await evaluateTrendsWithSweep(user.id);

		const { notifications } = await listNotifications(user.id, limit, unreadOnly);

		// The unread badge is read on every tick, so serve it from the
		// short-TTL cache rather than a second COUNT on every poll.
		let unread = getCachedUnreadCount(user.id);
		let fetchedAt = unread !== null ? (getUnreadFetchedAt(user.id) ?? Date.now()) : Date.now();
		if (unread === null) {
			unread = await countUnread(user.id);
			setCachedUnreadCount(user.id, unread, fetchedAt);
		}

		return json(
			{ notifications, unread, fetchedAt },
			{ headers: { 'Cache-Control': 'private, no-store' } }
		);
	} catch (err) {
		// A failed count must not hide a readable feed.
		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error('[api/notifications] failed:', message);
		return json({ error: message }, { status: 500 });
	}
};
