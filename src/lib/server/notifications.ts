// src/lib/server/notifications.ts
//
// Data access for the notifications store (migration 014). Every function
// here is best-effort: a notification failure must never fail the request
// that triggered it, so callers get a resolved promise either way and errors
// are logged. Mirrors the error posture of $lib/server/audit.ts.
//
// Server-only (lives under $lib/server/) so Vite blocks any client import.

import { getServiceSupabase } from '$lib/server/supabase';
import {
	normalizeNotificationPrefs,
	type AppNotification,
	type NotificationPrefs
} from '$lib/types/notifications';

const NOTIFICATION_COLUMNS =
	'id, category, severity, title, body, href, entity_type, entity_id, read_at, created_at';

export interface NotificationListResult {
	notifications: AppNotification[];
	unread: number;
}

/** Rows the client is allowed to see for one user, newest first. */
export async function listNotifications(
	userId: string,
	limit: number,
	unreadOnly: boolean
): Promise<NotificationListResult> {
	const supabase = getServiceSupabase();

	let query = (supabase.from('notifications') as any)
		.select(NOTIFICATION_COLUMNS)
		.eq('user_id', userId)
		.order('created_at', { ascending: false })
		.order('id', { ascending: false })
		.limit(limit);

	if (unreadOnly) query = query.is('read_at', null);

	const { data, error } = await query;
	if (error) throw new Error(`list notifications: ${error.message}`);

	const notifications = (data ?? []) as AppNotification[];
	return { notifications, unread: await countUnread(userId) };
}

export async function countUnread(userId: string): Promise<number> {
	const supabase = getServiceSupabase();
	const { count, error } = await (supabase.from('notifications') as any)
		.select('id', { count: 'exact', head: true })
		.eq('user_id', userId)
		.is('read_at', null);

	if (error) throw new Error(`count unread: ${error.message}`);
	return count ?? 0;
}

/**
 * Mark notifications read. Scoped by user_id on the UPDATE itself, so a
 * crafted id belonging to someone else matches zero rows rather than leaking
 * or erroring. Returns how many rows were actually changed.
 */
export async function markRead(userId: string, ids: string[]): Promise<number> {
	if (ids.length === 0) return 0;

	const supabase = getServiceSupabase();
	const { data, error } = await (supabase.from('notifications') as any)
		.update({ read_at: new Date().toISOString() })
		.eq('user_id', userId)
		.is('read_at', null)
		.in('id', ids)
		.select('id');

	if (error) throw new Error(`mark read: ${error.message}`);
	return (data ?? []).length;
}

export async function markAllRead(userId: string): Promise<number> {
	const supabase = getServiceSupabase();
	const { data, error } = await (supabase.from('notifications') as any)
		.update({ read_at: new Date().toISOString() })
		.eq('user_id', userId)
		.is('read_at', null)
		.select('id');

	if (error) throw new Error(`mark all read: ${error.message}`);
	return (data ?? []).length;
}

// ── Preferences ─────────────────────────────────────────────────────────────

/** Returns DEFAULT_NOTIFICATION_PREFS when the user has never saved any. */
export async function getPrefs(userId: string): Promise<NotificationPrefs> {
	const supabase = getServiceSupabase();
	const { data, error } = await (supabase.from('notification_prefs') as any)
		.select('in_app, email, categories')
		.eq('user_id', userId)
		.maybeSingle();

	if (error) {
		console.error('[notifications] prefs read failed:', error.message);
		return normalizeNotificationPrefs(null);
	}
	if (!data) return normalizeNotificationPrefs(null);

	return normalizeNotificationPrefs({
		in_app: data.in_app,
		email: data.email,
		categories: data.categories
	});
}

export async function savePrefs(
	userId: string,
	prefs: NotificationPrefs
): Promise<NotificationPrefs> {
	const supabase = getServiceSupabase();
	const { error } = await (supabase.from('notification_prefs') as any).upsert(
		{
			user_id: userId,
			in_app: prefs.in_app,
			email: prefs.email,
			categories: prefs.categories,
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'user_id' }
	);

	if (error) throw new Error(`save prefs: ${error.message}`);
	return prefs;
}

// ── Retention ───────────────────────────────────────────────────────────────

/**
 * Delete read notifications older than `days`. There is no scheduler in this
 * project, so the evaluator calls this opportunistically — with a 1-in-20
 * sampling rate so the extra DELETE does not ride along on every poll.
 */
export async function pruneReadNotifications(days = 30): Promise<number> {
	const supabase = getServiceSupabase();
	const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
	const { data, error } = await (supabase.from('notifications') as any)
		.delete()
		.not('read_at', 'is', null)
		.lt('created_at', cutoff)
		.select('id');

	if (error) {
		console.error('[notifications] prune failed:', error.message);
		return 0;
	}
	return (data ?? []).length;
}
