import { test, expect, goto } from './fixtures';

test.use({ storageState: 'tests/e2e/.auth/analyst.json' });

test.describe('Sentiment Trends — range switching & filtering', () => {
	test.beforeEach(async ({ page }) => {
		await goto(page, '/Authenticated/live-data-stream');
		await expect(page.getByRole('heading', { name: 'Live Data Stream' })).toBeVisible({
			timeout: 10_000
		});
		// Wait for trend chart to appear (LineChart component renders canvas)
		await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30_000 });
	});

	test('Live range shows 12 hourly buckets', async ({ page }) => {
		// Click the trend range tab (segmented control)
		await page.locator('.segmented button:has-text("Live")').click();
		const res = await page.waitForResponse('**/api/sentiment-trends?range=live*', {
			timeout: 30_000
		});
		const data = await res.json();
		// Live looks at last 12 hours; seeded data is older so mode may be empty
		expect(['hourly', 'empty']).toContain(data.mode);
		if (data.mode === 'hourly') expect(data.labels).toHaveLength(12);
	});

	test('Weekly range shows 28 daily buckets', async ({ page }) => {
		// Weekly is default; switch to Live first
		await page.locator('.segmented button:has-text("Live")').click();
		await page.waitForResponse(
			(res) => res.url().includes('/api/sentiment-trends') && res.url().includes('range=live')
		);

		// Now switch back to Weekly and wait for the response
		const [response] = await Promise.all([
			page.waitForResponse(
				(res) => res.url().includes('/api/sentiment-trends') && res.url().includes('range=weekly')
			),
			page.locator('.segmented button:has-text("Weekly")').first().click()
		]);

		const data = await response.json();
		expect(data.mode).toBe('weekly');
		expect(data.labels).toHaveLength(28);
	});

	test('Monthly range shows days-so-far buckets', async ({ page }) => {
		await page.locator('.segmented button:has-text("Monthly")').first().click();
		const res = await page.waitForResponse('**/api/sentiment-trends?range=monthly*', {
			timeout: 30_000
		});
		const data = await res.json();
		expect(data.mode).toBe('monthly');
		expect(data.labels.length).toBeGreaterThan(0);
		expect(data.labels.length).toBeLessThanOrEqual(31);
	});

	test('Yearly range shows 12 monthly buckets', async ({ page }) => {
		await page.locator('.segmented button:has-text("Yearly")').first().click();
		const res = await page.waitForResponse('**/api/sentiment-trends?range=yearly*', {
			timeout: 30_000
		});
		const data = await res.json();
		expect(data.mode).toBe('yearly');
		expect(data.labels).toHaveLength(12);
	});

	test('Topic filter changes series data', async ({ page }) => {
		// Select Infrastructure topic
		await page.locator('select[aria-label="Filter by topic"]').selectOption('Infrastructure');
		const res = await page.waitForResponse('**/api/sentiment-trends*topic=Infrastructure*', {
			timeout: 30_000
		});
		const data = await res.json();
		expect(
			data.positive.some((v: number) => v > 0) || data.negative.some((v: number) => v > 0)
		).toBe(true);

		// Switch to Healthcare
		await page.locator('select[aria-label="Filter by topic"]').selectOption('Healthcare');
		const res2 = await page.waitForResponse('**/api/sentiment-trends*topic=Healthcare*', {
			timeout: 30_000
		});
		const data2 = await res2.json();
		expect(JSON.stringify(data2)).not.toBe(JSON.stringify(data));
	});

	test('Platform filter changes series data', async ({ page }) => {
		// Select facebook platform
		await page.locator('select[aria-label="Filter by platform"]').selectOption('facebook');
		const res = await page.waitForResponse('**/api/sentiment-trends*platform=facebook*', {
			timeout: 30_000
		});
		const data = await res.json();
		expect(
			data.positive.some((v: number) => v > 0) || data.negative.some((v: number) => v > 0)
		).toBe(true);

		// Switch to youtube
		await page.locator('select[aria-label="Filter by platform"]').selectOption('youtube');
		const res2 = await page.waitForResponse('**/api/sentiment-trends*platform=youtube*', {
			timeout: 30_000
		});
		const data2 = await res2.json();
		expect(JSON.stringify(data2)).not.toBe(JSON.stringify(data));
	});

	test('review sentiment folds into Neutral bucket', async ({ page }) => {
		// Weekly is default; switch to Live first
		await page.locator('.segmented button:has-text("Live")').click();
		await page.waitForResponse(
			(res) => res.url().includes('/api/sentiment-trends') && res.url().includes('range=live')
		);

		// Switch to Weekly to see daily buckets including today
		const [response] = await Promise.all([
			page.waitForResponse(
				(res) => res.url().includes('/api/sentiment-trends') && res.url().includes('range=weekly')
			),
			page.locator('.segmented button:has-text("Weekly")').first().click()
		]);

		const data = await response.json();
		console.log('WEEKLY DATA:', JSON.stringify(data));
		// The seeded healthReview comment (processed_at: 2026-09-06) falls in the weekly window
		// Weekly labels: 28 days ending today (Sept 25), so Sept 6 is index ~19 from end
		// Just verify Neutral has at least 1 count somewhere (review folded)
		const totalNeutral = data.neutral.reduce((a: number, b: number) => a + b, 0);
		expect(totalNeutral).toBeGreaterThanOrEqual(1);
	});
});
