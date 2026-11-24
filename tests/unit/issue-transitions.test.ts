import { describe, it, expect } from 'vitest';
import { ISSUE_TRANSITIONS, isValidTransition, type IssueStatus } from '$lib/types/issues';

const ALL: IssueStatus[] = ['Open', 'In Progress', 'Under Review', 'Resolved', 'Closed'];

describe('ISSUE_TRANSITIONS adjacency map', () => {
	it('defines an entry for every status', () => {
		for (const status of ALL) {
			const targets = ISSUE_TRANSITIONS[status];
			expect(targets, `missing entry for ${status}`).toBeDefined();
		}
		// Peer-review RPCs, not PATCH, own every transition out of Under Review.
		expect(ISSUE_TRANSITIONS['Under Review']).toEqual([]);
	});

	it('never allows a status to transition to itself via the map', () => {
		// Self-transitions are no-ops handled before validation in the API —
		// the map itself must not list them.
		for (const status of ALL) {
			expect(ISSUE_TRANSITIONS[status]).not.toContain(status);
		}
	});

	it('only references known statuses as targets', () => {
		for (const [from, targets] of Object.entries(ISSUE_TRANSITIONS)) {
			for (const to of targets) {
				expect(ALL, `${from} → ${to} is not a real status`).toContain(to);
				expect(to).not.toBe(from);
			}
		}
	});

	it('keeps every manually controlled status reachable', () => {
		const reachable = new Set<IssueStatus>(['Open']);
		let changed = true;
		while (changed) {
			changed = false;
			for (const [from, targets] of Object.entries(ISSUE_TRANSITIONS)) {
				if (reachable.has(from as IssueStatus)) {
					for (const to of targets) {
						if (!reachable.has(to)) {
							reachable.add(to);
							changed = true;
						}
					}
				}
			}
		}
		expect([...reachable].sort()).toEqual(['Closed', 'In Progress', 'Open']);
		expect(isValidTransition('In Progress', 'Under Review')).toBe(false);
		expect(isValidTransition('Under Review', 'Resolved')).toBe(false);
	});

	it('allows reopening from every state that lists Open as a target', () => {
		for (const [from, targets] of Object.entries(ISSUE_TRANSITIONS)) {
			if (!targets.includes('Open')) continue;
			expect(isValidTransition(from as IssueStatus, 'Open'), `${from} must be reopenable`).toBe(
				true
			);
		}
		// Under Review deliberately routes back through In Progress instead
		expect(isValidTransition('Under Review', 'Open')).toBe(false);
	});
});

describe('isValidTransition — legal edges', () => {
	for (const [from, targets] of Object.entries(ISSUE_TRANSITIONS)) {
		for (const to of targets) {
			it(`allows ${from} → ${to}`, () => {
				expect(isValidTransition(from as IssueStatus, to)).toBe(true);
			});
		}
	}
});

describe('isValidTransition — illegal edges', () => {
	for (const [from, targets] of Object.entries(ISSUE_TRANSITIONS)) {
		const illegal = ALL.filter((s) => s !== from && !targets.includes(s));
		for (const to of illegal) {
			it(`rejects ${from} → ${to}`, () => {
				expect(isValidTransition(from as IssueStatus, to)).toBe(false);
			});
		}

		it(`treats ${from} → ${from} as invalid at the map level`, () => {
			expect(isValidTransition(from as IssueStatus, from as IssueStatus)).toBe(false);
		});
	}
});

describe('isValidTransition — unknown inputs fail closed', () => {
	it('rejects unknown source statuses', () => {
		expect(isValidTransition('Bogus' as IssueStatus, 'Open')).toBe(false);
	});

	it('rejects unknown target statuses', () => {
		expect(isValidTransition('Open', 'Bogus' as IssueStatus)).toBe(false);
	});

	it('rejects unknown source and target together', () => {
		expect(isValidTransition('Nope' as IssueStatus, 'Also-nope' as IssueStatus)).toBe(false);
	});
});
