import { redirect, fail } from '@sveltejs/kit';
import { measureServer } from '$lib/server/timing';
import type { PageServerLoad, Actions } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import { logAudit, buildDetails } from '$lib/server/audit';
import { validateNewPassword } from '$lib/utils/password';
import { getPrefs, savePrefs } from '$lib/server/notifications';
import {
	CATEGORY_ORDER,
	isNotificationCategory,
	normalizeNotificationPrefs,
	type NotificationPrefs
} from '$lib/types/notifications';

export const load: PageServerLoad = async ({ locals }) => {
	const { safeGetSession, supabase } = locals;
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const role = (user.app_metadata?.role ?? user.user_metadata?.role ?? 'analyst') as string;

	const [{ data: profile }, notificationPrefs] = await measureServer(locals, 'settings_db', () =>
		Promise.all([
			supabase.from('profiles').select('full_name').eq('id', user.id).single(),
			getPrefs(user.id)
		])
	);

	return {
		email: user.email ?? '',
		fullName: profile?.full_name ?? '',
		role,
		lastSignIn: user.last_sign_in_at ?? null,
		// getPrefs already degrades to defaults when the table is missing.
		notificationPrefs
	};
};

export const actions: Actions = {
	// ── Update display name ────────────────────────────────────────────────────
	updateName: async ({ request, locals: { safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { nameError: 'Session expired.' });

		const form = await request.formData();
		const fullName = ((form.get('full_name') as string) ?? '').trim().slice(0, 100);

		if (!fullName) return fail(400, { nameError: 'Display name cannot be empty.' });

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { error } = await (getServiceSupabase().from('profiles') as any)
			.update({ full_name: fullName })
			.eq('id', user.id);

		if (error) return fail(500, { nameError: 'Failed to update name. Please try again.' });

		await logAudit({
			action: 'profile.name_update',
			actorId: user.id,
			actorEmail: user.email ?? 'system',
			resourceType: 'profile',
			resourceId: user.id,
			details: buildDetails({ full_name: fullName })
		});

		return { nameSuccess: true };
	},

	// ── Change password ────────────────────────────────────────────────────────
	updatePassword: async ({ request, locals: { safeGetSession, supabase } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { pwError: 'Session expired.' });

		const form = await request.formData();
		const currentPw = (form.get('current_password') as string) ?? '';
		const newPw = (form.get('new_password') as string) ?? '';
		const confirmPw = (form.get('confirm_password') as string) ?? '';

		if (!currentPw || !newPw || !confirmPw)
			return fail(400, { pwError: 'All password fields are required.' });

		// Same policy as first-time set-password (12+ chars, mixed classes).
		const validation = validateNewPassword(newPw, confirmPw);
		if (!validation.valid) return fail(400, { pwError: validation.error });

		// Verify current password by re-authenticating with the user's session client.
		const { error: signInError } = await supabase.auth.signInWithPassword({
			email: user.email!,
			password: currentPw
		});
		if (signInError) return fail(400, { pwError: 'Current password is incorrect.' });

		const { error: updateError } = await supabase.auth.updateUser({ password: newPw });
		if (updateError) return fail(500, { pwError: 'Failed to update password. Please try again.' });

		await logAudit({
			action: 'profile.password_change',
			actorId: user.id,
			actorEmail: user.email ?? 'system',
			resourceType: 'profile',
			resourceId: user.id
		});

		return { pwSuccess: true };
	},

	// ── Notification preferences ──────────────────────────────────────────────
	//
	// Checkboxes post as "on" when ticked and are ABSENT when not, so presence
	// is the signal. With a master switch on, every category checkbox is
	// enabled and submitted, so an absent key genuinely means "off". With the
	// master off the child checkboxes are `disabled` (and therefore also
	// absent) — that case preserves the stored value instead, so muting a
	// channel doesn't quietly destroy the per-category preferences underneath.
	updatePrefs: async ({ request, locals: { safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { prefsError: 'Session expired.' });

		const form = await request.formData();
		const current = await getPrefs(user.id);

		const next: NotificationPrefs = normalizeNotificationPrefs(current);
		next.in_app = form.has('in_app');
		next.email = form.has('email');

		// A checkbox under a disabled master switch is `disabled`, so the browser
		// omits it from the payload. Writing `false` in that case would silently
		// discard a preference the user could not have edited, so preserve the
		// stored value and let the master switch carry the mute.
		for (const category of CATEGORY_ORDER) {
			if (!isNotificationCategory(category)) continue;
			const stored = next.categories[category];
			next.categories[category] = {
				in_app: next.in_app ? form.has(`cat_${category}_in_app`) : stored.in_app,
				email: next.email ? form.has(`cat_${category}_email`) : stored.email
			};
		}

		try {
			await savePrefs(user.id, next);
		} catch (err) {
			console.error('[settings] prefs save failed:', err);
			return fail(500, { prefsError: 'Failed to save notification settings. Please try again.' });
		}

		await logAudit({
			action: 'notification.prefs_update',
			actorId: user.id,
			actorEmail: user.email ?? 'system',
			resourceType: 'notification_prefs',
			resourceId: user.id,
			details: buildDetails({ prefs: next })
		});

		return { prefsSuccess: true };
	}
};
