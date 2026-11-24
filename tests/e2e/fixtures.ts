import { test as base, expect as baseExpect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getLocalSupabase } from '../shared/supabase-env';

// Shared storageState represents one test session. Full-page navigation and
// context teardown must not revoke it through the app's last-tab beacon.
// Explicit logout actions remain real and are covered by auth.spec.ts.
export const test = base.extend({
	context: async ({ context }, use) => {
		await context.addInitScript(() => {
			const send = navigator.sendBeacon.bind(navigator);
			navigator.sendBeacon = (url, data) =>
				new URL(String(url), location.href).pathname === '/api/logout-beacon'
					? true
					: send(url, data);
		});
		await use(context);
	}
});

// Vite dev serves the SSR shell first; SvelteKit hydrates the client bundle
// shortly after `load` fires. Interactions issued before hydration are
// silently dropped, so every full navigation goes through `goto`, which waits
// for hydration before returning control to the test.
export async function goto(page: Page, path: string): Promise<void> {
	await page.goto(path, { waitUntil: 'load' });
	await page
		.waitForFunction(
			() => document.documentElement.hasAttribute('data-sveltekit-hydrated'),
			undefined,
			{ timeout: 5_000 }
		)
		.catch(() => page.waitForTimeout(750));
}

export { baseExpect as expect };

// ── Test-only helpers ────────────────────────────────────────────────────────

const local = getLocalSupabase();
const svc = createClient(local.url, local.serviceRoleKey);

/** Invoke a Supabase Edge Function directly (bypasses UI). */
export async function callEdgeFunction(
	fnName: string,
	body: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
	const url = `${local.url}/functions/v1/${fnName}`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${local.serviceRoleKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});
	return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Insert a raw_content row for pipeline testing. */
export async function insertRawContent(data: {
	comment_id: string;
	raw_text: string;
	source_platform: string;
	post_id: string;
	author_hash: string;
	is_processed?: boolean;
	fetched_at?: string;
	created_at?: string;
	reaction_count?: number;
	reply_count?: number;
}): Promise<string> {
	const { data: row, error } = await (svc.from('raw_content') as any)
		.insert({
			...data,
			is_processed: data.is_processed ?? false,
			fetched_at: data.fetched_at ?? new Date().toISOString(),
			created_at: data.created_at ?? new Date().toISOString(),
			reaction_count: data.reaction_count ?? 0,
			reply_count: data.reply_count ?? 0
		})
		.select('id')
		.single();
	if (error) throw new Error(`insert raw_content: ${error.message}`);
	return row.id;
}

/** Poll until processed_content row exists for a raw_content_id. */
export async function waitForProcessedContent(
	rawContentId: string,
	timeoutMs = 30_000
): Promise<{ id: string; cleaned_text: string } | null> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const { data, error } = await (svc.from('processed_content') as any)
			.select('id, cleaned_text')
			.eq('raw_content_id', rawContentId)
			.single();
		if (!error && data) return data;
		await new Promise((r) => setTimeout(r, 500));
	}
	return null;
}

/** Poll until flagged_claims row exists for a processed_content_id. */
export async function waitForFlaggedClaim(
	processedContentId: string,
	timeoutMs = 30_000
): Promise<{
	id: string;
	rag_determination: string | null;
	rag_evidence_snippet: string | null;
	status: string;
} | null> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const { data, error } = await (svc.from('flagged_claims') as any)
			.select('id, rag_determination, rag_evidence_snippet, status')
			.eq('processed_content_id', processedContentId)
			.single();
		if (!error && data) return data;
		await new Promise((r) => setTimeout(r, 500));
	}
	return null;
}

/** Seed an LGU document + chunks for RAG testing. */
export async function seedRagDocument(
	title: string,
	content: string,
	documentType = 'Infrastructure Report'
): Promise<{ docId: string; chunkIds: string[] }> {
	// Valid document types per migration 006_rag_chunking.sql
	const validTypes = [
		'Ordinance',
		'Resolution',
		'Advisory',
		'Health Protocol',
		'Infrastructure Report',
		'Budget Report',
		'Press Release',
		'Waste Management Plan',
		'Public Safety Report',
		'Executive Order',
		'Project Plan',
		'Fiesta Schedule',
		'Other'
	];
	const type = validTypes.includes(documentType) ? documentType : 'Infrastructure Report';

	const { data: doc, error: docErr } = await (svc.from('lgu_documents') as any)
		.insert({
			title,
			content,
			document_type: type,
			is_active: true,
			uploaded_at: new Date().toISOString()
		})
		.select('id')
		.single();
	if (docErr) throw new Error(`insert lgu_documents: ${docErr.message}`);

	const chunkText = content.slice(0, 500);
	const { data: chunk, error: chunkErr } = await (svc.from('document_chunks') as any)
		.insert({
			document_id: doc.id,
			chunk_index: 0,
			chunk_text: chunkText,
			section_label: 'Section 1',
			token_count: Math.ceil(chunkText.length / 4),
			embedding: `[${Array.from({ length: 768 }, () => '0.5').join(',')}]`
		})
		.select('id')
		.single();
	if (chunkErr) throw new Error(`insert document_chunks: ${chunkErr.message}`);

	return { docId: doc.id, chunkIds: [chunk.id] };
}
