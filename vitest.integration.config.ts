import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/integration/**/*.test.ts'],
		environment: 'node',
		// Live DB state is shared — serialize files so per-file re-seeds never race.
		fileParallelism: false,
		globalSetup: ['./tests/integration/global-setup.ts'],
		testTimeout: 30_000,
		hookTimeout: 60_000
	}
});
