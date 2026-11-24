import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Invite-link landing endpoint.
 *
 * The invite email template links here with ?token_hash=...&type=invite
 * (built from {{ .TokenHash }}). We use verifyOtp instead of
 * exchangeCodeForSession because PKCE code verifiers are not available in
 * email clients — this is Supabase's recommended pattern for SSR apps.
 *
 * Security:
 * - `type` is allowlisted to 'invite' only; it is never passed through
 *   verbatim, so this endpoint cannot be abused as a generic OTP oracle.
 * - The redirect target is hardcoded; query params cannot redirect
 *   elsewhere (no open-redirect surface).
 * - Tokens are single-use and short-lived; reuse lands on /login with a
 *   generic error that does not reveal whether an account exists.
 */
export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type') ?? '';
	const code = url.searchParams.get('code');

	// Primary path: token_hash from the invite template ({{ .TokenHash }}).
	// Fallback path: PKCE-style ?code= links, for when a link is generated
	// through a flow that emits an authorization code instead.
	if (code) {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) redirect(303, '/set-password');
		redirect(303, '/login?error=invalid_invite_link');
	}

	if (!tokenHash || type !== 'invite') {
		redirect(303, '/login?error=invalid_invite_link');
	}

	const { error } = await supabase.auth.verifyOtp({
		type: 'invite',
		token_hash: tokenHash
	});

	if (error) {
		redirect(303, '/login?error=invalid_invite_link');
	}

	redirect(303, '/set-password');
};
