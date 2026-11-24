// See https://svelte.dev/docs/kit/types#app.d.ts

import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			timings?: import('$lib/server/timing').RequestTimings;
			supabase: SupabaseClient;
			/**
			 * Returns only the Auth-server-verified user (from getUser()).
			 * The raw getSession() value embeds an untrusted session.user and
			 * is never propagated — callers must treat `user` as the sole
			 * authoritative identity signal.
			 */
			safeGetSession: () => Promise<{ user: User | null }>;
			/** memoization flag for per-request safeGetSession */
			_sessionResolved?: boolean;
		}
		// interface PageState {}
		// interface Platform {}

		interface FlaggedItem {
			id: string;
			flag_reason: string;
			evidence_snippet: string | null;
			status: 'pending' | 'verified_false' | 'verified_true' | 'inconclusive';
			created_at: string;
			processed_comments: {
				content: string;
				source_platform: string | null;
			} | null;
			reviewState: 'pending' | 'false_claim' | 'verified_true' | 'skipped';
		}

		interface PageData {
			session?: Session | null;
			user?: User | null;
			role?: 'admin' | 'analyst';
			flaggedItems?: FlaggedItem[];
		}
	}
}

export {};
