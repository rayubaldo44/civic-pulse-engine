import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getLocalSupabase, TEST_ADMIN, TEST_ANALYST } from '../../shared/supabase-env';

// Four client tiers the integration suites exercise, mirroring real callers:
//   anon          — unauthenticated (no session)
//   analyst/admin — authenticated staff (real password sign-in, real JWT)
//   service       — the app server layer (bypasses RLS)
const local = getLocalSupabase();

// Test clients are short-lived and single-use, so they must not run Supabase's
// background auto-refresh ticker. With the default `autoRefreshToken: true`
// every signed-in client schedules a `setInterval` that refreshes in the
// background; when a later re-seed resets a seeded user's password it wipes
// `auth.sessions`, that un-awaited refresh rejects, and vitest/Playwright
// prints a raw "Invalid Refresh Token" AuthApiError stack that looks like an
// app bug. On-demand refresh (getSession/getUser) is unaffected.
const ONE_SHOT_AUTH = { autoRefreshToken: false, persistSession: false } as const;

export function anonClient(): SupabaseClient {
	return createClient(local.url, local.anonKey, { auth: ONE_SHOT_AUTH });
}

export function serviceClient(): SupabaseClient {
	return createClient(local.url, local.serviceRoleKey);
}

async function staffClient(
	email: string,
	password: string
): Promise<{ client: SupabaseClient; userId: string; role: string }> {
	const auth = createClient(local.url, local.anonKey, { auth: ONE_SHOT_AUTH });
	const { data, error } = await auth.auth.signInWithPassword({ email, password });
	if (error || !data.session) throw new Error(`signIn failed for ${email}: ${error?.message}`);
	const client = createClient(local.url, local.anonKey, {
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
		auth: ONE_SHOT_AUTH
	});
	return {
		client,
		userId: data.user.id,
		role: (data.user.app_metadata?.role as string) ?? 'analyst'
	};
}

export function analystClient(): Promise<{
	client: SupabaseClient;
	userId: string;
	role: string;
}> {
	return staffClient(TEST_ANALYST.email, TEST_ANALYST.password);
}

export function adminClient(): Promise<{
	client: SupabaseClient;
	userId: string;
	role: string;
}> {
	return staffClient(TEST_ADMIN.email, TEST_ADMIN.password);
}

// The seeded profile setter — TRUE means first-time password setup is complete.
export async function getPasswordSet(client: SupabaseClient, userId: string): Promise<boolean> {
	const { data } = await (client.from('profiles') as any)
		.select('password_set')
		.eq('id', userId)
		.single();
	return Boolean(data?.password_set);
}
