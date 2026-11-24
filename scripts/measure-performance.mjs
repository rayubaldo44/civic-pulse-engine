import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** @typedef {import('@playwright/test').Browser} Browser */
/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').CDPSession} CDPSession */
/** @typedef {import('@playwright/test').BrowserContext} BrowserContext */
/** @typedef {Awaited<ReturnType<BrowserContext['storageState']>>} StorageState */
/** @typedef {{context: BrowserContext, page: Page, cdp: CDPSession}} Harness */
/** @typedef {{profile: string, role: string, run: number, route: string, mode: string}} SampleInfo */
/** @typedef {SampleInfo & {status: string, failure?: string, firstContentMs?: number|null, usableMs?: number|null, requests?: number, documentRequests?: number, transferBytes?: number, httpErrors?: number, inFlightAtUsable?: number, serverTiming?: Record<string, number>}} Sample */
/** @typedef {{status: number, headers: Record<string, string|number>, encodedDataLength?: number}} NetworkResponse */
/** @typedef {ReturnType<typeof readConfig>} Config */

/** @type {Record<string, string>} */
const ROUTES = {
	dashboard: 'Intelligence Overview',
	'live-data-stream': 'Live Data Stream',
	'flagged-claims': 'Flagged Claims Review',
	'verified-claims': 'Verified Claims',
	'reference-docs': 'Reference Documents',
	issues: 'Issue Tracker',
	reports: 'Reports & Audit Log',
	notifications: 'Notifications',
	settings: 'Settings',
	admin: 'System Administration'
};
const TIMINGS = new Set([
	'auth',
	'resolve',
	'request',
	'supabase_auth',
	'supabase_db',
	'sidebar_db',
	'unread_db',
	'login_auth',
	'login_audit',
	'claims_db',
	'issues_db',
	'documents_db',
	'settings_db',
	'admin_db',
	'login_role_db'
]);

/** @param {Record<string, string|undefined>} [env] */
export function readConfig(env = process.env) {
	let base;
	try {
		base = new URL(env.BASE_URL || 'http://127.0.0.1:4173');
	} catch {
		throw new Error('invalid-base-url');
	}
	if (
		base.username ||
		base.password ||
		base.search ||
		base.hash ||
		base.pathname !== '/' ||
		!['http:', 'https:'].includes(base.protocol)
	)
		throw new Error('invalid-base-url');
	const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
	if (!local && env.PERF_ALLOW_HOSTED !== '1') throw new Error('hosted-opt-in-required');
	if (!local && base.protocol !== 'https:') throw new Error('hosted-https-required');
	const runs = Number(env.PERF_RUNS || 5);
	const timeout = Number(env.PERF_TIMEOUT_MS || 30_000);
	if (!Number.isInteger(runs) || runs < 1 || runs > 50) throw new Error('invalid-run-count');
	if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120_000)
		throw new Error('invalid-timeout');
	const profiles = (env.PERF_PROFILES || 'desktop,mobile').split(',');
	const routes = (env.PERF_ROUTES || Object.keys(ROUTES).join(',')).split(',');
	if (profiles.some((p) => !['desktop', 'mobile'].includes(p))) throw new Error('invalid-profiles');
	if (routes.some((route) => !Object.hasOwn(ROUTES, route))) throw new Error('invalid-routes');
	return {
		baseURL: base.origin,
		local,
		runs,
		timeout,
		profiles: [...new Set(profiles)],
		routes: [...new Set(routes)],
		output: env.PERF_OUTPUT || `/tmp/civic-performance-${Date.now()}.json`
	};
}

export function parseServerTiming(header = '') {
	/** @type {Record<string, number>} */
	const durations = {};
	for (const item of header.split(',')) {
		const name = item.split(';')[0].trim();
		const match = /(?:^|;)\s*dur=([\d.]+)(?:;|$)/.exec(item);
		const value = match ? Number(match[1]) : NaN;
		if (TIMINGS.has(name) && Number.isFinite(value) && value >= 0)
			durations[name] = (durations[name] || 0) + value;
	}
	return durations;
}

/** @param {(number|null|undefined)[]} values */
function distribution(values) {
	const sorted = values
		.flatMap((value) => (typeof value === 'number' && Number.isFinite(value) ? [value] : []))
		.sort((a, b) => a - b);
	if (!sorted.length) return { median: null, p95: null };
	const middle = Math.floor(sorted.length / 2);
	return {
		median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
		p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]
	};
}

/** @param {Sample[]} rows */
export function summarize(rows) {
	/** @type {Map<string, Sample[]>} */
	const groups = new Map();
	for (const row of rows) {
		const key = [row.role, row.profile, row.route, row.mode].join('|');
		const group = groups.get(key) || [];
		group.push(row);
		groups.set(key, group);
	}
	return [...groups.values()].map((group) => {
		const { role, profile, route, mode } = group[0];
		const ok = group.filter((row) => row.status === 'ok');
		return {
			role,
			profile,
			route,
			mode,
			samples: group.length,
			successes: ok.length,
			failures: group.length - ok.length,
			firstContentMs: distribution(ok.map((row) => row.firstContentMs)),
			usableMs: distribution(ok.map((row) => row.usableMs)),
			requests: distribution(ok.map((row) => row.requests)),
			transferBytes: distribution(ok.map((row) => row.transferBytes)),
			serverTiming: Object.fromEntries(
				[...TIMINGS]
					.filter((name) => ok.some((row) => name in (row.serverTiming || {})))
					.map((name) => [name, distribution(ok.map((row) => row.serverTiming?.[name]))])
			)
		};
	});
}

/**
 * @param {Browser} browser
 * @param {Config} config
 * @param {string} profile
 * @param {StorageState} [storageState]
 * @returns {Promise<Harness>}
 */
async function createPage(browser, config, profile, storageState) {
	const mobile = profile === 'mobile';
	const context = await browser.newContext({
		viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
		isMobile: mobile,
		hasTouch: mobile,
		...(storageState ? { storageState } : {})
	});
	// The app signs out when its last tab closes. Closing a measurement context
	// must not revoke the in-memory session used by subsequent samples.
	await context.addInitScript(() => {
		const sendBeacon = navigator.sendBeacon.bind(navigator);
		navigator.sendBeacon = (url, data) => {
			if (new URL(String(url), location.href).pathname === '/api/logout-beacon') return true;
			return sendBeacon(url, data);
		};
	});
	const page = await context.newPage();
	page.setDefaultTimeout(config.timeout);
	const cdp = await context.newCDPSession(page);
	await cdp.send('Network.enable');
	if (mobile) {
		await cdp.send('Network.emulateNetworkConditions', {
			offline: false,
			latency: 150,
			downloadThroughput: 1_600_000 / 8,
			uploadThroughput: 750_000 / 8
		});
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	}
	return { context, page, cdp };
}

/** @param {CDPSession} cdp */
function captureNetwork(cdp) {
	/** @type {Set<string>} */
	const pending = new Set();
	/** @type {Record<string, number>} */
	const serverTiming = {};
	const totals = {
		requests: 0,
		documentRequests: 0,
		transferBytes: 0,
		httpErrors: 0,
		serverTiming
	};
	/** @param {NetworkResponse} response */
	const recordResponse = (response) => {
		if (response.status >= 400) totals.httpErrors++;
		const timing = Object.entries(response.headers).find(
			([name]) => name.toLowerCase() === 'server-timing'
		)?.[1];
		for (const [name, duration] of Object.entries(parseServerTiming(String(timing || ''))))
			totals.serverTiming[name] = (totals.serverTiming[name] || 0) + duration;
	};
	/** @param {{requestId: string, type?: string, redirectResponse?: NetworkResponse}} event */
	const started = (event) => {
		// CDP exposes redirect headers here rather than in responseReceived.
		// This includes auth/audit timings attached to the login's 303 response.
		if (event.redirectResponse && pending.has(event.requestId)) {
			recordResponse(event.redirectResponse);
			totals.transferBytes += event.redirectResponse.encodedDataLength || 0;
		}
		pending.add(event.requestId);
		totals.requests++;
		if (event.type === 'Document') totals.documentRequests++;
	};
	/** @param {{requestId: string, encodedDataLength: number}} event */
	const finished = (event) => {
		if (pending.delete(event.requestId)) totals.transferBytes += event.encodedDataLength || 0;
	};
	/** @param {{requestId: string}} event */
	const failed = (event) => {
		pending.delete(event.requestId);
	};
	/** @param {{requestId: string, response: NetworkResponse}} event */
	const response = (event) => {
		if (pending.has(event.requestId)) recordResponse(event.response);
	};
	cdp.on('Network.requestWillBeSent', started);
	cdp.on('Network.loadingFinished', finished);
	cdp.on('Network.loadingFailed', failed);
	cdp.on('Network.responseReceived', response);
	return () => {
		cdp.off('Network.requestWillBeSent', started);
		cdp.off('Network.loadingFinished', finished);
		cdp.off('Network.loadingFailed', failed);
		cdp.off('Network.responseReceived', response);
		return { ...totals, inFlightAtUsable: pending.size };
	};
}

/** @param {{route:string, role:string}} input */
export function pageReadiness({ route, role }) {
	const main = document.querySelector('main');
	if (!main) return false;
	const alerts = [...main.querySelectorAll('[role="alert"]')];
	// A flagged claim is valid feed content, not a page-load failure.
	if (
		route === 'live-data-stream'
			? alerts.some(
					(alert) =>
						alert.textContent?.trim() === 'Could not load the feed. It will retry automatically.'
				)
			: alerts.length > 0
	)
		return 'page-error';
	/** @param {string} selector */
	const has = (selector) => !!main.querySelector(selector);
	/** @param {string} text */
	const contains = (text) => main.textContent?.includes(text);
	switch (route) {
		case 'dashboard':
			return contains('Total Analyzed') &&
				!contains('Loading dashboard metrics') &&
				!contains('Loading charts') &&
				!contains('Loading sentiment breakdown')
				? 'ok'
				: false;
		case 'live-data-stream':
			return has('canvas') || contains('No sentiment data in this period') ? 'ok' : false;
		case 'flagged-claims':
		case 'verified-claims':
		case 'reference-docs':
			return has('nav[aria-label="Pagination"]') ? 'ok' : false;
		case 'issues':
			return has('#board-search') ? 'ok' : false;
		case 'reports':
			return role === 'admin' ? (has('tbody') ? 'ok' : false) : has('a[download]') ? 'ok' : false;
		case 'settings':
			return has('input[name="full_name"]') && has('button[type="submit"]') ? 'ok' : false;
		case 'notifications':
			return contains("Notifications aren't set up yet")
				? 'page-unavailable'
				: has('input[type="checkbox"]') &&
					  (has('li') || contains('No notifications match these filters'))
					? 'ok'
					: false;
		case 'admin':
			return has('tbody') && has('input[name="flagging_sensitivity"]') ? 'ok' : false;
		case 'login':
			return has('input[name="email"]') && has('input[name="password"]') ? 'ok' : false;
		default:
			return false;
	}
}

/** @param {Page} page @param {string} route @param {string} role */
async function waitForUsable(page, route, role) {
	await page.waitForLoadState('domcontentloaded');
	await page.waitForFunction(() => document.documentElement.dataset.sveltekitHydrated === 'true');
	const result = await page.waitForFunction(pageReadiness, { route, role });
	const status = await result.jsonValue();
	if (status !== 'ok') throw new Error(typeof status === 'string' ? status : 'page-error');
	// Allow the completed render to paint; this is distinct from shell visibility.
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
	);
}

/**
 * @param {Harness} harness
 * @param {SampleInfo} info
 * @param {() => Promise<unknown>} action
 * @param {string} [target]
 * @returns {Promise<Sample>}
 */
async function measure(harness, info, action, target = info.route) {
	const { page, cdp } = harness;
	const stop = captureNetwork(cdp);
	const started = performance.now();
	let firstContentMs = null;
	try {
		await action();
		if (target === 'login') await page.locator('input[name="email"]').waitFor({ state: 'visible' });
		else
			await page
				.getByRole('heading', { name: ROUTES[target], exact: true })
				.waitFor({ state: 'visible' });
		firstContentMs = Math.round(performance.now() - started);
		await waitForUsable(page, target, info.role);
		if (
			info.mode === 'client-navigation' &&
			new URL(page.url()).pathname !== `/Authenticated/${target}`
		)
			throw new Error('unexpected-redirect');
		const counters = stop();
		if (info.mode === 'client-navigation' && counters.documentRequests > 0)
			return {
				...info,
				status: 'failed',
				failure: 'full-document-navigation',
				firstContentMs,
				usableMs: null,
				...counters
			};
		return {
			...info,
			status: 'ok',
			firstContentMs,
			usableMs: Math.round(performance.now() - started),
			...counters
		};
	} catch (error) {
		const known = ['page-error', 'page-unavailable', 'unexpected-redirect'];
		return {
			...info,
			status: 'failed',
			failure:
				error instanceof Error && known.includes(error.message)
					? error.message
					: error instanceof Error && error.name === 'TimeoutError'
						? 'timeout'
						: 'navigation-failed',
			firstContentMs,
			usableMs: null,
			...stop()
		};
	}
}

/** @param {Harness} harness @param {Config} config @param {string} route @param {string} role */
async function navigateFromSidebar(harness, config, route, role) {
	const { page } = harness;
	const source = route === 'dashboard' ? 'reference-docs' : 'dashboard';
	await page.goto(`${config.baseURL}/Authenticated/${source}`, { waitUntil: 'commit' });
	await waitForUsable(page, source, role);
	const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true });
	if (await expand.isVisible()) await expand.click();
	if (route === 'notifications') {
		await page
			.locator('aside')
			.getByRole('button', { name: /^Notifications/i })
			.click();
		return page.getByRole('link', { name: 'View all notifications', exact: true });
	}
	return page.locator(`aside a[href="/Authenticated/${route}"]`).first();
}

async function main() {
	let config;
	try {
		config = readConfig();
	} catch (error) {
		process.stderr.write(
			`Performance benchmark: ${error instanceof Error ? error.message : 'invalid-configuration'}\n`
		);
		process.exitCode = 1;
		return;
	}
	const roles = ['analyst', 'admin'].filter(
		(role) =>
			process.env[`PERF_${role.toUpperCase()}_EMAIL`] &&
			process.env[`PERF_${role.toUpperCase()}_PASSWORD`]
	);
	if (!roles.length) {
		process.stderr.write(
			'Performance benchmark: credentials-required (PERF_ANALYST_EMAIL/PASSWORD or PERF_ADMIN_EMAIL/PASSWORD)\n'
		);
		process.exitCode = 1;
		return;
	}
	let browser;
	try {
		browser = await chromium.launch();
	} catch {
		process.stderr.write(
			'Performance benchmark: browser-unavailable; install Chromium with pnpm exec playwright install chromium\n'
		);
		process.exitCode = 1;
		return;
	}
	/** @type {Sample[]} */
	const rows = [];
	const skippedRoles = ['analyst', 'admin'].filter((role) => !roles.includes(role));
	try {
		for (const profile of config.profiles)
			for (const role of roles)
				for (let run = 1; run <= config.runs; run++) {
					const login = await createPage(browser, config, profile);
					let storageState;
					try {
						rows.push(
							await measure(
								login,
								{ profile, role, run, route: 'login', mode: 'login-page-cold-browser' },
								() => login.page.goto(`${config.baseURL}/login`, { waitUntil: 'commit' })
							)
						);
						rows.push(
							await measure(
								login,
								{ profile, role, run, route: 'login', mode: 'login-page-warm-browser' },
								() => login.page.reload({ waitUntil: 'commit' })
							)
						);
						await login.page
							.locator('input[name="email"]')
							.fill(process.env[`PERF_${role.toUpperCase()}_EMAIL`] || '');
						await login.page
							.locator('input[name="password"]')
							.fill(process.env[`PERF_${role.toUpperCase()}_PASSWORD`] || '');
						const landing = role === 'admin' ? 'admin' : 'dashboard';
						const result = await measure(
							login,
							{ profile, role, run, route: landing, mode: 'login-to-usable' },
							() => login.page.locator('button[type="submit"]').click({ noWaitAfter: true }),
							landing
						);
						rows.push(result);
						if (result.status === 'ok') storageState = await login.context.storageState();
					} catch {
						rows.push({
							profile,
							role,
							run,
							route: 'login',
							mode: 'login-setup',
							status: 'failed',
							failure: 'login-failed'
						});
					} finally {
						await login.context.close();
					}
					if (!storageState) continue;
					for (const route of config.routes.filter(
						(route) => role === 'admin' || route !== 'admin'
					)) {
						const harness = await createPage(browser, config, profile, storageState);
						try {
							for (const mode of ['direct-cold-browser', 'direct-warm-browser'])
								rows.push(
									await measure(harness, { profile, role, run, route, mode }, () =>
										harness.page.goto(`${config.baseURL}/Authenticated/${route}`, {
											waitUntil: 'commit'
										})
									)
								);
							const link = await navigateFromSidebar(harness, config, route, role);
							rows.push(
								await measure(
									harness,
									{ profile, role, run, route, mode: 'client-navigation' },
									() => link.click({ noWaitAfter: true })
								)
							);
						} catch {
							rows.push({
								profile,
								role,
								run,
								route,
								mode: 'client-navigation',
								status: 'failed',
								failure: 'navigation-setup-failed'
							});
						} finally {
							await harness.context.close();
						}
					}
				}
	} finally {
		await browser.close();
	}
	const result = {
		schemaVersion: 1,
		capturedAt: new Date().toISOString(),
		environment: config.local ? 'local' : 'hosted',
		runs: config.runs,
		skippedRoles,
		profiles: {
			desktop: { viewport: [1440, 1000], cpuSlowdown: 1, network: 'unthrottled' },
			mobile: {
				viewport: [390, 844],
				cpuSlowdown: 4,
				latencyMs: 150,
				downloadBitsPerSecond: 1600000,
				uploadBitsPerSecond: 750000
			}
		},
		notes: [
			'Cold browser means a fresh browser context, not a cold serverless instance.',
			'transferBytes counts completed CDP encoded bytes through usable; in-flight requests are reported separately.',
			'Server timing groups are cumulative across measured requests and can overlap; streamed DB work after response headers may not appear.',
			'Login-to-usable starts at submit after the login form has loaded. First content is heading visibility, not the browser FCP metric.',
			'Only route identifiers, numeric metrics, status codes, and fixed reason codes are recorded.'
		],
		summary: summarize(rows),
		samples: rows
	};
	await writeFile(config.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
	process.stdout.write(
		`Performance benchmark saved: ${config.output}\nSamples: ${rows.length}; failed: ${rows.filter((row) => row.status !== 'ok').length}; skipped roles: ${skippedRoles.join(', ') || 'none'}\n`
	);
	if (rows.some((row) => row.status !== 'ok')) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(() => {
		process.stderr.write(
			'Performance benchmark: setup-or-output-failed (details omitted to protect credentials)\n'
		);
		process.exitCode = 1;
	});
}
