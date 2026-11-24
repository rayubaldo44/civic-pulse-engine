import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { measureServer } from '$lib/server/timing';
import { logAudit } from '$lib/server/audit';

// Redirect away if already logged in (also handled by hooks, this is a fallback)
export const load: PageServerLoad = async ({ locals: { safeGetSession }, url }) => {
	const { user } = await safeGetSession();
	if (user) redirect(303, '/Authenticated/dashboard');

	return {
		invalidInviteLink: url.searchParams.get('error') === 'invalid_invite_link',
		passwordSet: url.searchParams.get('password_set') === '1'
	};
};

export const actions: Actions = {
	default: async ({ request, locals, cookies, getClientAddress }) => {
		const { supabase } = locals;
		const formData = await request.formData();
		const emailValue = formData.get('email');
		const passwordValue = formData.get('password');
		const email = typeof emailValue === 'string' ? emailValue.trim() : '';
		const password = typeof passwordValue === 'string' ? passwordValue : '';

		if (!email || !password) {
			return fail(400, { error: 'Enter both your official email and password.', email });
		}

		const { data: authData, error: authError } = await measureServer(locals, 'login_auth', () =>
			supabase.auth.signInWithPassword({
				email,
				password
			})
		);

		if (authError || !authData.user) {
			// Generic message — never forward Supabase error text (info-leak/enumeration).
			return fail(400, {
				error: "We couldn't sign you in. Check your email and password, then try again.",
				email
			});
		}

		// Record a fresh login once per browser session. This used to live in the
		// /Authenticated layout load, which burnt a DB insert + cookie write on the
		// landing render. Doing it here, right after authentication succeeds, keeps
		// the first page load focused on its data. Later navigations skip this via
		// the cp_login_logged marker cookie (shared with the old layout behaviour).
		const ipAddress = getClientAddress();
		const userAgent = request.headers.get('user-agent') ?? null;
		const auditPromise = measureServer(locals, 'login_audit', () =>
			logAudit({
				action: 'auth.login',
				actorId: authData.user.id,
				actorEmail: authData.user.email ?? 'system',
				ipAddress,
				userAgent,
				resourceType: 'auth'
			})
		);
		// No maxAge: this marker means "already logged in during *this browser
		// session*", and the auth cookies are session-scoped too
		// (src/lib/session-cookies.ts). A 12h expiry would outlive the browser
		// session and swallow the next auth.login audit row after a restart.
		cookies.set('cp_login_logged', '1', {
			path: '/',
			httpOnly: true,
			sameSite: 'lax'
		});

		// Role is authoritative from app_metadata (server-set, not user-editable) —
		// the same source +layout.server.ts derives the sidebar/gate from. Reading
		// it here avoids a sequential profiles round trip on the happy path
		// (every account created/edited through the admin UI syncs app_metadata).
		// Fall back to the DB ONLY when the metadata role is missing (legacy
		// accounts predating that sync) so they keep their existing landing.
		const metadataRole = (authData.user.app_metadata?.role as 'admin' | 'analyst' | null) ?? null;
		const rolePromise = metadataRole
			? Promise.resolve(metadataRole)
			: measureServer(locals, 'login_role_db', () =>
					supabase.from('profiles').select('role').eq('id', authData.user.id).single()
				).then(({ data: profile }) => (profile?.role as 'admin' | 'analyst' | null) ?? 'analyst');
		const [role] = await Promise.all([rolePromise, auditPromise]);

		if (role === 'admin') {
			redirect(303, '/Authenticated/admin');
		}
		redirect(303, '/Authenticated/dashboard');
	}
};
