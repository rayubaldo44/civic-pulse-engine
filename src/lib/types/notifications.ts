// src/lib/types/notifications.ts
//
// Client-safe notification types and constants. Server modules under
// $lib/server/* re-export from here so both sides share one definition
// (same pattern as $lib/types/sentiment-trends.ts ↔ $lib/server/sentiment-trends.ts).

export type NotificationCategory = 'trend_alert' | 'issue_peer_review';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface AppNotification {
	id: string;
	category: NotificationCategory;
	severity: NotificationSeverity;
	title: string;
	body: string;
	/** Deep link within the app, e.g. '/Authenticated/dashboard?topic=Infrastructure'. */
	href: string | null;
	entity_type: string | null;
	entity_id: string | null;
	/** Null while unread. */
	read_at: string | null;
	created_at: string;
}

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
	trend_alert: 'Trend alerts',
	issue_peer_review: 'Issue peer reviews'
};

export const CATEGORY_DESCRIPTIONS: Record<NotificationCategory, string> = {
	trend_alert: 'When a topic priority score spikes, drops, or a new topic takes the top spot.',
	issue_peer_review: 'When a resolution needs your review, becomes overdue, or reaches a decision.'
};

/** Categories the UI knows how to render an icon/tint for. */
export const CATEGORY_ORDER: NotificationCategory[] = ['trend_alert', 'issue_peer_review'];

export function isNotificationCategory(value: unknown): value is NotificationCategory {
	return typeof value === 'string' && value in CATEGORY_LABELS;
}

// ── Per-user preferences ────────────────────────────────────────────────────

export type NotificationChannel = 'in_app' | 'email';

export type ChannelPrefs = Record<NotificationChannel, boolean>;

/** category → channel → enabled. Absent entries fall back to the global flags. */
export type CategoryPrefs = Record<NotificationCategory, ChannelPrefs>;

export interface NotificationPrefs {
	in_app: boolean;
	email: boolean;
	categories: CategoryPrefs;
}

/**
 * trend_alert email defaults to ON: unlike a per-comment alert, a
 * cross-threshold topic movement is weekly-ish in volume, and the evaluator's
 * catch-up sweep is what lets it reach users who weren't polling.
 */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
	in_app: true,
	email: true,
	categories: {
		trend_alert: { in_app: true, email: true },
		issue_peer_review: { in_app: true, email: true }
	}
};

/** Fill in any missing keys from the defaults so callers get a complete object. */
export function normalizeNotificationPrefs(input: unknown): NotificationPrefs {
	const fallback = DEFAULT_NOTIFICATION_PREFS;
	if (!input || typeof input !== 'object') return structuredClone(fallback);

	const raw = input as Partial<NotificationPrefs>;
	const normalized: NotificationPrefs = {
		in_app: typeof raw.in_app === 'boolean' ? raw.in_app : fallback.in_app,
		email: typeof raw.email === 'boolean' ? raw.email : fallback.email,
		categories: structuredClone(fallback.categories)
	};

	if (raw.categories && typeof raw.categories === 'object') {
		for (const category of CATEGORY_ORDER) {
			const entry = (raw.categories as Record<string, unknown>)[category];
			if (!entry || typeof entry !== 'object') continue;
			const channels = entry as Partial<ChannelPrefs>;
			const base = fallback.categories[category];
			normalized.categories[category] = {
				in_app: typeof channels.in_app === 'boolean' ? channels.in_app : base.in_app,
				email: typeof channels.email === 'boolean' ? channels.email : base.email
			};
		}
	}

	return normalized;
}

/**
 * Whether a channel is enabled for a category.
 *
 * `in_app` / `email` are MASTER switches: they gate every category, so a user
 * can silence a whole channel in one place without hunting per-category
 * toggles. The per-category flag then re-enables an individual category within
 * an otherwise-muted channel.
 *
 * AND semantics rather than fallback, deliberately. A pure "fallback when
 * absent" reading is unreachable in practice, because normalizeNotificationPrefs()
 * always materialises a concrete value for every known category — so a global
 * flag could never be consulted and would be dead code.
 */
export function isChannelEnabled(
	prefs: NotificationPrefs,
	category: NotificationCategory,
	channel: NotificationChannel
): boolean {
	if (!prefs[channel]) return false;
	const explicit = prefs.categories?.[category]?.[channel];
	return typeof explicit === 'boolean' ? explicit : true;
}
