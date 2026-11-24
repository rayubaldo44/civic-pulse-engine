import type { Priority } from '$lib/types/issues';

export function priorityBadge(p: Priority): string {
	switch (p) {
		case 'Critical':
			return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/20';
		case 'High':
			return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/20';
		case 'Medium':
			return 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/20';
		case 'Low':
			return 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/20';
	}
}

export function ragBadgeClass(det: string | null): string {
	switch (det) {
		case 'Refuted':
			return 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/20';
		case 'Supported':
			return 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/20';
		case 'Insufficient Evidence':
			return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/20';
		default:
			return 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/20';
	}
}

export function sentimentDot(label: string | null): string {
	switch (label) {
		case 'positive':
			return 'bg-emerald-400 dark:bg-emerald-500';
		case 'negative':
			return 'bg-rose-400 dark:bg-rose-500';
		case 'review':
			return 'bg-amber-400 dark:bg-amber-500';
		default:
			return 'bg-slate-300 dark:bg-slate-600';
	}
}
