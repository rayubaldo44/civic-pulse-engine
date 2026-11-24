// Vitest stand-in for SvelteKit's $env/static/public virtual module.
// Placeholder values — tests that assert behaviour around these mock the
// module's factory (e.g. $supabase/ssr is mocked in hooks.test.ts anyway).
export const PUBLIC_SUPABASE_URL = 'http://localhost';
export const PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
