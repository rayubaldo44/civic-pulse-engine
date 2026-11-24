import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSummaryPolling } from '$lib/utils/summary-polling';

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
describe('visible summary polling', () => {
	it('does not create extra polling loops when visibility changes during a request', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(100_000);
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
		let fetchedAt = 100_000;
		let release!: () => void;
		const refresh = vi.fn(async () => {
			await new Promise<void>((r) => {
				release = r;
			});
			fetchedAt = Date.now();
		});
		const stop = startSummaryPolling(() => fetchedAt, refresh);
		await vi.advanceTimersByTimeAsync(44_999);
		expect(refresh).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(refresh).toHaveBeenCalledTimes(1);
		for (let i = 0; i < 5; i++) document.dispatchEvent(new Event('visibilitychange'));
		release();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(45_000);
		expect(refresh).toHaveBeenCalledTimes(2);
		stop();
		release();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(vi.getTimerCount()).toBe(0);
	});
	it('does not fetch in hidden tabs and refreshes overdue data once visible', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(100_000);
		const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		let fetchedAt = 100_000;
		const refresh = vi.fn(async () => {
			fetchedAt = Date.now();
		});
		const stop = startSummaryPolling(() => fetchedAt, refresh);
		await vi.advanceTimersByTimeAsync(50_000);
		expect(refresh).not.toHaveBeenCalled();
		visible.mockReturnValue('visible');
		document.dispatchEvent(new Event('visibilitychange'));
		await Promise.resolve();
		await Promise.resolve();
		expect(refresh).toHaveBeenCalledTimes(1);
		stop();
	});
});
