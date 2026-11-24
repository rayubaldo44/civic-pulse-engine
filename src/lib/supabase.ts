import { createBrowserClient } from '@supabase/auth-helpers-sveltekit';
import { env } from '$env/dynamic/public';

export const createSupabaseBrowserClient = () => {
	return createBrowserClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY);
};
