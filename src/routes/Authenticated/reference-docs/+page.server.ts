// src/routes/Authenticated/reference-docs/+page.server.ts
//
// Security layers applied here:
//   Layer 1 – hooks.server.ts: blocks unauthenticated requests to /Authenticated/**
//   Layer 2 – +layout.server.ts: re-validates session, resolves role
//   Layer 3 – THIS FILE: re-validates session on every action before mutating data
//
// The "addCategory" action also performs a DB-level role check against the profiles
// table (independent of the JWT) so a tampered token cannot escalate privileges.

import { redirect, fail, error } from '@sveltejs/kit';
import { measureServer } from '$lib/server/timing';
import { getPagination } from '$lib/utils/pagination';
import type { PageServerLoad, Actions } from './$types';
import { getServiceSupabase } from '$lib/server/supabase';
import { logAudit, buildDetails } from '$lib/server/audit';

// Mirrors the CHECK constraint on lgu_documents.document_type.
// Must be kept in sync if the DB constraint is ever changed.
// (Added Executive Order, Project Plan, Fiesta Schedule per the RAG
// chunking plan's type-gap note — the CHECK in
// supabase/migrations/006_rag_chunking.sql includes these too.)
const DOCUMENT_TYPES = [
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
] as const;

type DocumentType = (typeof DOCUMENT_TYPES)[number];

// ── Load ───────────────────────────────────────────────────────────────────
export const load: PageServerLoad = async ({ locals, url, depends }) => {
	const { safeGetSession, supabase } = locals;
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');
	depends('reference-docs:list');

	const { page, pageSize, from, to } = getPagination(url.searchParams);
	const searchTerm = (url.searchParams.get('q') ?? '').trim();
	let docsQuery = supabase
		.from('lgu_documents')
		.select('id, title, document_type, is_active, uploaded_at', { count: 'exact' })
		.order('uploaded_at', { ascending: false })
		.order('id', { ascending: false })
		.range(from, to);
	if (searchTerm) {
		// Quote the PostgREST filter value and escape LIKE metacharacters so
		// commas, quotes, percent signs and underscores remain literal search text.
		const pattern = JSON.stringify(`%${searchTerm.replace(/[\\%_]/g, '\\$&')}%`);
		docsQuery = docsQuery.or(`title.ilike.${pattern},document_type.ilike.${pattern}`);
	}

	const [docs, categoryResult, documentCountResult] = await measureServer(
		locals,
		'documents_db',
		() =>
			Promise.all([
				docsQuery,
				supabase
					.from('nlp_categories')
					.select('id, name, description, created_at')
					.order('name', { ascending: true }),
				searchTerm
					? supabase.from('lgu_documents').select('id', { count: 'exact', head: true })
					: Promise.resolve(null)
			])
	);
	if (docs.error || categoryResult.error || documentCountResult?.error) {
		console.error('[reference-docs] library query failed');
		error(500, 'Could not load the document library. Please try again.');
	}

	return {
		documents: docs.data ?? [],
		categories: categoryResult.data ?? [],
		documentTypes: DOCUMENT_TYPES,
		total: docs.count ?? 0,
		documentCount: documentCountResult?.count ?? docs.count ?? 0,
		page,
		pageSize,
		searchTerm
	};
};

// ── Actions ────────────────────────────────────────────────────────────────
export const actions: Actions = {
	/**
	 * uploadDocument
	 * Accepts a title, document_type, plain-text content, and an optional
	 * PDF/DOCX file attachment.  The file is stored in the private
	 * "lgu-documents" Storage bucket; the text content goes into the DB
	 * for embedding generation by the background NLP pipeline.
	 */
	uploadDocument: async ({ request, locals: { safeGetSession, supabase } }) => {
		// Layer 3: re-validate session inside the action
		const { user } = await safeGetSession();
		if (!user) return fail(401, { uploadError: 'Session expired. Please log in again.' });

		const formData = await request.formData();
		const title = (formData.get('title') as string | null)?.trim() ?? '';
		const documentType = (formData.get('documentType') as string | null) ?? '';
		const content = (formData.get('content') as string | null)?.trim() ?? '';
		const file = formData.get('file') as File | null;

		// ── Input validation ───────────────────────────────────────────────
		if (!title) return fail(400, { uploadError: 'Document title is required.', field: 'title' });
		if (!DOCUMENT_TYPES.includes(documentType as DocumentType))
			return fail(400, { uploadError: 'Select a valid document type.', field: 'documentType' });
		if (!content)
			return fail(400, {
				uploadError: 'Document content / summary is required.',
				field: 'content'
			});

		// ── Optional file upload to Storage ───────────────────────────────
		let storageRef: string | null = null;

		if (file && file.size > 0) {
			const ALLOWED_TYPES = [
				'application/pdf',
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
				'application/msword',
				'text/plain'
			];

			if (!ALLOWED_TYPES.includes(file.type))
				return fail(400, {
					uploadError: 'Only PDF, DOCX, and TXT files are allowed.',
					field: 'file'
				});

			if (file.size > 10 * 1024 * 1024)
				return fail(400, { uploadError: 'File must be under 10 MB.', field: 'file' });

			// Namespace the file under the uploader's UID to prevent collisions.
			// Extension is whitelisted to [a-z0-9]{1,5} — never trust raw
			// filename segments (can contain '/' or odd characters).
			const rawExt = file.name.split('.').pop()?.toLowerCase() ?? '';
			const ext = /^[a-z0-9]{1,5}$/.test(rawExt) ? rawExt : 'bin';
			const storagePath = `${user.id}/${Date.now()}.${ext}`;
			const bytes = await file.arrayBuffer();

			const { error: storageError } = await supabase.storage
				.from('lgu-documents')
				.upload(storagePath, bytes, { contentType: file.type, upsert: false });

			if (storageError)
				return fail(500, {
					uploadError: `File storage failed: ${storageError.message}`
				});

			storageRef = storagePath;
		}

		// ── Insert into lgu_documents ──────────────────────────────────────
		// content may reference the storage path so the NLP pipeline can
		// fetch the raw file for text extraction and embedding.
		const fullContent = storageRef ? `${content}\n\n[attachment:${storageRef}]` : content;

		const { data: inserted, error: insertError } = await supabase
			.from('lgu_documents')
			.insert({
				title,
				document_type: documentType,
				content: fullContent,
				uploaded_by: user.id
			})
			.select('id')
			.single();

		if (insertError) {
			console.error('[reference-docs] insert error:', insertError.message);
			return fail(500, { uploadError: `Could not save document: ${insertError.message}` });
		}

		await logAudit({
			action: 'document.create',
			actorId: user.id,
			actorEmail: user.email ?? 'system',
			resourceType: 'document',
			resourceId: (inserted as { id: string } | null)?.id ?? null,
			details: buildDetails({
				title,
				document_type: documentType,
				has_attachment: Boolean(storageRef)
			})
		});

		return { uploadSuccess: true };
	},

	/**
	 * addCategory
	 * Creates a new NLP topic category.  Requires admin role — enforced at
	 * three independent levels:
	 *   1. Supabase RLS policy on nlp_categories (DB layer)
	 *   2. profiles table role check inside this action (server layer)
	 *   3. UI hides the button from non-admins (presentation layer)
	 */
	addCategory: async ({ request, locals: { safeGetSession, supabase } }) => {
		// Layer 3: re-validate session inside the action
		const { user } = await safeGetSession();
		if (!user) return fail(401, { categoryError: 'Session expired. Please log in again.' });

		// Independent role check against the profiles table — does not rely
		// solely on the JWT claim so a tampered token cannot bypass this.
		const { data: profile, error: profileError } = await supabase
			.from('profiles')
			.select('role')
			.eq('id', user.id)
			.single();

		if (profileError || profile?.role !== 'admin')
			return fail(403, { categoryError: 'Admin access required to add categories.' });

		const formData = await request.formData();
		const name = (formData.get('name') as string | null)?.trim() ?? '';
		const description = (formData.get('description') as string | null)?.trim() || null;

		if (!name) return fail(400, { categoryError: 'Category name is required.', field: 'name' });
		if (name.length > 60)
			return fail(400, { categoryError: 'Name must be 60 characters or less.', field: 'name' });

		const { data: inserted, error: insertError } = await supabase
			.from('nlp_categories')
			.insert({
				name,
				description,
				created_by: user.id
			})
			.select('id')
			.single();

		if (insertError) {
			if (insertError.code === '23505')
				return fail(409, { categoryError: `Category "${name}" already exists.` });
			return fail(500, { categoryError: `Could not create category: ${insertError.message}` });
		}

		await logAudit({
			action: 'category.create',
			actorId: user.id,
			actorEmail: user.email ?? 'system',
			resourceType: 'category',
			resourceId: (inserted as { id: string } | null)?.id ?? null,
			details: buildDetails({ name, description })
		});

		return { categorySuccess: true, categoryName: name };
	},

	/**
	 * editDocument
	 * Updates title, document_type, and content of an existing document.
	 * Available to all authenticated users (admin + analyst).
	 */
	editDocument: async ({ request, locals: { safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { editError: 'Session expired. Please log in again.' });

		const formData = await request.formData();
		const id = (formData.get('id') as string | null) ?? '';
		const title = (formData.get('title') as string | null)?.trim() ?? '';
		const documentType = (formData.get('documentType') as string | null) ?? '';
		const content = (formData.get('content') as string | null)?.trim() ?? '';
		const attachRef = (formData.get('attachRef') as string | null) ?? '';

		if (!id) return fail(400, { editError: 'Document ID missing.' });
		if (!title) return fail(400, { editError: 'Title is required.', editField: 'title' });
		if (!DOCUMENT_TYPES.includes(documentType as DocumentType))
			return fail(400, { editError: 'Select a valid document type.', editField: 'documentType' });

		// Reattach the storage reference so the NLP pipeline keeps its pointer.
		const fullContent = attachRef ? `${content}\n\n[attachment:${attachRef}]` : content;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { error } = await (getServiceSupabase().from('lgu_documents') as any)
			.update({ title, document_type: documentType, content: fullContent })
			.eq('id', id);

		if (error) return fail(500, { editError: `Update failed: ${error.message}` });

		// Invalidate this document's chunks so chunk-level retrieval never
		// surfaces stale text after the content changes (plan §4). The chunks
		// are regenerated on the next backfill run.
		await getServiceSupabase().from('document_chunks').delete().eq('document_id', id);

		await logAudit({
			action: 'document.update',
			actorId: user.id,
			actorEmail: user.email ?? 'system',
			resourceType: 'document',
			resourceId: id,
			details: buildDetails({ title, document_type: documentType })
		});

		return { editSuccess: true };
	},

	/**
	 * toggleActive
	 * Flips the is_active flag. Available to all authenticated users.
	 */
	toggleActive: async ({ request, locals: { safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { toggleError: 'Session expired. Please log in again.' });

		const formData = await request.formData();
		const id = (formData.get('id') as string | null) ?? '';
		const isActive = formData.get('is_active') === 'true';

		if (!id) return fail(400, { toggleError: 'Document ID missing.' });

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { error } = await (getServiceSupabase().from('lgu_documents') as any)
			.update({ is_active: !isActive })
			.eq('id', id);

		if (error) return fail(500, { toggleError: `Status update failed: ${error.message}` });

		await logAudit({
			action: 'document.toggle_active',
			actorId: user.id,
			actorEmail: user.email ?? 'system',
			resourceType: 'document',
			resourceId: id,
			details: buildDetails({ is_active: !isActive })
		});

		return {
			toggleSuccess: true,
			toggleMessage: !isActive ? 'Document marked as active.' : 'Document marked as inactive.'
		};
	},

	/**
	 * deleteDocument
	 * Permanently removes a document record. Available to all authenticated users.
	 */
	deleteDocument: async ({ request, locals: { safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { deleteError: 'Session expired. Please log in again.' });

		const formData = await request.formData();
		const id = (formData.get('id') as string | null) ?? '';

		if (!id) return fail(400, { deleteError: 'Document ID missing.' });

		const { error } = await getServiceSupabase().from('lgu_documents').delete().eq('id', id);

		if (error) return fail(500, { deleteError: `Delete failed: ${error.message}` });

		await logAudit({
			action: 'document.delete',
			actorId: user.id,
			actorEmail: user.email ?? 'system',
			resourceType: 'document',
			resourceId: id
		});

		return { deleteSuccess: true };
	}
};
