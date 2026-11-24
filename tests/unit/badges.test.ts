import { describe, it, expect } from 'vitest';
import { priorityBadge, ragBadgeClass, sentimentDot } from '$lib/utils/badges';

describe('priorityBadge', () => {
	it.each(['Critical', 'High', 'Medium', 'Low'])('renders a distinct class string for %s', (p) => {
		// enums typed as Priority — cast through the union
		const cls = priorityBadge(p as 'Critical' | 'High' | 'Medium' | 'Low');
		expect(cls).toBeTruthy();
		expect(cls).toContain('border');
		expect(cls).toContain('dark:');
	});

	it('returns a distinct token per priority (no accidental collisions)', () => {
		const classes = ['Critical', 'High', 'Medium', 'Low'].map((p) =>
			priorityBadge(p as 'Critical' | 'High' | 'Medium' | 'Low')
		);
		expect(new Set(classes).size).toBe(4);
	});
});

describe('ragBadgeClass', () => {
	it('maps each determination to its own badge', () => {
		expect(ragBadgeClass('Refuted')).toContain('rose');
		expect(ragBadgeClass('Supported')).toContain('emerald');
		expect(ragBadgeClass('Insufficient Evidence')).toContain('amber');
	});

	it('falls back to the neutral gray for null/unknown determinations', () => {
		expect(ragBadgeClass(null)).toContain('gray');
		expect(ragBadgeClass('Maybe')).toContain('gray');
	});
});

describe('sentimentDot', () => {
	it('maps the four sentiment labels to color dots', () => {
		expect(sentimentDot('positive')).toContain('emerald');
		expect(sentimentDot('negative')).toContain('rose');
		expect(sentimentDot('review')).toContain('amber');
		expect(sentimentDot('neutral')).toContain('slate');
	});

	it('falls back to slate for null/unknown labels', () => {
		expect(sentimentDot(null)).toContain('slate');
		expect(sentimentDot('urgent')).toContain('slate');
	});
});
