export function formatDateTime(iso: string): string {
	return new Date(iso).toLocaleString('en-PH', {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

const RELATIVE_UNITS: { limit: number; divisor: number; unit: Intl.RelativeTimeFormatUnit }[] = [
	{ limit: 60, divisor: 1, unit: 'second' },
	{ limit: 3_600, divisor: 60, unit: 'minute' },
	{ limit: 86_400, divisor: 3_600, unit: 'hour' },
	{ limit: 604_800, divisor: 86_400, unit: 'day' }
];

/**
 * Compact relative timestamp for notification feeds ("4m ago", "3d ago").
 *
 * Anything older than a week falls back to an absolute en-PH date rather than
 * "8 weeks ago" — a feed that only ever shows recent alerts doesn't need the
 * extra precision, and a bare month count is hard to act on.
 */
export function formatRelative(iso: string, now: Date = new Date()): string {
	const then = new Date(iso);
	if (Number.isNaN(then.getTime())) return '';

	const elapsedSeconds = Math.round((now.getTime() - then.getTime()) / 1000);
	// Future timestamps (clock skew) read as "just now" rather than negative.
	if (elapsedSeconds < 45) return 'just now';

	const formatter = new Intl.RelativeTimeFormat('en-PH', { numeric: 'auto' });
	for (const { limit, divisor, unit } of RELATIVE_UNITS) {
		if (elapsedSeconds < limit) {
			return formatter.format(-Math.floor(elapsedSeconds / divisor), unit);
		}
	}

	return then.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}
