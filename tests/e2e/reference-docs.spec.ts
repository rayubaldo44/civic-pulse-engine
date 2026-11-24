import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { test, expect, goto } from './fixtures';
import { getLocalSupabase } from '../shared/supabase-env';

const local = getLocalSupabase();
if (!['127.0.0.1', 'localhost'].includes(new URL(local.url).hostname))
	throw new Error('Local fixtures only');
const service = createClient(local.url, local.serviceRoleKey);
const marker = `document-browser-${randomUUID()}`;
const content = `Lazy document content ${randomUUID()}`;
const ids = Array.from({ length: 130 }, () => randomUUID());
const title = (i: number) => `${marker} ${String(i).padStart(3, '0')}`;
test.use({ storageState: 'tests/e2e/.auth/analyst.json' });
test.beforeAll(async () => {
	const { error } = await service.from('lgu_documents').insert(
		ids.map((id, i) => ({
			id,
			title: title(i),
			document_type: i === 129 ? 'Infrastructure Report' : 'Advisory',
			content,
			uploaded_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
			is_active: true
		}))
	);
	if (error) throw error;
});
test.afterAll(async () => {
	await service.from('lgu_documents').delete().in('id', ids);
});

test('paginates metadata and fetches full content only when opening a document', async ({
	page
}) => {
	let detailReads = 0;
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.startsWith('/api/reference-docs/')) detailReads++;
	});
	const response = await page.goto(`/Authenticated/reference-docs?q=${marker}`);
	await page.waitForFunction(() => document.documentElement.dataset.sveltekitHydrated === 'true');
	await expect(page.locator('h4').filter({ hasText: marker })).toHaveCount(25);
	expect(await response!.text()).not.toContain(content);
	expect(detailReads).toBe(0);
	await goto(page, `/Authenticated/reference-docs?q=${marker}&page=6`);
	await expect(page.locator('h4').filter({ hasText: marker })).toHaveCount(5);
	await page.getByLabel('Search document titles or types').fill(title(0));
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(page.locator('h4').filter({ hasText: marker })).toHaveCount(1);
	await expect(page.getByRole('navigation', { name: 'Pagination' })).toContainText('of 1');
	await page
		.getByRole('button')
		.filter({ has: page.getByRole('heading', { name: title(0), exact: true }) })
		.click();
	await expect(page.getByRole('dialog').getByLabel('Content / Summary')).toHaveValue(content);
	expect(detailReads).toBe(1);
});
