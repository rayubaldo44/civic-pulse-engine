// src/lib/types/sentiment-trends.ts
// Shared (client + server) types and constants for the sentiment trend chart
// and the feed date filter. Pure, dependency-free module following the
// $lib/types/issues.ts precedent so client code can share one source of truth
// with $lib/server without importing from $lib/server.

/** Range ids accepted by GET /api/sentiment-trends (?range=). */
export type TrendRangeId = 'live' | 'weekly' | 'monthly' | 'yearly';

export const TREND_RANGES: readonly TrendRangeId[] = ['live', 'weekly', 'monthly', 'yearly'];

/** Response shape of GET /api/sentiment-trends. */
export interface TrendResponse {
	range: string;
	generatedAt: string;
	labels: string[];
	positive: number[];
	negative: number[];
	neutral: number[];
	mode: string;
}

/** Feed date-window ids (?range= on the Live Data Stream page). */
export type DateFilterRange = 'all' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export const DATE_FILTER_RANGES: readonly DateFilterRange[] = [
	'all',
	'weekly',
	'monthly',
	'yearly',
	'custom'
];
