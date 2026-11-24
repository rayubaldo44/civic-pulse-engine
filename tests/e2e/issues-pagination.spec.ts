import { createClient } from '@supabase/supabase-js';
import { test, expect, goto } from './fixtures';
import { getLocalSupabase } from '../shared/supabase-env';

test.use({ storageState: 'tests/e2e/.auth/analyst.json' });
const local = getLocalSupabase();
const svc = createClient(local.url, local.serviceRoleKey, {
	auth: { persistSession: false, autoRefreshToken: false }
});
const prefix = 'E2E paged issue ';

test.beforeAll(async () => {
	const { error } = await svc.from('civic_issues').insert(
		Array.from({ length: 126 }, (_, index) => ({
			title: prefix + String(index).padStart(3, '0'),
			status: 'Open',
			priority: 'High',
			created_at: '2026-10-01T00:00:00Z'
		}))
	);
	if (error) throw error;
});
test.afterAll(async () => {
	await svc
		.from('civic_issues')
		.delete()
		.like('title', prefix + '%');
});

test('board has global counts and loads the next batch only on demand', async ({ page }) => {
	await goto(page, `/Authenticated/issues?q=${encodeURIComponent(prefix)}`);
	const open = page.locator('.grid-cols-5 > div').first();
	await expect(open.getByText('126', { exact: true })).toBeVisible();
	await expect(open.getByRole('button', { name: new RegExp(prefix) })).toHaveCount(25);
	await open.getByRole('button', { name: 'Load more Open issues' }).click();
	await expect(open.getByRole('button', { name: new RegExp(prefix) })).toHaveCount(50);
	const other = page.locator('.grid-cols-5 > div').nth(1);
	await expect(other.getByRole('button', { name: new RegExp(prefix) })).toHaveCount(0);
});

test('table paging, search beyond the first hundred, and history navigation stay synchronized', async ({
	page
}) => {
	await goto(
		page,
		`/Authenticated/issues?view=table&q=${encodeURIComponent(prefix)}&sort=title&direction=asc&page=5`
	);
	await expect(page.locator('tbody tr')).toHaveCount(25);
	await page.getByRole('link', { name: 'Next', exact: true }).click();
	await expect(page.locator('tbody tr')).toHaveCount(1);
	await expect(page.getByText(prefix + '125', { exact: true })).toBeVisible();
	const search = page.getByPlaceholder('Search by title…');
	await search.fill(prefix + '125');
	await expect(page).toHaveURL(/page=1/);
	await expect(page.locator('tbody tr')).toHaveCount(1);
	await page.goBack();
	await expect(page).toHaveURL(/page=6/);
	await expect(search).toHaveValue(prefix.trimEnd());
	await expect(page.getByText(prefix + '125', { exact: true })).toBeVisible();
});
