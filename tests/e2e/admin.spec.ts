import { test, expect, goto } from './fixtures';

test.describe('admin page access', () => {
	test.describe('admin user', () => {
		test.use({ storageState: 'tests/e2e/.auth/admin.json' });

		test('admin sees NLP Engine Configuration and Authorized Personnel', async ({ page }) => {
			await goto(page, '/Authenticated/admin');
			await expect(page.getByText('NLP Engine Configuration')).toBeVisible({
				timeout: 10_000
			});
			await expect(page.getByText('Authorized Personnel')).toBeVisible({
				timeout: 10_000
			});
		});
	});

	test.describe('analyst user', () => {
		test.use({ storageState: 'tests/e2e/.auth/analyst.json' });

		test('analyst is redirected to the dashboard', async ({ page }) => {
			await goto(page, '/Authenticated/admin');
			await page.waitForURL('**/Authenticated/dashboard', { timeout: 10_000 });
			expect(page.url()).toContain('/Authenticated/dashboard');
		});
	});
});
