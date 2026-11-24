import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { test, expect, goto } from './fixtures';
import { getLocalSupabase } from '../shared/supabase-env';

const local = getLocalSupabase();
const service = createClient(local.url, local.serviceRoleKey);
const marker = `browser-claims-${randomUUID()}`;
const ids = Array.from({ length: 130 }, () => randomUUID());
const text = (index: number) => `${marker} claim ${String(index).padStart(3, '0')}`;

test.use({ storageState: 'tests/e2e/.auth/analyst.json' });
test.describe('Claims pagination', () => {
	test.describe.configure({ mode: 'serial' });
	test.beforeAll(async () => {
		const { data: profiles, error: profileError } = await service
			.from('profiles')
			.select('id')
			.limit(1);
		if (profileError || !profiles?.[0]) throw new Error('A seeded staff profile is required');
		const { error } = await service.from('flagged_claims').insert(
			ids.map((id, i) => ({
				id,
				claim_text: text(i),
				status: i < 100 ? 'Pending' : 'Verified True',
				created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
			}))
		);
		if (error) throw error;
		const { error: reviewError } = await service.from('review_records').insert(
			ids.slice(100).map((id, i) => ({
				id: randomUUID(),
				flagged_claim_id: id,
				reviewed_by: profiles[0].id,
				decision: i === 29 ? 'Inconclusive' : 'Verified True',
				reviewed_at: '2026-02-02T00:00:00Z'
			}))
		);
		if (reviewError) throw reviewError;
	});
	test.afterAll(async () => {
		await service.from('review_records').delete().in('flagged_claim_id', ids);
		await service.from('flagged_claims').delete().in('id', ids);
	});
	test('loads only 25 claims and navigates the whole pending-first queue', async ({ page }) => {
		await goto(page, `/Authenticated/flagged-claims?q=${encodeURIComponent(marker)}`);
		await expect(page.getByText('100 Pending Review')).toBeVisible();
		await expect(page.locator('div.card').filter({ hasText: marker })).toHaveCount(25);
		await expect(page.getByText(`"${text(99)}"`, { exact: true })).toBeVisible();
		await page.getByRole('link', { name: 'Next', exact: true }).first().click();
		await expect(page).toHaveURL(/page=2/);
		await expect(page.getByText(`"${text(74)}"`, { exact: true })).toBeVisible();
		await expect(page.getByText(`"${text(99)}"`, { exact: true })).toHaveCount(0);
		await goto(page, `/Authenticated/flagged-claims?q=${encodeURIComponent(marker)}&page=6`);
		await expect(page.locator('div.card').filter({ hasText: marker })).toHaveCount(5);
	});
	test('searches the whole verified archive using the latest review decision', async ({ page }) => {
		await goto(page, `/Authenticated/verified-claims?q=${encodeURIComponent(marker)}`);
		await expect(page.getByText('29 True', { exact: true })).toBeVisible();
		await expect(page.locator('div.card').filter({ hasText: marker })).toHaveCount(25);
		await page.getByLabel('Status:').selectOption('Inconclusive');
		await page.getByRole('button', { name: 'Search', exact: true }).click();
		await expect(page.locator('div.card').filter({ hasText: marker })).toHaveCount(1);
		await expect(page.getByText(`"${text(129)}"`, { exact: true })).toBeVisible();
	});
});
