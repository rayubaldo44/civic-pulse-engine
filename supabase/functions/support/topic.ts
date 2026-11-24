// supabase/functions/support/topic.ts
//
// Pure topic normalizer shared by Edge Functions. Deliberately mirrors
// $lib/utils/priority.ts (TOPIC_ALIASES + canonical pass-through) — Edge
// Functions run under Deno and cannot import from the SvelteKit `$lib` alias,
// so the alias map is duplicated here. Keep both in sync when the NLP service
// emits new compound label variants.

export type TopicCategory =
	'Infrastructure' | 'Healthcare' | 'Waste Management' | 'Public Safety' | 'Other';

export const CANONICAL_TOPICS: readonly TopicCategory[] = [
	'Infrastructure',
	'Healthcare',
	'Waste Management',
	'Public Safety',
	'Other'
];

// The NLP service emits compound labels outside the five-topic taxonomy
// (e.g. "Public Safety and Peace and Order"). Route raw labels through
// normalizeTopic() before any equality filter — never eq()-filter on raw values.
const TOPIC_ALIASES: Record<string, TopicCategory> = {
	'public safety and peace and order': 'Public Safety',
	'infrastructure and public works': 'Infrastructure',
	'healthcare and medical services': 'Healthcare',
	'health services': 'Healthcare',
	'waste management and sanitation': 'Waste Management'
};

export function normalizeTopic(label: string | null | undefined): TopicCategory {
	const key = (label ?? '').trim().toLowerCase();
	if (!key) return 'Other';

	for (const canonical of CANONICAL_TOPICS) {
		if (canonical.toLowerCase() === key) return canonical;
	}
	return TOPIC_ALIASES[key] ?? 'Other';
}
