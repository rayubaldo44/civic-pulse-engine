import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Centralises access to the LOCAL Supabase CLI stack for both the integration
// (vitest) and end-to-end (Playwright) suites.
//
// Resolution order:
//   1. explicit env vars (SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY /
//      SUPABASE_SERVICE_ROLE_KEY) — handy for CI or pointing elsewhere;
//   2. otherwise shells out to the repo-local Supabase CLI
//      (`node_modules/.bin/supabase status --output json`) and reads the anon +
//      service-role keys (memoised).
//
// The same helper backs the Playwright webServer env so the app's own
// `$env/static/public` / `$env/dynamic/private` resolve to the local stack.
//
// Tooling is invoked by absolute path (never via a bare `pnpm` / `npx` on
// PATH): Playwright and vitest are frequently launched from contexts without
// the user's global bin dir — VS Code's test runner, Docker, CI, cron — where
// a globally installed pnpm is not on PATH. See `bin()` below.

export interface LocalSupabase {
	/** REST/Auth API base, e.g. http://127.0.0.1:54321 (no trailing slash). */
	url: string;
	anonKey: string;
	serviceRoleKey: string;
}

// Repo root, derived from this file's own location (tests/shared/ -> ../..)
// rather than process.cwd(), so the lookup is stable no matter which
// directory the runner was started from.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Absolute path to a binary installed in the repo's local `node_modules/.bin`.
 * Prefixed onto PATH by the package manager when running scripts, so it is
 * present in every context that ran an install.
 */
export function bin(name: string): string {
	const resolved = path.join(
		REPO_ROOT,
		'node_modules/.bin',
		process.platform === 'win32' ? `${name}.cmd` : name
	);
	if (!existsSync(resolved)) {
		throw new Error(
			`Could not find the local \`${name}\` binary at ${resolved}. ` +
				'Run `pnpm install` to install workspace dependencies before running tests.'
		);
	}
	return resolved;
}

let cached: LocalSupabase | null = null;

function runStatus(): Record<string, any> {
	// execFileSync (no shell) so resolution never depends on PATH, and so a
	// repo path containing spaces cannot break the command line. Each flag and
	// its value must be a separate argv element — nothing word-splits for us.
	// The CLI resolves the project from the working directory, hence `cwd`.
	const raw = execFileSync(bin('supabase'), ['status', '--output', 'json'], {
		encoding: 'utf8',
		cwd: REPO_ROOT
	});
	// Strip ANSI escape sequences the CLI may emit before the JSON payload.
	const clean = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
	return JSON.parse(clean) as Record<string, any>;
}

export function getLocalSupabase(): LocalSupabase {
	if (cached) return cached;

	const envUrl = process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
	const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (envUrl && anonKey && serviceRoleKey) {
		cached = { url: envUrl.replace(/\/$/, ''), anonKey, serviceRoleKey };
		return cached;
	}

	const status = runStatus();
	const api = (status?.api ?? status) as Record<string, any>;
	const url = api?.url ?? api?.API_URL ?? status?.auth?.url ?? 'http://127.0.0.1:54321';
	const anon = api?.anon_key ?? api?.ANON_KEY ?? status?.auth?.anon_key;
	const svc = api?.service_role_key ?? api?.SERVICE_ROLE_KEY ?? status?.auth?.service_role_key;
	if (!url || !anon || !svc) {
		throw new Error(
			'Could not resolve local Supabase credentials. Start the stack with ' +
				'`pnpm supabase start` (and `pnpm supabase db reset` once) before running tests. ' +
				'You can also bypass the CLI lookup entirely by exporting SUPABASE_URL, ' +
				'PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.'
		);
	}
	cached = {
		url: String(url).replace(/\/$/, ''),
		anonKey: String(anon),
		serviceRoleKey: String(svc)
	};
	return cached;
}

// ── Seed accounts ─────────────────────────────────────────────────────────────
// Deterministic, shared across both suites. `password_set` is flipped to true
// so sign-in works and /set-password stays out of the happy path.
export const TEST_ADMIN = {
	email: 'admin@civicpulse.test',
	password: 'AdminTest2026!',
	name: 'Test Admin',
	role: 'admin'
} as const;

export const TEST_ANALYST = {
	email: 'analyst@civicpulse.test',
	password: 'AnalystTest2026!',
	name: 'Test Analyst',
	role: 'analyst'
} as const;

// Dedicated account for the logout e2e test. Signing out (global scope)
// revokes that user's sessions, so it must NOT be one of the accounts whose
// storageState other tests depend on.
export const TEST_LOGOUT = {
	email: 'logout@civicpulse.test',
	password: 'LogoutTest2026!',
	name: 'Test Logout',
	role: 'analyst'
} as const;

export const TEST_CREDENTIALS = [TEST_ADMIN, TEST_ANALYST] as const;
