// src/routes/+layout.server.ts
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession }, cookies }) => {
	const { user } = await safeGetSession();
	return {
		// user is Auth-server-verified (getUser()); session is never propagated.
		user,
		cookies: cookies.getAll() // ← required by +layout.ts for SSR client
	};
};
