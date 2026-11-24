// PATCH /Authenticated/flagged-claims — persists review decisions to Supabase.
// Called by +page.svelte handleAction() via fetch('', { method: 'PATCH' }).

import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import { invalidateBadges } from '$lib/server/badges-cache';
import { logAudit, buildDetails } from '$lib/server/audit';

const VALID_STATUSES = new Set(['Pending', 'Verified False', 'Verified True', 'Inconclusive']);

export const PATCH: RequestHandler = async ({
	request,
	locals: { safeGetSession },
	getClientAddress
}) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const body = await request.json().catch(() => null);
	if (!body || typeof body.id !== 'string' || !VALID_STATUSES.has(body.status)) {
		return json(
			{ error: 'Invalid request body — expected { id: string, status: string }' },
			{ status: 400 }
		);
	}

	const { id, status } = body as { id: string; status: string };
	const ipAddress = getClientAddress();
	const userAgent = request.headers.get('user-agent') ?? null;
	const supabase = getServiceSupabase();

	const { error: updateError } = await (supabase.from('flagged_claims') as any)
		.update({ status })
		.eq('id', id);

	if (updateError) {
		console.error('[flagged_claims] PATCH update error:', updateError.message);
		return json({ error: 'Failed to update flagged claim status' }, { status: 500 });
	}

	const { data: claim } = await (supabase.from('flagged_claims') as any)
		.select('claim_text, status')
		.eq('id', id)
		.maybeSingle();

	// Best-effort audit trail — don't fail the PATCH if review_records is missing
	if (status !== 'Pending') {
		const { error: auditError } = await (supabase.from('review_records') as any).insert({
			flagged_claim_id: id,
			reviewed_by: user.id,
			decision: status,
			notes: null
		});
		if (auditError) {
			console.error('[flagged_claims] PATCH audit insert skipped:', auditError.message);
		}
	}

	await logAudit({
		action: 'claim.review',
		actorId: user.id,
		actorEmail: user.email ?? 'system',
		resourceType: 'claim',
		resourceId: id,
		ipAddress,
		userAgent,
		details: buildDetails({
			previous_status: (claim as { status?: string } | null)?.status ?? 'Pending',
			new_status: status,
			claim_text: ((claim as { claim_text?: string } | null)?.claim_text ?? '').slice(0, 200)
		})
	});

	// The pending badge count changed — clear the acting user's cached copy so
	// the sidebar reflects it on the next navigation.
	invalidateBadges(user.id);

	return json({ success: true });
};
