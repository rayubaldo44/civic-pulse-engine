import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { getLocalSupabase, bin } from './tests/shared/supabase-env';

const local = getLocalSupabase();

// Quote the resolved absolute paths: Playwright runs these through a shell, and
// the checkout may live under a path containing spaces.
const sh = (s: string) => `"${s}"`;

// Env vars injected into the dev-server process so `$env/static/public` and
// `$env/dynamic/private` resolve to the LOCAL stack — never the production
// values that may live in `.env.local`.
const appEnv: Record<string, string> = {
	PUBLIC_SUPABASE_URL: local.url,
	PUBLIC_SUPABASE_ANON_KEY: local.anonKey,
	SUPABASE_URL: local.url,
	SUPABASE_SERVICE_ROLE_KEY: local.serviceRoleKey,
	// Prevent the Resend email path from throwing in dev.
	APP_ORIGIN: 'http://localhost:5173'
};

const config: PlaywrightTestConfig = {
	testDir: './tests/e2e',
	testMatch: '**/*.spec.ts',
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? 'html' : [['html', { open: 'never' }]],
	// Seed the DB and write .auth/*.json storage state files before any
	// test project runs. This replaces the older "setup project" pattern.
	globalSetup: './tests/e2e/global-setup.ts',

	timeout: 60_000,
	expect: { timeout: 5_000 },

	use: {
		baseURL: 'http://localhost:5173',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure'
	},

	projects: [
		{
			name: 'e2e',
			use: { viewport: { width: 1280, height: 720 } }
		}
	],

	// Launch the Vite dev server after the "setup" project seeds the DB and
	// writes the .auth JSON files. The webServer block starts only once,
	// after the setup project completes and before any test project begins.
	webServer: [
		{
			command: `${sh(bin('vite'))} dev --port 5173 --strictPort`,
			url: 'http://localhost:5173',
			env: appEnv,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000
		},
		{
			command: `${sh(bin('supabase'))} functions serve`,
			url: 'http://127.0.0.1:54321/functions/v1/process-comment',
			env: {
				...appEnv,
				HF_SPACE_URL: 'https://ArthurOrg-civicpulse-nlp.hf.space',
				GROQ_API_KEY: ''
			},
			reuseExistingServer: !process.env.CI,
			timeout: 120_000
		}
	]
};

export default config;
