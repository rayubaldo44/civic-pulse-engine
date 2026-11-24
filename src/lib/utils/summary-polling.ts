import { summaryDelay, SUMMARY_TTL_MS } from './summary-freshness';

/** One visibility-aware timer, including while a request is awaiting a response. */
export function startSummaryPolling(
	getFetchedAt: () => number,
	refresh: () => Promise<unknown>,
	intervalMs = SUMMARY_TTL_MS
): () => void {
	let timer: ReturnType<typeof setTimeout>;
	let stopped = false;
	let running = false;
	const schedule = () => {
		clearTimeout(timer);
		if (!stopped)
			timer = setTimeout(tick, Math.max(5_000, Math.min(intervalMs, summaryDelay(getFetchedAt()))));
	};
	const tick = async () => {
		if (stopped || running) return;
		clearTimeout(timer);
		running = true;
		try {
			if (document.visibilityState === 'visible' && summaryDelay(getFetchedAt()) === 0)
				await refresh();
		} catch {
			// Keep readable data; retry on the next tick rather than rejecting a timer callback.
		} finally {
			running = false;
			schedule();
		}
	};
	const onVisible = () => {
		if (document.visibilityState === 'visible') void tick();
	};
	document.addEventListener('visibilitychange', onVisible);
	schedule();
	return () => {
		stopped = true;
		clearTimeout(timer);
		document.removeEventListener('visibilitychange', onVisible);
	};
}
