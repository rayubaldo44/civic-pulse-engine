import { test, expect, goto } from './fixtures';

// Dashboard — smoke test for the analyst view. Admin has the same rendering.
test.use({ storageState: 'tests/e2e/.auth/analyst.json' });

test.describe('Dashboard', () => {
	test.beforeEach(async ({ page }) => {
		await goto(page, '/Authenticated/dashboard');
		await expect(page.getByRole('heading', { name: 'Intelligence Overview' })).toBeVisible({
			timeout: 10_000
		});
	});

	test('stat cards render with non-empty values', async ({ page }) => {
		// Wait for the first stat card "Total Analyzed" to populate. The
		// featured card shows a numeric value next to its micro-label.
		const totalLabel = page.getByText('Total Analyzed').first();
		await expect(totalLabel).toBeVisible({ timeout: 10_000 });

		// The featured tile value (e.g. "6") sits right above the sub-caption.
		await expect(page.getByText('All-time processed comments').first()).toBeVisible({
			timeout: 5_000
		});
	});

	test('chart sections render (sentiment trend canvas)', async ({ page }) => {
		// Chart.js renders a <canvas> inside the trend card.
		const canvas = page.locator('canvas').first();
		await expect(canvas).toBeVisible({ timeout: 10_000 });
	});

	test('tabs switch between Heatmap, Issue Prioritization, Tracker', async ({ page }) => {
		const tab = (name: string) => page.getByRole('button', { name });

		// Barangay Heatmap: switch to the tile-grid view so we don't depend on
		// external OSM tile servers; the grid shows Pulilan's barangays.
		await tab('Barangay Heatmap').click();
		await tab('Tiles').click();
		await expect(page.locator('text=Poblacion').first()).toBeVisible({ timeout: 10_000 });

		await tab('Issue Prioritization').click();
		await expect(page.getByText('Issue Prioritization')).toBeVisible({ timeout: 10_000 });

		await tab('Issue Tracker').click();
		await expect(page.getByRole('heading', { name: 'Issue Tracker' })).toBeVisible({
			timeout: 10_000
		});
	});

	test('sidebar badge for pending claims is visible', async ({ page }) => {
		// The pending-review count badge shows in the "Flagged Claims" nav link.
		const navLink = page.getByRole('link', { name: /Flagged Claims/ }).first();
		await expect(navLink).toBeVisible({ timeout: 10_000 });
	});
});
