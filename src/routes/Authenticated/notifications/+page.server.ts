// src/routes/Authenticated/notifications/+page.server.ts
//
// Paginated history of the caller's notifications.
//
// Read-only by design: trend evaluation runs on the /api/notifications poll
// (which NotificationBell drives from the layout), not here. Re-running it in
// an SSR page load would double the window-stats work on a page the user
// reaches while the bell is already polling.

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import {
	isNotificationCategory,
	normalizeNotificationPrefs,
	type AppNotification,
	type NotificationPrefs
} from '$lib/types/notifications';

const PAGE_SIZE = 20;

const NOTIFICATION_COLUMNS =
	'id, category, severity, title, body, href, entity_type, entity_id, read_at, created_at';

export const load: PageServerLoad = async ({ locals: { safeGetSession }, url, depends }) => {
	depends('notifications:feed');

	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	// Whitelist the category against the known set; an unrecognised value is
	// ignored rather than rejected (same lenient convention as the /api routes).
	const categoryParam = url.searchParams.get('category') ?? '';
	const category = isNotificationCategory(categoryParam) ? categoryParam : null;
	const unreadOnly = url.searchParams.get('unread') === '1';

	const pageParam = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
	const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

	const supabase = getServiceSupabase();

	// Before migration 014 these queries fail with 42704/PGRST205. Degrade to
	// an empty feed rather than a 500 — the page should never be the thing
	// that breaks while the rest of the app works.
	let notifications: AppNotification[] = [];
	let total = 0;
	let unread = 0;
	let prefs: NotificationPrefs = normalizeNotificationPrefs(null);
	let unavailable = false;

	let feedQuery = (supabase.from('notifications') as any)
		.select(NOTIFICATION_COLUMNS, { count: 'exact' })
		.eq('user_id', user.id)
		.order('created_at', { ascending: false })
		.order('id', { ascending: false })
		.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

	if (category) feedQuery = feedQuery.eq('category', category);
	if (unreadOnly) feedQuery = feedQuery.is('read_at', null);

	const feed = await feedQuery;

	if (feed.error) {
		unavailable = true;
	} else {
		notifications = (feed.data ?? []) as AppNotification[];
		total = feed.count ?? 0;

		const [unreadRes, prefsRes] = await Promise.all([
			(supabase.from('notifications') as any)
				.select('id', { count: 'exact', head: true })
				.eq('user_id', user.id)
				.is('read_at', null),
			(supabase.from('notification_prefs') as any)
				.select('in_app, email, categories')
				.eq('user_id', user.id)
				.maybeSingle()
		]);

		unread = unreadRes.count ?? 0;
		if (!prefsRes.error && prefsRes.data) {
			prefs = normalizeNotificationPrefs({
				in_app: prefsRes.data.in_app,
				email: prefsRes.data.email,
				categories: prefsRes.data.categories
			});
		}
	}

	return {
		notifications,
		total,
		unread,
		page,
		pageSize: PAGE_SIZE,
		prefs,
		unavailable,
		filters: { category, unreadOnly }
	};
};
