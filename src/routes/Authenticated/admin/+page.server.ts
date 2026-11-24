// src/routes/Authenticated/admin/+page.server.ts
//
// Security model — every action applies THREE independent checks:
//   1. safeGetSession()          → returns the Auth-server-verified user (getUser(), set by hooks.server.ts)
//   2. user.app_metadata.role   → role claim baked into the signed JWT
//   3. profiles table DB query  → role from the database, independent of the JWT
// All three must return "admin" before any mutation is allowed.
//
// This means a tampered JWT, a stale JWT, or a compromised DB record must ALL
// be bypassed simultaneously for an escalation to succeed.

import { error, redirect, fail } from '@sveltejs/kit';
import { measureServer } from '$lib/server/timing';
import type { PageServerLoad, Actions } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import { logAudit, buildDetails } from '$lib/server/audit';
import { env } from '$env/dynamic/private';

// ── Re-usable triple-check helper ─────────────────────────────────────────────
// Accepts the two locals already available in every action.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireAdmin(safeGetSession: () => Promise<any>, supabase: any) {
	// Check 1: valid session (user verified by getUser() in hooks.server.ts)
	const { user } = await safeGetSession();
	if (!user)
		return {
			ok: false as const,
			code: 401 as const,
			message: 'Session expired. Please log in again.'
		};

	// Check 2: role from signed JWT claim
	if ((user.app_metadata?.role as string) !== 'admin')
		return { ok: false as const, code: 403 as const, message: 'Admin access required.' };

	// Check 3: role from the database (independent of the JWT)
	const { data: profile } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();

	if (profile?.role !== 'admin')
		return { ok: false as const, code: 403 as const, message: 'Admin access required.' };

	return { ok: true as const, user };
}

// ── Load ──────────────────────────────────────────────────────────────────────
export const load: PageServerLoad = async ({ locals }) => {
	const { safeGetSession, supabase } = locals;
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	// Check 2
	// Non-admin JWT → bounce to dashboard. This mirrors the /Authenticated layout
	// guard so direct client-side navigation to /admin is redirected even though
	// the layout no longer re-runs on every navigation. (The DB check below still
	// surfaces a 403 for the rare tampered-metadata case.)
	const roleJwt = (user.app_metadata?.role as string) ?? 'analyst';
	if (roleJwt !== 'admin') redirect(303, '/Authenticated/dashboard');

	// Check 3
	const { data: profile } = await supabase
		.from('profiles')
		.select('role')
		.eq('id', user.id)
		.single();
	if (profile?.role !== 'admin') error(403, 'Forbidden');

	const svc = getServiceSupabase();

	// Load system config
	const configQuery = svc
		.from('system_config')
		.select(
			'flagging_sensitivity, codeswitching_model, contextual_sentiment, spam_filter, updated_at'
		)
		.eq('id', 1)
		.single();

	// Load all auth users + their profiles in parallel
	const [{ data: config }, { data: authData }, { data: profiles }] = await measureServer(
		locals,
		'admin_db',
		() =>
			Promise.all([
				configQuery,
				svc.auth.admin.listUsers({ perPage: 200 }),
				svc.from('profiles').select('id, full_name, role')
			])
	);

	const profileMap = Object.fromEntries(
		(profiles ?? []).map((p: { id: string; full_name: string | null; role: string }) => [p.id, p])
	);

	const personnel = (authData?.users ?? []).map((u) => ({
		id: u.id,
		email: u.email ?? '',
		full_name: profileMap[u.id]?.full_name ?? u.email?.split('@')[0] ?? 'Unknown',
		role: (profileMap[u.id]?.role ?? 'analyst') as 'admin' | 'analyst',
		last_sign_in: u.last_sign_in_at ?? null
	}));

	return {
		currentUserId: user.id,
		config: config ?? {
			flagging_sensitivity: 75,
			codeswitching_model: true,
			contextual_sentiment: true,
			spam_filter: true,
			updated_at: null
		},
		personnel
	};
};

// ── Actions ───────────────────────────────────────────────────────────────────
export const actions: Actions = {
	/**
	 * saveConfig — persists NLP engine settings.
	 * Triple-checked: session + JWT role + DB role.
	 */
	saveConfig: async ({ request, locals: { safeGetSession, supabase } }) => {
		const check = await requireAdmin(safeGetSession, supabase);
		if (!check.ok) return fail(check.code, { configError: check.message });

		const fd = await request.formData();
		const sensitivity = parseInt(fd.get('flagging_sensitivity') as string, 10);
		const codeswitching = fd.get('codeswitching_model') === 'true';
		const sentiment = fd.get('contextual_sentiment') === 'true';
		const spamFilter = fd.get('spam_filter') === 'true';

		if (isNaN(sensitivity) || sensitivity < 0 || sensitivity > 100)
			return fail(400, { configError: 'Sensitivity must be between 0 and 100.' });

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const svcConfig = getServiceSupabase().from('system_config') as any;
		const { error: dbErr } = await svcConfig
			.update({
				flagging_sensitivity: sensitivity,
				codeswitching_model: codeswitching,
				contextual_sentiment: sentiment,
				spam_filter: spamFilter,
				updated_at: new Date().toISOString(),
				updated_by: check.user.id
			})
			.eq('id', 1);

		if (dbErr) return fail(500, { configError: `Save failed: ${dbErr.message}` });

		await logAudit({
			action: 'config.update',
			actorId: check.user.id,
			actorEmail: check.user.email ?? 'system',
			resourceType: 'system_config',
			resourceId: '1',
			details: buildDetails({
				flagging_sensitivity: sensitivity,
				codeswitching_model: codeswitching,
				contextual_sentiment: sentiment,
				spam_filter: spamFilter
			})
		});

		return { configSuccess: true };
	},

	/**
	 * restartServices — triggers the NLP processing edge function.
	 * Triple-checked. Requires EDGE_FUNCTION_URL env var.
	 */
	restartServices: async ({ locals: { safeGetSession, supabase } }) => {
		const check = await requireAdmin(safeGetSession, supabase);
		if (!check.ok) return fail(check.code, { restartError: check.message });

		const edgeUrl = env.EDGE_FUNCTION_URL;
		const svcKey = env.SUPABASE_SERVICE_ROLE_KEY;

		if (!edgeUrl)
			return fail(500, { restartError: 'EDGE_FUNCTION_URL is not configured on this deployment.' });

		let ok = true;
		try {
			const res = await fetch(edgeUrl, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${svcKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ trigger: 'manual_restart', by: check.user.id }),
				signal: AbortSignal.timeout(30_000)
			});

			if (!res.ok) {
				ok = false;
				return fail(502, { restartError: `Processing service returned HTTP ${res.status}.` });
			}
		} catch (e) {
			ok = false;
			return fail(502, {
				restartError: 'Could not reach the processing service. It may be sleeping.'
			});
		}

		if (ok) {
			await logAudit({
				action: 'service.restart',
				actorId: check.user.id,
				actorEmail: check.user.email ?? 'system',
				details: buildDetails({ by: check.user.email ?? null }),
				resourceType: 'service'
			});
		}

		return { restartSuccess: true };
	},

	/**
	 * invitePersonnel — sends a Supabase Auth invite email and creates a profile.
	 * Triple-checked. Validates email format and role before any write.
	 */
	invitePersonnel: async ({ request, locals: { safeGetSession, supabase } }) => {
		const check = await requireAdmin(safeGetSession, supabase);
		if (!check.ok) return fail(check.code, { inviteError: check.message });

		const fd = await request.formData();
		const fullName = (fd.get('full_name') as string | null)?.trim() ?? '';
		const email = (fd.get('email') as string | null)?.trim().toLowerCase() ?? '';
		const role = (fd.get('role') as string | null) ?? '';

		// Validate all fields before touching auth
		if (!fullName)
			return fail(400, { inviteError: 'Full name is required.', inviteField: 'full_name' });
		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
			return fail(400, { inviteError: 'A valid email address is required.', inviteField: 'email' });
		if (!['admin', 'analyst'].includes(role))
			return fail(400, { inviteError: 'Role must be admin or analyst.', inviteField: 'role' });

		const svc = getServiceSupabase();

		// Reconsideration check: make sure email isn't already registered
		const { data: existingUsers } = await svc.auth.admin.listUsers({ perPage: 200 });
		const alreadyExists = existingUsers?.users.some((u) => u.email?.toLowerCase() === email);
		if (alreadyExists)
			return fail(409, { inviteError: `${email} is already registered in this system.` });

		// Send invite (Supabase emails the user a sign-up link)
		const { data: invited, error: inviteErr } = await svc.auth.admin.inviteUserByEmail(email, {
			data: { full_name: fullName }
		});

		if (inviteErr || !invited?.user)
			return fail(500, {
				inviteError: inviteErr?.message ?? 'Invite failed for an unknown reason.'
			});

		const newId = invited.user.id;

		// Set role in app_metadata (the authoritative JWT claim source)
		await svc.auth.admin.updateUserById(newId, { app_metadata: { role } });

		// Create profile row
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await (svc.from('profiles') as any).upsert({ id: newId, full_name: fullName, role });

		await logAudit({
			action: 'personnel.invite',
			actorId: check.user.id,
			actorEmail: check.user.email ?? 'system',
			resourceType: 'personnel',
			resourceId: newId,
			details: buildDetails({ email, full_name: fullName, role })
		});

		return { inviteSuccess: true, invitedEmail: email };
	},

	/**
	 * editPersonnel — updates a user's display name and role.
	 * Triple-checked. Prevents admins from editing their own account through this form
	 * (use Supabase dashboard for self-service changes).
	 */
	editPersonnel: async ({ request, locals: { safeGetSession, supabase } }) => {
		const check = await requireAdmin(safeGetSession, supabase);
		if (!check.ok) return fail(check.code, { editPersonnelError: check.message });

		const fd = await request.formData();
		const targetId = (fd.get('target_id') as string | null) ?? '';
		const fullName = (fd.get('full_name') as string | null)?.trim() ?? '';
		const role = (fd.get('role') as string | null) ?? '';

		if (!targetId) return fail(400, { editPersonnelError: 'Target user ID is missing.' });
		// Prevent self-edit to avoid accidental admin lockout
		if (targetId === check.user.id)
			return fail(400, {
				editPersonnelError: 'Use the Supabase dashboard to edit your own account.'
			});
		if (!fullName)
			return fail(400, {
				editPersonnelError: 'Full name is required.',
				editPersonnelField: 'full_name'
			});
		if (!['admin', 'analyst'].includes(role))
			return fail(400, {
				editPersonnelError: 'Role must be admin or analyst.',
				editPersonnelField: 'role'
			});

		// Reconsideration check: verify target user actually exists before writing
		const svc = getServiceSupabase();
		const { data: targetUser, error: fetchErr } = await svc.auth.admin.getUserById(targetId);
		if (fetchErr || !targetUser?.user) return fail(404, { editPersonnelError: 'User not found.' });

		// Update profile
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { error: profileErr } = await (svc.from('profiles') as any)
			.update({ full_name: fullName, role })
			.eq('id', targetId);
		if (profileErr)
			return fail(500, { editPersonnelError: `Profile update failed: ${profileErr.message}` });

		// Sync app_metadata so JWT reflects the new role on next sign-in
		await svc.auth.admin.updateUserById(targetId, { app_metadata: { role } });

		await logAudit({
			action: 'personnel.update',
			actorId: check.user.id,
			actorEmail: check.user.email ?? 'system',
			resourceType: 'personnel',
			resourceId: targetId,
			details: buildDetails({
				target_email: targetUser.user.email ?? null,
				full_name: fullName,
				role
			})
		});

		return { editPersonnelSuccess: true };
	}
};
