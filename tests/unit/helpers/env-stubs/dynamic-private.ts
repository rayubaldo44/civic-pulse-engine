// Vitest stand-in for SvelteKit's $env/dynamic/private virtual module.
// The real module is provided by the sveltekit() Vite plugin, which the
// vitest config deliberately does not load — so modules that import it
// (src/lib/server/notify.ts) get this empty stub instead. Tests that need
// specific values vi.mock('$env/dynamic/private') with a factory override.
export const env: Record<string, string | undefined> = {};
