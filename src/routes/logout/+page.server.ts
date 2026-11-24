import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { logAudit } from '$lib/server/audit';

export const actions: Actions = {
	default: async ({ locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		await supabase.auth.signOut();

		await logAudit({
			action: 'auth.logout',
			actorId: user?.id ?? null,
			actorEmail: user?.email ?? 'system',
			resourceType: 'auth'
		});

		redirect(303, '/login');
	}
};
