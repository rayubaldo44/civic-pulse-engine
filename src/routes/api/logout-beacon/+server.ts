// src/routes/api/logout-beacon/+server.ts
//
// Auto-logout beacon endpoint.
//
// Called via navigator.sendBeacon() from +layout.svelte when the browser
// detects the tab/window is being closed (pagehide event, persisted=false).
// sendBeacon guarantees delivery even as the page is unloading — unlike
// a regular fetch() which is cancelled by the browser on close.
//
// Security notes:
//  - The request includes the user's session cookies automatically (same-origin).
//  - We validate the session server-side before signing out.
//  - signOut() with scope:'local' clears the cookie; the refresh token is also
//    invalidated server-side by Supabase, preventing session replay.
//  - This endpoint intentionally returns 204 with no body — beacons do not
//    read responses, so exposing any data here is pointless and wastes bytes.

import type { RequestHandler } from './$types';
import { logAudit } from '$lib/server/audit';

export const POST: RequestHandler = async ({ locals: { safeGetSession, supabase } }) => {
	const { user } = await safeGetSession();

	// Only sign out if the Auth server verified an active user — silently
	// ignore anonymous pings (e.g. beacon from a session that already expired).
	if (user) {
		await logAudit({
			action: 'auth.logout',
			actorId: user.id,
			actorEmail: user.email ?? 'system',
			resourceType: 'auth',
			details: 'Tab closed — auto logout'
		});
		await supabase.auth.signOut({ scope: 'local' });
	}

	// 204 No Content — beacons ignore the response body anyway.
	return new Response(null, { status: 204 });
};
