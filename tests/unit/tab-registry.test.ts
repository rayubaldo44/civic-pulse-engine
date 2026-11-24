import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTabRegistry, TAB_TTL_MS } from '../../src/lib/tab-registry';

/** Minimal in-memory Storage. Iterating in insertion order matches real behaviour. */
function fakeStorage(): Storage {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		key: (i: number) => Array.from(map.keys())[i] ?? null,
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k),
		clear: () => map.clear()
	} as Storage;
}

describe('tab-registry', () => {
	let storage: Storage;
	// Re-spy every test: mockRestore in afterEach detaches the spy, and
	// mockReturnValue on a detached spy no longer affects Date.now.
	let now: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		storage = fakeStorage();
		now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
	});

	afterEach(() => {
		now.mockRestore();
		vi.useRealTimers();
	});

	it('reports the only tab as the last one', () => {
		const tab = createTabRegistry(storage);
		tab.join();
		expect(tab.leave()).toBe(true);
	});

	it('does not report a close as the last tab while a sibling is live', () => {
		const a = createTabRegistry(storage);
		const b = createTabRegistry(storage);
		a.join();
		b.join();

		expect(a.leave()).toBe(false);
		expect(storage.getItem('cp-tab-missing')).toBeNull();
	});

	it('reports the last tab once the siblings have left', () => {
		const a = createTabRegistry(storage);
		const b = createTabRegistry(storage);
		a.join();
		b.join();

		expect(a.leave()).toBe(false);
		expect(b.leave()).toBe(true);
	});

	it('ignores a sibling whose heartbeat has gone stale', () => {
		const a = createTabRegistry(storage);
		const b = createTabRegistry(storage);
		a.join();
		b.join();

		// Simulate tab b being killed outright: browser crash, force-quit, or
		// OS shutdown. It never gets to remove its own key.
		now.mockReturnValue(1_000_000 + TAB_TTL_MS + 1);

		expect(a.leave()).toBe(true);
	});

	it('sweeps stale keys on join so they cannot accumulate', () => {
		const dead = createTabRegistry(storage);
		dead.join();

		now.mockReturnValue(1_000_000 + TAB_TTL_MS + 1);
		const live = createTabRegistry(storage);
		live.join();

		const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
		expect(keys.filter((k) => k?.startsWith('cp-tab-'))).toHaveLength(1);
	});

	it('ignores malformed stamps rather than counting them as live tabs', () => {
		storage.setItem('cp-tab-garbage', 'not-a-number');

		const tab = createTabRegistry(storage);
		tab.join();
		expect(tab.leave()).toBe(true);
	});

	it('leaves non-app keys in storage untouched', () => {
		storage.setItem('theme', 'dark');
		const tab = createTabRegistry(storage);
		tab.join();
		tab.leave();

		expect(storage.getItem('theme')).toBe('dark');
	});

	it('stops heartbeating and clears its key when the returned stop fn runs', () => {
		vi.useFakeTimers();
		const tab = createTabRegistry(storage);
		const stop = tab.join();

		now.mockReturnValue(1_000_500);
		vi.advanceTimersByTime(4_000);
		stop();

		const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
		expect(keys.filter((k) => k?.startsWith('cp-tab-'))).toHaveLength(0);
	});
});
