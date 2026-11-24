import { describe, it, expect } from 'vitest';
import { diffTopicPriorities, TREND_RULES } from '../../src/lib/server/trend-diff';
import type { TopicSnapshot } from '../../src/lib/server/trend-diff';
import type { TopicPriority } from '../../src/lib/utils/priority';

/** A TopicPriority with sensible defaults, so each test only states what matters. */
function priority(overrides: Partial<TopicPriority> = {}): TopicPriority {
	return {
		topic: 'Healthcare',
		displayName: 'Health Services',
		rank: 1,
		score: 50,
		frequencyComponent: 0.5,
		negativityComponent: 0.2,
		engagementComponent: 0.3,
		status: 'Monitoring',
		commentCount: 20,
		negativeCount: 4,
		engagementCount: 10,
		...overrides
	};
}

function snapshot(overrides: Partial<TopicSnapshot> = {}): TopicSnapshot {
	return {
		topic: 'Healthcare',
		score: 50,
		rank: 1,
		negativity: 0.2,
		commentCount: 20,
		...overrides
	};
}

/** Only the alerts fired by a given rule, in emission order. */
function rulesFor(alerts: { rule: string }[]): string[] {
	return alerts.map((a) => a.rule);
}

const WINDOW = 30;

describe('diffTopicPriorities — baseline', () => {
	it('establishes a baseline and emits nothing on the first evaluation', () => {
		const result = diffTopicPriorities([priority({ score: 99, rank: 1 })], [], WINDOW);

		expect(result.baselineEstablished).toBe(true);
		expect(result.alerts).toEqual([]);
	});

	it('returns a snapshot for every current topic', () => {
		const result = diffTopicPriorities(
			[
				priority({ topic: 'Healthcare', score: 60, rank: 1 }),
				priority({ topic: 'Infrastructure', displayName: 'Road Repair', score: 40, rank: 2 })
			],
			[],
			WINDOW
		);

		expect(result.nextSnapshots).toEqual([
			{ topic: 'Healthcare', score: 60, rank: 1, negativity: 0.2, commentCount: 20 },
			{ topic: 'Infrastructure', score: 40, rank: 2, negativity: 0.2, commentCount: 20 }
		]);
	});

	it('does not fire score rules for a topic with no prior snapshot', () => {
		// A brand-new topic has no score to have "crossed" a threshold, so
		// firing score-high here would be noise on every newly-seen topic.
		// (new-leader still fires: a different topic genuinely is on top now.)
		const result = diffTopicPriorities(
			[priority({ topic: 'Healthcare', score: 95, rank: 1 })],
			[snapshot({ topic: 'Other' })],
			WINDOW
		);

		const rules = rulesFor(result.alerts);
		expect(rules).not.toContain('score-high');
		expect(rules).not.toContain('score-drop');
		expect(rules).not.toContain('score-jump');
	});

	it('is idempotent when nothing changed', () => {
		const current = [priority({ score: 72, rank: 1, negativityComponent: 0.2, commentCount: 20 })];
		const previous = [snapshot({ score: 72, rank: 1, negativity: 0.2, commentCount: 20 })];

		const result = diffTopicPriorities(current, previous, WINDOW);

		expect(result.alerts).toEqual([]);
		expect(result.baselineEstablished).toBe(false);
	});
});

describe('diffTopicPriorities — score-high', () => {
	it('fires when a score crosses into the high band', () => {
		const result = diffTopicPriorities(
			[priority({ score: 75, rank: 1, commentCount: 20 })],
			[snapshot({ score: 60, rank: 1 })],
			WINDOW
		);

		const high = result.alerts.find((a) => a.rule === 'score-high');
		expect(high).toBeDefined();
		expect(high?.severity).toBe('critical');
		expect(high?.fingerprint).toBe('trend:Healthcare:30:score-high');
		expect(high?.href).toBe('/Authenticated/dashboard?topic=Healthcare');
	});

	it('does not fire when the score was already high', () => {
		const result = diffTopicPriorities(
			[priority({ score: 80, rank: 1, commentCount: 20 })],
			[snapshot({ score: 75, rank: 1 })],
			WINDOW
		);

		expect(rulesFor(result.alerts)).not.toContain('score-high');
	});

	it('is suppressed below the absolute comment floor', () => {
		// The guard that stops a 3-comment topic with 100% negativity from
		// triggering "critical" in a quiet week.
		const result = diffTopicPriorities(
			[priority({ score: 95, rank: 1, commentCount: TREND_RULES.SCORE_HIGH_MIN_COMMENTS - 1 })],
			[snapshot({ score: 40, rank: 1 })],
			WINDOW
		);

		expect(rulesFor(result.alerts)).not.toContain('score-high');
	});

	it('still reports a drop-out below the comment floor', () => {
		// Falling out of "hot" is always actionable, even for a small topic.
		const result = diffTopicPriorities(
			[priority({ score: 30, rank: 1, commentCount: 3 })],
			[snapshot({ score: 80, rank: 1, commentCount: 3 })],
			WINDOW
		);

		expect(rulesFor(result.alerts)).toContain('score-drop');
	});
});

describe('diffTopicPriorities — score-drop', () => {
	it('fires when a hot score falls back below the threshold', () => {
		const result = diffTopicPriorities(
			[priority({ score: 55, rank: 1, commentCount: 20 })],
			[snapshot({ score: 85, rank: 1 })],
			WINDOW
		);

		const drop = result.alerts.find((a) => a.rule === 'score-drop');
		expect(drop?.severity).toBe('info');
		expect(drop?.body).toContain('85');
		expect(drop?.body).toContain('55');
	});
});

describe('diffTopicPriorities — score-jump', () => {
	it('fires on a large rise and reports it as a warning', () => {
		const result = diffTopicPriorities(
			[priority({ score: 70, rank: 1 })],
			[snapshot({ score: 45, rank: 1 })],
			WINDOW
		);

		const jump = result.alerts.find((a) => a.rule === 'score-jump');
		expect(jump?.severity).toBe('warning');
		// Direction lives in the title; the body states the move neutrally.
		expect(jump?.title).toContain('rose');
		expect(jump?.body).toContain('45 → 70');
	});

	it('fires on a large fall and reports it as info', () => {
		const result = diffTopicPriorities(
			[priority({ score: 40, rank: 1 })],
			[snapshot({ score: 70, rank: 1 })],
			WINDOW
		);

		const jump = result.alerts.find((a) => a.rule === 'score-jump');
		expect(jump?.severity).toBe('info');
		// Direction lives in the title; the body states the move neutrally.
		expect(jump?.title).toContain('fell');
		expect(jump?.body).toContain('70 → 40');
	});

	it('does not fire below the jump threshold', () => {
		const result = diffTopicPriorities(
			[priority({ score: 60, rank: 1 })],
			[snapshot({ score: 45, rank: 1 })],
			WINDOW
		);

		expect(rulesFor(result.alerts)).not.toContain('score-jump');
	});
});

describe('diffTopicPriorities — new-leader', () => {
	it('fires when a different topic takes rank 1', () => {
		const result = diffTopicPriorities(
			[
				priority({ topic: 'Healthcare', score: 50, rank: 1 }),
				priority({ topic: 'Infrastructure', displayName: 'Road Repair', score: 45, rank: 2 })
			],
			[
				snapshot({ topic: 'Healthcare', score: 50, rank: 2 }),
				snapshot({ topic: 'Infrastructure', score: 60, rank: 1 })
			],
			WINDOW
		);

		const leader = result.alerts.find((a) => a.rule === 'new-leader');
		expect(leader?.severity).toBe('info');
		expect(leader?.topic).toBe('Healthcare');
		expect(leader?.title).toContain('Health Services');
	});

	it('does not fire when the leader is unchanged', () => {
		// Rank 1 staying rank 1 is not news.
		const result = diffTopicPriorities(
			[priority({ topic: 'Healthcare', score: 55, rank: 1 })],
			[snapshot({ topic: 'Healthcare', score: 50, rank: 1 })],
			WINDOW
		);

		expect(rulesFor(result.alerts)).not.toContain('new-leader');
	});
});

describe('diffTopicPriorities — negativity-spike', () => {
	it('fires when negativity is high and the sample is large enough', () => {
		const result = diffTopicPriorities(
			[priority({ negativityComponent: 0.65, commentCount: 20, score: 50, rank: 1 })],
			[snapshot({ negativity: 0.2, score: 50, rank: 1 })],
			WINDOW
		);

		const spike = result.alerts.find((a) => a.rule === 'negativity-spike');
		expect(spike?.severity).toBe('warning');
		expect(spike?.body).toContain('65%');
	});

	it('does not fire below MIN_SUPPORT', () => {
		// 2 of 2 negative is a 100% rate but not a signal.
		const result = diffTopicPriorities(
			[priority({ negativityComponent: 1, commentCount: 2, score: 50, rank: 1 })],
			[snapshot({ negativity: 0, commentCount: 2, score: 50, rank: 1 })],
			WINDOW
		);

		expect(rulesFor(result.alerts)).not.toContain('negativity-spike');
	});

	it('does not fire when negativity is moderate', () => {
		const result = diffTopicPriorities(
			[priority({ negativityComponent: 0.4, commentCount: 20, score: 50, rank: 1 })],
			[snapshot({ score: 50, rank: 1 })],
			WINDOW
		);

		expect(rulesFor(result.alerts)).not.toContain('negativity-spike');
	});
});

describe('diffTopicPriorities — fingerprints', () => {
	it('scopes the fingerprint to the window so 7d and 30d alerts coexist', () => {
		const current = [priority({ score: 75, rank: 1, commentCount: 20 })];
		const previous = [snapshot({ score: 60, rank: 1 })];

		const thirty = diffTopicPriorities(current, previous, 30);
		const seven = diffTopicPriorities(current, previous, 7);

		expect(seven.alerts[0].fingerprint).not.toBe(thirty.alerts[0].fingerprint);
		expect(seven.alerts[0].fingerprint).toContain(':7:');
	});

	it('produces a stable fingerprint across identical polls', () => {
		const current = [priority({ score: 75, rank: 1, commentCount: 20 })];
		const previous = [snapshot({ score: 60, rank: 1 })];

		const first = diffTopicPriorities(current, previous, WINDOW);
		// Second poll: the baseline has advanced, so it goes quiet — but the
		// fingerprint the first poll produced is what the DB dedupes on.
		const second = diffTopicPriorities(current, first.nextSnapshots, WINDOW);

		expect(first.alerts[0].fingerprint).toBe('trend:Healthcare:30:score-high');
		expect(second.alerts).toEqual([]);
	});

	it('can emit several rules for one topic in a single poll', () => {
		// A topic that both spikes and jumps crossed is genuinely two facts.
		const result = diffTopicPriorities(
			[
				priority({
					score: 85,
					rank: 1,
					commentCount: 30,
					negativityComponent: 0.7
				})
			],
			[snapshot({ score: 55, rank: 2, negativity: 0.2, commentCount: 30 })],
			WINDOW
		);

		expect(rulesFor(result.alerts)).toEqual(
			expect.arrayContaining(['new-leader', 'score-high', 'score-jump', 'negativity-spike'])
		);
	});
});

describe('diffTopicPriorities — display names', () => {
	it('uses the human topic label in copy', () => {
		const result = diffTopicPriorities(
			[
				priority({
					topic: 'Infrastructure',
					displayName: 'Road Repair',
					score: 75,
					rank: 1,
					commentCount: 20
				})
			],
			[snapshot({ topic: 'Infrastructure', score: 60, rank: 1 })],
			WINDOW
		);

		expect(result.alerts[0].title).toContain('Road Repair');
	});

	it('falls back to the raw topic for an unmapped label', () => {
		const result = diffTopicPriorities(
			[
				priority({
					topic: 'Brand New Topic',
					displayName: 'Brand New Topic',
					score: 75,
					rank: 1,
					commentCount: 20
				})
			],
			[snapshot({ topic: 'Brand New Topic', score: 60, rank: 1 })],
			WINDOW
		);

		expect(result.alerts[0].title).toContain('Brand New Topic');
	});
});
