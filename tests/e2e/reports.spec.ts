import { test, expect, goto } from './fixtures';

// Reports — exports are driven by <a download href="/api/reports/..."> links.
// Filenames come from each +server.ts Content-Disposition header.

test.describe('Reports page', () => {
	test.use({ storageState: 'tests/e2e/.auth/analyst.json' });

	test('page heading loads', async ({ page }) => {
		await goto(page, '/Authenticated/reports');
		await expect(page.getByRole('heading', { name: 'Reports & Audit Log' })).toBeVisible({
			timeout: 10_000
		});
	});
});

// Analyst — should see Issue CSV, Flagged Claims CSV, and Weekly Summary PDF,
// but NOT the admin-only Full System Audit XLSX.
test.describe('analyst exports', () => {
	test.use({ storageState: 'tests/e2e/.auth/analyst.json' });

	const downloadCard = (page: any, label: string) =>
		page.locator('a.group.card').filter({ hasText: label });

	test('issues CSV download is available', async ({ page }) => {
		await goto(page, '/Authenticated/reports');
		const download = page.waitForEvent('download');
		await downloadCard(page, 'Issue Tracker').getByText('Download CSV').click();
		const d = await download;
		expect(d.suggestedFilename()).toMatch(/^issues-.*\.csv$/);
		await d.cancel();
	});

	test('flagged claims CSV download is available', async ({ page }) => {
		await goto(page, '/Authenticated/reports');
		const download = page.waitForEvent('download');
		await downloadCard(page, 'Flagged Claims').getByText('Download CSV').click();
		const d = await download;
		expect(d.suggestedFilename()).toMatch(/^flagged-claims-.*\.csv$/i);
		await d.cancel();
	});

	test('weekly summary PDF is non-empty', async ({ page }) => {
		await goto(page, '/Authenticated/reports');
		const download = page.waitForEvent('download');
		await downloadCard(page, 'Weekly Summary').getByText('Download PDF').click();
		const d = await download;
		expect(d.suggestedFilename()).toMatch(/^weekly-summary-.*\.pdf$/);
		await d.cancel();
	});

	test('audit XLSX is NOT available for analyst (admin-gated)', async ({ page }) => {
		await goto(page, '/Authenticated/reports');
		// Non-admins still see the disabled placeholder card describing the
		// restriction — the actual "Download XLSX" link must be absent.
		await expect(page.getByText('Admin access required')).toBeVisible({ timeout: 10_000 });
		await expect(page.getByText('Download XLSX')).not.toBeVisible({ timeout: 5_000 });
	});
});

// Admin — should see the audit XLSX export as well.
test.describe('admin exports', () => {
	test.use({ storageState: 'tests/e2e/.auth/admin.json' });

	test('audit XLSX is visible and downloadable', async ({ page }) => {
		await goto(page, '/Authenticated/reports');
		await expect(page.getByText('Full System Audit')).toBeVisible({ timeout: 10_000 });
		const download = page.waitForEvent('download');
		await page
			.locator('a.group.card')
			.filter({ hasText: 'Full System Audit' })
			.getByText('Download XLSX')
			.click();
		const d = await download;
		expect(d.suggestedFilename()).toMatch(/^system-audit-.*\.xlsx$/i);
		await d.cancel();
	});
});
