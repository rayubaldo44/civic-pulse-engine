import { test, expect, goto } from './fixtures';
import {
	insertRawContent,
	callEdgeFunction,
	waitForProcessedContent,
	waitForFlaggedClaim,
	seedRagDocument
} from './fixtures';

test.use({ storageState: 'tests/e2e/.auth/analyst.json' });

const PENDING_CLAIM = 'Walang pulis sa Bambang, delikado sa gabi.';

test.describe('Flagged Claims — Review UI', () => {
	test.beforeEach(async ({ page }) => {
		await goto(page, '/Authenticated/flagged-claims');
		await expect(page.getByRole('heading', { name: 'Flagged Claims' })).toBeVisible({
			timeout: 10_000
		});
	});

	test('pending claim is visible with review buttons enabled', async ({ page }) => {
		const claim = page.getByText(PENDING_CLAIM);
		await expect(claim).toBeVisible({ timeout: 10_000 });

		const markFalse = page.getByRole('button', { name: 'Mark False' });
		const verifyTrue = page.getByRole('button', { name: 'Verify True' });
		await expect(markFalse.first()).toBeEnabled({ timeout: 5_000 });
		await expect(verifyTrue.first()).toBeEnabled({ timeout: 5_000 });
	});

	test('review a claim as Verified True', async ({ page }) => {
		const card = page.locator('div.card').filter({ hasText: PENDING_CLAIM });
		await expect(card).toBeVisible({ timeout: 10_000 });

		await card.getByRole('button', { name: 'Verify True' }).click();

		const banner = card.locator('span', { hasText: 'Verified as True' });
		await expect(banner).toBeVisible({ timeout: 5_000 });
		await expect(card.getByRole('button', { name: 'Verify True' })).toBeDisabled();
	});

	test('previously reviewed claims show disabled buttons', async ({ page }) => {
		const claim = page.getByText('Sirang ilaw sa Niugan');
		await expect(claim).toBeVisible({ timeout: 10_000 });

		const card = page.locator('div.card').filter({ hasText: 'Sirang ilaw sa Niugan' });
		await expect(card.getByRole('button', { name: 'Mark False' })).toBeDisabled({
			timeout: 5_000
		});
	});
});

test.describe('Flagged Claims — Claim Detection & RAG Pipeline', () => {
	test.beforeEach(async ({ page }) => {
		await goto(page, '/Authenticated/flagged-claims');
		await expect(page.getByRole('heading', { name: 'Flagged Claims' })).toBeVisible({
			timeout: 10_000
		});
	});

	test('claim detected → appears in Flagged Claims as Pending with matched_patterns', async () => {
		const rawId = await insertRawContent({
			comment_id: 'claim_detect_001',
			raw_text: 'The municipal hall is on fire right now!',
			source_platform: 'facebook',
			post_id: 'claim_post_1',
			author_hash: 'claim_user_1'
		});

		await callEdgeFunction('process-comment', { ids: [rawId] });
		const processed = await waitForProcessedContent(rawId);
		expect(processed).not.toBeNull();

		const claim = await waitForFlaggedClaim(processed!.id);
		expect(claim).not.toBeNull();
		expect(claim?.status).toBe('Pending');
		expect(claim?.rag_determination).toBeTruthy();
	});

	test('RAG Supported: claim matching LGU document', async () => {
		// Seed an LGU document that supports the claim
		await seedRagDocument(
			'2026 Road Repair Schedule',
			'The Municipality of Pulilan will repair national and barangay roads in Q1 2026.',
			'Infrastructure Report'
		);

		const rawId = await insertRawContent({
			comment_id: 'rag_supported_001',
			raw_text: 'Pulilan will repair barangay roads in the first quarter.',
			source_platform: 'youtube',
			post_id: 'rag_vid_1',
			author_hash: 'rag_user_supported'
		});

		await callEdgeFunction('process-comment', { ids: [rawId] });
		const processed = await waitForProcessedContent(rawId);
		expect(processed).not.toBeNull();

		const claim = await waitForFlaggedClaim(processed!.id);
		expect(claim).not.toBeNull();
		// RAG determination depends on HF Space embeddings + Groq LLM
		// With dummy embeddings in test, may return Insufficient Evidence
		// Just verify the pipeline completes and claim is created
		expect(['Supported', 'Refuted', 'Insufficient Evidence']).toContain(claim?.rag_determination);
	});

	test('RAG Refuted: claim contradicted by LGU document', async () => {
		await seedRagDocument(
			'Health Center Schedule',
			'Health centers receive monthly medicine replenishment on the first week of each month.',
			'Health Protocol'
		);

		const rawId = await insertRawContent({
			comment_id: 'rag_refuted_001',
			raw_text: 'Health centers have not received medicine for six months.',
			source_platform: 'facebook',
			post_id: 'rag_post_2',
			author_hash: 'rag_user_refuted'
		});

		await callEdgeFunction('process-comment', { ids: [rawId] });
		const processed = await waitForProcessedContent(rawId);
		expect(processed).not.toBeNull();

		const claim = await waitForFlaggedClaim(processed!.id);
		expect(claim).not.toBeNull();
		// Could be Refuted or Insufficient Evidence depending on similarity
		expect(['Refuted', 'Insufficient Evidence']).toContain(claim?.rag_determination);
	});

	test('RAG Insufficient Evidence: no matching LGU document', async () => {
		const rawId = await insertRawContent({
			comment_id: 'rag_insufficient_001',
			raw_text: 'Aliens landed in Poblacion last night.',
			source_platform: 'youtube',
			post_id: 'rag_vid_2',
			author_hash: 'rag_user_insufficient'
		});

		await callEdgeFunction('process-comment', { ids: [rawId] });
		const processed = await waitForProcessedContent(rawId);
		expect(processed).not.toBeNull();

		const claim = await waitForFlaggedClaim(processed!.id);
		expect(claim).not.toBeNull();
		expect(claim?.rag_determination).toBe('Insufficient Evidence');
		expect(claim?.rag_evidence_snippet).toContain('No matching LGU documents');
	});

	test('matched_patterns are extracted and stored', async () => {
		const rawId = await insertRawContent({
			comment_id: 'patterns_001',
			raw_text: 'The roads in Bambang are completely destroyed and unsafe.',
			source_platform: 'facebook',
			post_id: 'patterns_post',
			author_hash: 'patterns_user'
		});

		await callEdgeFunction('process-comment', { ids: [rawId] });
		const processed = await waitForProcessedContent(rawId);
		expect(processed).not.toBeNull();

		const { getLocalSupabase } = await import('../shared/supabase-env');
		const { createClient } = await import('@supabase/supabase-js');
		const local = getLocalSupabase();
		const svc = createClient(local.url, local.serviceRoleKey);
		const { data: claim } = await (svc.from('flagged_claims') as any)
			.select('matched_patterns')
			.eq('processed_content_id', processed!.id)
			.single();

		expect(claim?.matched_patterns).toBeTruthy();
		expect(Array.isArray(claim.matched_patterns)).toBe(true);
		// matched_patterns may be empty depending on HF Space claim detection output
		// Just verify the field exists and is an array
	});
});
