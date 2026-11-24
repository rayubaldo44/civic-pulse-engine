import path from 'node:path';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { seedDatabase } from '../shared/seed';
import { getLocalSupabase, TEST_ADMIN, TEST_ANALYST } from '../shared/supabase-env';

const AUTH_DIR = path.resolve('tests/e2e/.auth');

// Playwright globalSetup runs before any projects begin. It seeds the DB and
// then persists two storageState JSON files (admin / analyst) that the
// "admin" and "analyst" Playwright projects reuse via the `dependencies`
// declared in playwright.config.ts.
export default async function globalSetup(): Promise<void> {
	const snapshot = await seedDatabase();
	const local = getLocalSupabase();
	// This client exists only to obtain a session and write the storageState
	// files. It must not run the background auto-refresh ticker: the process
	// outlives the sign-in, and a re-seed of a seeded user invalidates the
	// refresh token, which would surface as an un-awaited "Invalid Refresh
	// Token" rejection while the suite is running.
	const auth = createClient(local.url, local.anonKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});

	// The cookie name is derived from the Supabase URL's first hostname
	// segment exactly like @supabase/ssr does: sb-<host>-auth-token.
	const storageKey = `sb-${new URL(local.url).hostname.split('.')[0]}-auth-token`;

	if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

	for (const creds of [
		{ label: 'admin', ...TEST_ADMIN, userId: snapshot.adminUserId },
		{ label: 'analyst', ...TEST_ANALYST, userId: snapshot.analystUserId }
	]) {
		const { data, error } = await auth.auth.signInWithPassword({
			email: creds.email,
			password: creds.password
		});
		if (error || !data.session)
			throw new Error(`setup sign-in failed (${creds.label}): ${error?.message}`);

		const cookies = [
			{
				name: storageKey,
				value: JSON.stringify({
					access_token: data.session.access_token,
					expires_at: data.session.expires_at,
					expires_in: data.session.expires_in,
					refresh_token: data.session.refresh_token,
					token_type: data.session.token_type,
					user: data.user
				}),
				domain: 'localhost',
				path: '/',
				httpOnly: true,
				sameSite: 'Lax' as const,
				secure: false,
				// Epoch seconds — long enough for the suite duration.
				expires: Math.floor(Date.now() / 1000) + 60 * 60 * 8
			}
		];

		const storageState = {
			cookies,
			origins: [
				{
					origin: 'http://localhost:5173',
					localStorage: [
						{
							name: 'civicpulse-auth',
							value: JSON.stringify({ userId: creds.userId })
						}
					]
				}
			]
		};

		const file = path.join(AUTH_DIR, `${creds.label}.json`);
		fs.writeFileSync(file, JSON.stringify(storageState, null, '\t'), 'utf8');
	}
}
