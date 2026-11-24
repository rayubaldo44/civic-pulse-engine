import { describe, expect, it } from 'vitest';
import { readConfig, summarize, parseServerTiming } from '../../scripts/measure-performance.mjs';

describe('performance benchmark safety and statistics', () => {
	it('requires explicit opt-in for hosted requests and rejects credentials in the base URL', () => {
		expect(() =>
			readConfig({
				BASE_URL: 'https://example.test',
				PERF_ANALYST_EMAIL: 'test',
				PERF_ANALYST_PASSWORD: 'test'
			})
		).toThrow('hosted-opt-in-required');
		expect(() =>
			readConfig({ BASE_URL: 'https://user:secret@example.test', PERF_ALLOW_HOSTED: '1' })
		).toThrow('invalid-base-url');
	});
	it('defaults to five runs on localhost and allows only known profiles/routes', () => {
		const config = readConfig({ PERF_ANALYST_EMAIL: 'test', PERF_ANALYST_PASSWORD: 'test' });
		expect(config.runs).toBe(5);
		expect(config.baseURL).toBe('http://127.0.0.1:4173');
		expect(() => readConfig({ PERF_PROFILES: 'something' })).toThrow('invalid-profiles');
		expect(() => readConfig({ PERF_ROUTES: '../../secrets' })).toThrow('invalid-routes');
	});
	it('keeps only known numeric timing groups, never descriptions or arbitrary header names', () => {
		expect(
			parseServerTiming(
				'auth;dur=12.4;desc="private",supabase_db;dur=4, secret;dur=99,resolve;dur=NaN'
			)
		).toEqual({ auth: 12.4, supabase_db: 4 });
	});
	it('reports median and nearest-rank p95 without hiding failures', () => {
		const rows: Parameters<typeof summarize>[0] = [1, 2, 3, 4, 100].map((usableMs) => ({
			role: 'analyst',
			run: 1,
			profile: 'desktop',
			route: 'dashboard',
			mode: 'direct-cold-browser',
			status: 'ok',
			firstContentMs: usableMs,
			usableMs,
			requests: 1,
			transferBytes: 100,
			serverTiming: { auth: 2 }
		}));
		rows.push({ ...rows[0], status: 'failed', usableMs: null });
		const result = summarize(rows)[0];
		expect(result.samples).toBe(6);
		expect(result.successes).toBe(5);
		expect(result.failures).toBe(1);
		expect(result.usableMs).toEqual({ median: 3, p95: 100 });
	});
});

describe('benchmark readiness for a populated live feed', () => {
	it('accepts flagged-claim alerts but rejects a failed feed load', async () => {
		const { pageReadiness } = await import('../../scripts/measure-performance.mjs');
		document.body.innerHTML =
			'<main><div role="alert">Flagged claim — human review required</div><p>No sentiment data in this period</p></main>';
		expect(pageReadiness({ route: 'live-data-stream', role: 'analyst' })).toBe('ok');
		document.body.innerHTML =
			'<main><div role="alert">Could not load the feed. It will retry automatically.</div><canvas></canvas></main>';
		expect(pageReadiness({ route: 'live-data-stream', role: 'analyst' })).toBe('page-error');
		document.body.innerHTML = '';
	});
});
