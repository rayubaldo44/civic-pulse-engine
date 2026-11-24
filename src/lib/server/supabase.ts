// src/lib/server/supabase.ts
// Server-only Supabase client using the service role key.
// Anything inside src/lib/server/ is automatically blocked from client-side
// imports by SvelteKit — safe to store privileged credentials here.

import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

// Service role key bypasses RLS — only use this server-side.
// Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
//
// Capture native fetch at module load time (before SvelteKit's render wrapper
// installs its globalThis.fetch interception). This ensures server-side
// Supabase HTTP calls bypass the SSR "avoid calling fetch eagerly" warning
// while keeping the same native fetch semantics.
const nativeFetch = globalThis.fetch;

// Lazy singleton — createClient is deferred until first call so that
// SvelteKit's build-time module analysis doesn't throw when env vars
// aren't present yet (Vercel sets them at runtime, not build time).
let _client: ReturnType<typeof createClient> | null = null;

export function getServiceSupabase() {
	if (!_client) {
		_client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
			global: { fetch: nativeFetch }
		});
	}
	return _client;
}
