import { test, expect, goto } from './fixtures';
import { TEST_ADMIN, TEST_ANALYST, TEST_LOGOUT } from '../shared/supabase-env';

test.describe('Authentication', () => {
	test.describe('unauthenticated', () => {
		test('redirects to /login when visiting a protected page', async ({ page }) => {
			await goto(page, '/Authenticated/dashboard');
			await page.waitForURL('**/login');
			expect(page.url()).toContain('/login');
		});
	});

	test.describe('admin', () => {
		test.use({ storageState: 'tests/e2e/.auth/admin.json' });

		test('dashboard loads after login', async ({ page }) => {
			await goto(page, '/Authenticated/dashboard');
			await expect(page.getByRole('heading', { name: 'Intelligence Overview' })).toBeVisible({
				timeout: 10_000
			});
		});

		test('admin can access /Authenticated/admin', async ({ page }) => {
			await goto(page, '/Authenticated/admin');
			await expect(page.getByText('NLP Engine Configuration')).toBeVisible({
				timeout: 10_000
			});
		});
	});

	test.describe('analyst', () => {
		test.use({ storageState: 'tests/e2e/.auth/analyst.json' });

		test('dashboard loads after login', async ({ page }) => {
			await goto(page, '/Authenticated/dashboard');
			await expect(page.getByRole('heading', { name: 'Intelligence Overview' })).toBeVisible({
				timeout: 10_000
			});
		});

		test('admin config bounces to dashboard', async ({ page }) => {
			await goto(page, '/Authenticated/admin');
			await page.waitForURL('**/Authenticated/dashboard', { timeout: 10_000 });
			expect(page.url()).toContain('/Authenticated/dashboard');
		});
	});

	test.describe('bad credentials', () => {
		test.use({ storageState: { cookies: [], origins: [] } });

		test('shows generic error for wrong password', async ({ page }) => {
			await goto(page, '/login');
			await page.getByLabel('Official Email').fill(TEST_ADMIN.email);
			await page.getByLabel('Password').fill('wrong-password');
			await page.getByRole('button', { name: 'Sign In to Engine' }).click();
			await expect(
				page.getByText("We couldn't sign you in. Check your email and password, then try again.")
			).toBeVisible({
				timeout: 10_000
			});
		});
	});

	test.describe('logged-in user visiting /login', () => {
		test.use({ storageState: 'tests/e2e/.auth/analyst.json' });

		test('bounces to dashboard', async ({ page }) => {
			await goto(page, '/login');
			await page.waitForURL('**/Authenticated/dashboard', { timeout: 10_000 });
			expect(page.url()).toContain('/Authenticated/dashboard');
		});
	});

	test.describe('logout', () => {
		// Uses a fresh, disposable session (UI log-in as the dedicated logout
		// account) instead of the shared admin.json storageState so logging out
		// doesn't revoke the refresh token that other admin tests borrow from the
		// same file. The account is seeded in global-setup.
		test.use({ storageState: { cookies: [], origins: [] } });

		test('signs out and redirects to login', async ({ page }) => {
			await goto(page, '/login');
			await page.getByLabel('Official Email').fill(TEST_LOGOUT.email);
			await page.getByLabel('Password').fill(TEST_LOGOUT.password);
			await page.getByRole('button', { name: 'Sign In to Engine' }).click();
			await page.waitForURL('**/Authenticated/**', { timeout: 10_000 });

			await page.getByTitle('Log out').click();
			await page.waitForURL('**/login', { timeout: 10_000 });
			expect(page.url()).toContain('/login');
		});
	});
});
