// src/lib/server/audit.ts
//
// Central audit-logging utility. Every mutation in the app funnels through
// logAudit() so a single implementation controls format, actor resolution,
// and failure behaviour.
//
// Design constraints:
//   - Audit failures are ALWAYS swallowed. Logging must never block or fail
//     the user-facing operation that triggered it — the mutation succeeded,
//     we just couldn't record it.
//   - `details` is a JSON string so the reports page can render structured
//     change data and (optionally) query into it later.
//   - actor_id is derived from the caller's user object (Auth-verified).
//     actor_email we take from the same object; a system action passes the
//     email 'system'.
//
// Server-only (lives under $lib/server/) so Vite blocks any client import.

import { getServiceSupabase } from '$lib/server/supabase';

export interface AuditInput {
	/** Machine-readable action label, e.g. 'document.update'. */
	action: string;
	actorId: string | null;
	actorEmail: string;
	/** Free-form human/machine-readable change description (JSON string). */
	details?: string | null;
	/** What kind of record was affected ('document', 'issue', 'config', ...). */
	resourceType?: string | null;
	/** UUID / id of the affected record when relevant. */
	resourceId?: string | null;
	/** Client IP (from event.getClientAddress()) when available. */
	ipAddress?: string | null;
	/** Client User-Agent (from request headers) when available. */
	userAgent?: string | null;
}

/**
 * Best-effort insert into the append-only audit_logs table.
 * Resolves nothing itself beyond a single INSERT; the caller supplies the
 * actor identity it already verified.
 */
export async function logAudit(input: AuditInput): Promise<void> {
	try {
		const supabase = getServiceSupabase();
		await (supabase.from('audit_logs') as any).insert({
			action: input.action,
			actor_id: input.actorId,
			actor_email: input.actorEmail,
			details: input.details ?? null,
			resource_type: input.resourceType ?? null,
			resource_id: input.resourceId ?? null,
			ip_address: input.ipAddress ?? null,
			user_agent: input.userAgent ?? null
		});
	} catch (err) {
		// Never let auditing break the primary operation.
		console.error('[audit] logAudit failed:', err);
	}
}

/**
 * Convenience builder for structured change details so callers don't
 * hand-assemble JSON.
 */
export function buildDetails(pairs: Record<string, unknown>): string {
	return JSON.stringify(pairs);
}
