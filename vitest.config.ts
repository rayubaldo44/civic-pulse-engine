import path from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [svelte({ configFile: 'svelte.config.js' })],
	resolve: {
		alias: {
			$lib: path.resolve(process.cwd(), 'src/lib'),
			// SvelteKit virtual env modules are provided by the sveltekit()
			// plugin, which vitest does not load — alias them to test stubs.
			// Specific tests override via vi.mock('$env/<kind>', factory).
			'$env/dynamic/private': path.resolve(
				process.cwd(),
				'tests/unit/helpers/env-stubs/dynamic-private.ts'
			),
			'$env/dynamic/public': path.resolve(
				process.cwd(),
				'tests/unit/helpers/env-stubs/dynamic-public.ts'
			),
			'$env/static/public': path.resolve(
				process.cwd(),
				'tests/unit/helpers/env-stubs/static-public.ts'
			),
			'$app/navigation': path.resolve(process.cwd(), 'tests/unit/helpers/app-stubs/navigation.ts'),
			'$app/forms': path.resolve(process.cwd(), 'tests/unit/helpers/app-stubs/forms.ts'),
			'$app/state': path.resolve(process.cwd(), 'tests/unit/helpers/app-stubs/state.ts')
		},
		// Svelte 5 must resolve to the client build inside vitest
		...(process.env.VITEST ? { conditions: ['browser'] } : {})
	},
	test: {
		include: ['tests/unit/**/*.test.ts'],
		environment: 'happy-dom'
	}
});
