import { test, expect, goto } from './fixtures';

test.use({ storageState: 'tests/e2e/.auth/analyst.json' });

const ISSUE_TITLE = 'Dirty road along Poblacion';

test.describe('Issue Tracker', () => {
	test.beforeEach(async ({ page }) => {
		await goto(page, '/Authenticated/issues');
		await expect(page.getByRole('heading', { name: 'Issue Tracker' })).toBeVisible({
			timeout: 10_000
		});
	});

	test('board renders 5 columns with issue cards', async ({ page }) => {
		// Five kanban columns: Open, In Progress, Under Review, Resolved, Closed
		const columns = page.locator('.grid-cols-5 > div');
		await expect(columns).toHaveCount(5, { timeout: 10_000 });

		// Our seeded "Open" issue should appear in the first column.
		await expect(page.getByRole('button', { name: ISSUE_TITLE })).toBeVisible({
			timeout: 10_000
		});
	});

	test('toggle to table view', async ({ page }) => {
		await page.getByRole('button', { name: 'Table' }).click();
		// IssueTable renders a <table> element.
		await expect(page.locator('table')).toBeVisible({ timeout: 10_000 });
	});

	test('click card opens slide-over and transition status', async ({ page }) => {
		await page.getByRole('button', { name: ISSUE_TITLE }).click();

		const slideTitle = page.getByRole('heading', { name: ISSUE_TITLE });
		await expect(slideTitle).toBeVisible({ timeout: 10_000 });

		// Status is currently "Open" — transition to "In Progress".
		await page.locator('#slide-status').selectOption('In Progress');
		await page.waitForResponse(
			(res) => res.url().includes('/api/issues/') && res.request().method() === 'PATCH'
		);

		// The status history should now show the transition.
		await expect(page.getByText('Open').nth(0)).toBeVisible({ timeout: 5_000 });
		await expect(page.getByText('In Progress').first()).toBeVisible({ timeout: 5_000 });
	});

	test('post a comment in the slide-over', async ({ page }) => {
		await page.getByRole('button', { name: ISSUE_TITLE }).click();
		await expect(page.getByRole('heading', { name: ISSUE_TITLE })).toBeVisible({
			timeout: 10_000
		});

		const textarea = page.getByPlaceholder('Add an internal comment…');
		await textarea.fill('Integration note: verified by e2e.');
		await page.getByRole('button', { name: 'Post Comment' }).click();

		// Optimistic UI appends the comment immediately.
		await expect(page.getByText('Integration note: verified by e2e.')).toBeVisible({
			timeout: 5_000
		});
	});

	test('Escape key closes slide-over', async ({ page }) => {
		await page.getByRole('button', { name: ISSUE_TITLE }).click();
		await expect(page.getByRole('heading', { name: ISSUE_TITLE })).toBeVisible({
			timeout: 10_000
		});

		await page.keyboard.press('Escape');
		await expect(page.getByRole('heading', { name: ISSUE_TITLE })).not.toBeVisible({
			timeout: 5_000
		});
	});
});
