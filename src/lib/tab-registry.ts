// src/lib/tab-registry.ts
//
// Tracks how many tabs of this app are open, using localStorage heartbeats.
// Used to decide whether the tab that is closing is the *last* one — closing
// any single tab must not sign the user out of the others.
//
// Why localStorage and not BroadcastChannel:
//   BroadcastChannel messages are delivered asynchronously, and a closing tab
//   cannot await a reply — the page is being torn down. Heartbeat keys are
//   synchronously readable at pagehide time, which is exactly the constraint.
//
// Why heartbeats rather than a plain counter:
//   A tab that is killed outright (browser crash, force-quit, OS shutdown)
//   never gets to decrement anything, so a counter would drift upward and
//   suppress the logout beacon permanently. Stamped keys are self-healing:
//   stale entries are identified by age and ignored.

const KEY_PREFIX = 'cp-tab-';

/** Age after which a registered tab is presumed dead. */
export const TAB_TTL_MS = 10_000;

/** How often a live tab refreshes its stamp. Comfortably under the TTL. */
export const TAB_HEARTBEAT_MS = 4_000;

export interface TabRegistry {
	/** Register this tab and start heartbeating. Returns a stop function. */
	join(): () => void;
	/**
	 * Called as the tab goes away. Returns true when no other live tab
	 * remains, i.e. the caller should treat this as a full session end.
	 */
	leave(): boolean;
}

function randomId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	// Non-secure contexts have no randomUUID. A timestamp+counter is enough —
	// the id only has to be unique among concurrently open tabs of this browser.
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param storage localStorage, injected for tests.
 */
export function createTabRegistry(storage: Storage): TabRegistry {
	const key = `${KEY_PREFIX}${randomId()}`;

	const liveTabCount = (excludeSelf: boolean): number => {
		const now = Date.now();
		let count = 0;
		for (let i = 0; i < storage.length; i++) {
			const name = storage.key(i);
			if (name === null || !name.startsWith(KEY_PREFIX)) continue;
			if (excludeSelf && name === key) continue;
			const stamp = Number(storage.getItem(name));
			// NaN means a malformed or externally-written entry; ignore it
			// rather than letting it count as a live tab forever.
			if (!Number.isFinite(stamp)) continue;
			if (now - stamp > TAB_TTL_MS) continue;
			count++;
		}
		return count;
	};

	const beat = () => storage.setItem(key, String(Date.now()));

	/** Drop entries for tabs that stopped heartbeating (crash, force-quit). */
	const sweep = () => {
		const now = Date.now();
		const stale: string[] = [];
		for (let i = 0; i < storage.length; i++) {
			const name = storage.key(i);
			if (name === null || !name.startsWith(KEY_PREFIX)) continue;
			const stamp = Number(storage.getItem(name));
			if (!Number.isFinite(stamp) || now - stamp > TAB_TTL_MS) stale.push(name);
		}
		stale.forEach((name) => storage.removeItem(name));
	};

	return {
		join() {
			sweep();
			beat();
			const timer = setInterval(beat, TAB_HEARTBEAT_MS);
			return () => {
				clearInterval(timer);
				storage.removeItem(key);
			};
		},
		leave() {
			storage.removeItem(key);
			return liveTabCount(true) === 0;
		}
	};
}
