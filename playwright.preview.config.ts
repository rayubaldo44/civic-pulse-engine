import { defineConfig } from '@playwright/test';
import { getLocalSupabase, bin } from './tests/shared/supabase-env';

const local = getLocalSupabase();
if (!['127.0.0.1', 'localhost'].includes(new URL(local.url).hostname)) {
	throw new Error(
		'Preview tests seed fixtures and require local Supabase. Use scripts/measure-performance.mjs for hosted measurements.'
	);
}

export default defineConfig({
	testDir: './tests/e2e',
	testMatch:
		/(?:auth|dashboard|issues|issues-pagination|claims-pagination|reference-docs|flagged-claims|reports|admin)\.spec\.ts/,
	globalSetup: './tests/e2e/global-setup.ts',
	// NLP ingestion needs the separate Edge/HuggingFace stack; this suite verifies page loading.
	grepInvert: /Claim Detection & RAG Pipeline/,
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60_000,
	reporter: [['list']],
	use: {
		baseURL: 'http://localhost:4173',
		viewport: { width: 1280, height: 800 },
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	webServer: {
		command: `"${bin('vite')}" build && "${bin('vite')}" preview --host 127.0.0.1 --port 4173 --strictPort`,
		url: 'http://localhost:4173',
		reuseExistingServer: !process.env.CI,
		env: {
			PUBLIC_SUPABASE_URL: local.url,
			SUPABASE_URL: local.url,
			PUBLIC_SUPABASE_ANON_KEY: local.anonKey,
			SUPABASE_SERVICE_ROLE_KEY: local.serviceRoleKey,
			DEMO_ONLY: 'false',
			APP_ORIGIN: 'http://localhost:4173'
		}
	}
});
