import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import { maskEmail, validateNewPassword } from '$lib/utils/password';

/**
 * Set-password page — first-time setup for invited users.
 *
 * Access model (enforced on every load and every action):
 *  1. A valid authenticated user is required (safeGetSession returns the
 *     Auth-server-verified identity from getUser()). The only way to get one
 *     without a password is by consuming an invite link (/auth/callback/confirm).
 *  2. The profiles.password_set flag must still be false. Fully
 *     provisioned users are bounced to the dashboard so this endpoint can
 *     never be used to replace a password WITHOUT the current-password
 *     re-auth that /settings requires.
 */
export const load: PageServerLoad = async ({ locals: { safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const svc = getServiceSupabase();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data: profile } = await (svc.from('profiles') as any)
		.select('password_set')
		.eq('id', user.id)
		.single();

	if (profile?.password_set) redirect(303, '/Authenticated/dashboard');

	return {
		maskedEmail: maskEmail(user.email ?? ''),
		fullName: (user.user_metadata?.full_name as string | undefined) ?? ''
	};
};

export const actions: Actions = {
	default: async ({ request, locals: { safeGetSession, supabase } }) => {
		const { user } = await safeGetSession();
		if (!user || !user.email) {
			return fail(401, {
				error:
					'Your invite session has expired. Please ask your administrator for a new invitation.'
			});
		}

		const form = await request.formData();
		const password = (form.get('password') as string | null) ?? '';
		const confirmPassword = (form.get('confirm_password') as string | null) ?? '';

		const validation = validateNewPassword(password, confirmPassword);
		if (!validation.valid) {
			return fail(400, { error: validation.error });
		}

		// Re-check the flag inside the action to close the race where a user
		// completes setup in another tab between load() and submit.
		const svc = getServiceSupabase();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { data: profile } = await (svc.from('profiles') as any)
			.select('password_set')
			.eq('id', user.id)
			.single();

		if (profile?.password_set) {
			return fail(409, { error: 'Your password has already been set. Please sign in.' });
		}

		const { error: updateError } = await supabase.auth.updateUser({ password });
		if (updateError) {
			return fail(500, {
				error:
					'Could not set your password — the invite link may have expired. Please request a new invitation.'
			});
		}

		// Serialize the transition: filtering on password_set = false and
		// counting affected rows closes the last TOCTOU window between the
		// re-check above and this write (concurrent double-submit).
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { error: flagError, count } = await (svc.from('profiles') as any)
			.update({ password_set: true }, { count: 'exact' })
			.eq('id', user.id)
			.eq('password_set', false);

		if (flagError) {
			return fail(500, {
				error: 'Your password was set but setup could not be finalized. Please try signing in.'
			});
		}

		if ((count ?? 0) === 0) {
			return fail(409, { error: 'Your password has already been set. Please sign in.' });
		}

		// Best-effort audit trail; must never block or fail the flow.
		try {
			await (svc.from('audit_logs') as any).insert({
				action: 'password_set',
				actor_id: user.id,
				actor_email: user.email,
				details: 'Password set via invite acceptance'
			});
		} catch {
			// ignore
		}

		// Force re-login: revoke every refresh token for this user (global)
		// and clear the local cookies. The user then signs in with the
		// password they just chose — clean session state, no auto-login.
		await supabase.auth.signOut({ scope: 'global' });

		redirect(303, '/login?password_set=1');
	}
};
