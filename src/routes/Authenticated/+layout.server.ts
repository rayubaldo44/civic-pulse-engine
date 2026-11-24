// src/routes/Authenticated/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { measureServer } from '$lib/server/timing';
import { getServiceSupabase } from '$lib/server/supabase';
import { getBadgesFetchedAt, getCachedBadges, setCachedBadges } from '$lib/server/badges-cache';
import {
	getUnreadFetchedAt,
	getCachedUnreadCount,
	setCachedUnreadCount
} from '$lib/server/notifications-cache';

export const load: LayoutServerLoad = async ({ locals, url, untrack, depends }) => {
	depends?.('app:summary');
	const { user } = await locals.safeGetSession();

	// Layer 2: re-verify session is valid (hooks.server.ts is Layer 1).
	// user is the Auth-server-verified identity; the raw session object is
	// deliberately not propagated (its embedded session.user is untrusted).
	if (!user) redirect(303, '/login');

	// The auth.login audit + cp_login_logged marker cookie now happen in the
	// login action — this layout no longer touches the audit trail, so the
	// landing render stays focused on data.

	// Role is authoritative from app_metadata (server-set, not user-editable).
	// Fall back to user_metadata for dev convenience but app_metadata wins.
	const role: 'admin' | 'analyst' =
		(user.app_metadata?.role as 'admin' | 'analyst') ??
		(user.user_metadata?.role as 'admin' | 'analyst') ??
		'analyst';

	// Layer 2b: block non-admins from the entire /Authenticated/admin subtree.
	// `untrack` deliberately hides this `url` read from SvelteKit's dependency
	// tracking: the layout server load previously re-ran on EVERY client-side
	// navigation (and every hover-prefetched page) just because of this guard,
	// re-executing the sidebar-badge RPC each time. The read still evaluates on
	// full page loads, and the admin page's own load mirrors this bounce for
	// client-side navs that skip the layout.
	if (untrack(() => url.pathname.startsWith('/Authenticated/admin')) && role !== 'admin') {
		redirect(303, '/Authenticated/dashboard');
	}

	const supabase = getServiceSupabase();

	async function loadBadges() {
		const cached = getCachedBadges(user!.id);
		if (cached) return { value: cached, fetchedAt: getBadgesFetchedAt(user!.id) ?? Date.now() };
		const fetchedAt = Date.now();
		const { data, error } = await (supabase.rpc as any)('get_sidebar_badges', {
			p_user_id: user!.id
		}).maybeSingle();
		if (error) {
			console.error('[layout] sidebar badges query failed:', error.message);
			return { value: { pending: 0, myTasks: 0 }, fetchedAt: 0 };
		}
		const value = { pending: data?.pending ?? 0, myTasks: data?.my_tasks ?? 0 };
		setCachedBadges(user!.id, value, fetchedAt);
		return { value, fetchedAt };
	}

	async function loadUnread() {
		const cached = getCachedUnreadCount(user!.id);
		if (cached !== null)
			return { value: cached, fetchedAt: getUnreadFetchedAt(user!.id) ?? Date.now() };
		const fetchedAt = Date.now();
		const { count, error } = await (supabase.from('notifications') as any)
			.select('id', { count: 'exact', head: true })
			.eq('user_id', user!.id)
			.is('read_at', null);
		if (error) {
			if (error.code !== '42704' && error.code !== 'PGRST205')
				console.error('[layout] unread count failed:', error.message);
			return { value: 0, fetchedAt: 0 };
		}
		setCachedUnreadCount(user!.id, count ?? 0, fetchedAt);
		return { value: count ?? 0, fetchedAt };
	}

	const [badges, unread] = await Promise.all([
		measureServer(locals, 'sidebar_db', loadBadges),
		measureServer(locals, 'unread_db', loadUnread)
	]);

	return {
		user,
		role,
		pendingCount: badges.value.pending,
		myTaskCount: badges.value.myTasks,
		unreadCount: unread.value,
		badgesFetchedAt: badges.fetchedAt,
		unreadFetchedAt: unread.fetchedAt
	};
};
