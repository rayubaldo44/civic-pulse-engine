<script lang="ts">
	/**
	 * reference-docs/+page.svelte
	 *
	 * Documents come from the database via +page.server.ts load().
	 * Mutations (upload, add category) use SvelteKit form actions with
	 * use:enhance for progressive enhancement — works without JS too.
	 *
	 * Security note: all mutation logic lives server-side in +page.server.ts.
	 * The client never touches Supabase directly on this page.
	 */
	import { enhance } from '$app/forms';
	import { onDestroy } from 'svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Toast from '$lib/components/Toast.svelte';

	// ── Server data ────────────────────────────────────────────────────────
	export let data: import('./$types').PageData;
	export let form: import('./$types').ActionData;

	$: ({ documents, categories, documentTypes } = data);

	// Role is passed down from the layout via page data — server-resolved,
	// never client-supplied.  Used only to show/hide the Add Category button;
	// the server action enforces the same check independently.
	$: role = (data.role ?? 'analyst') as string;

	// ── State ───────────────────────────────────────────────────────────────
	let searchTerm = '';
	$: searchTerm = data.searchTerm;

	let isUploadOpen = false;
	let isCategoryOpen = false;
	let isDocModalOpen = false;

	// Upload form fields
	let uploadTitle = '';
	let uploadType = '';
	let uploadContent = '';
	let uploadFile: FileList | null = null;
	let uploadLoading = false;

	// Category form fields
	let categoryName = '';
	let categoryDescription = '';
	let categoryLoading = false;

	// Doc action modal
	type Doc = {
		id: string;
		title: string;
		document_type: string;
		is_active: boolean;
		uploaded_at: string;
	};
	let selectedDoc: Doc | null = null;
	let contentLoading = false;
	let contentError = '';
	let contentRequest: AbortController | null = null;
	onDestroy(() => contentRequest?.abort());
	let editTitle = '';
	let editType = '';
	let editContent = '';
	let editAttachRef = ''; // hidden — preserves storage path through edits
	let editLoading = false;
	let toggleLoading = false;
	let deleteLoading = false;
	let confirmDelete = false;

	let toastRef: Toast;

	function openDocModal(doc: Doc) {
		selectedDoc = doc;
		editTitle = doc.title;
		editType = doc.document_type;
		editContent = '';
		editAttachRef = '';
		confirmDelete = false;
		isDocModalOpen = true;
		void loadDocContent(doc);
	}

	async function loadDocContent(doc: Doc) {
		contentRequest?.abort();
		const controller = new AbortController();
		contentRequest = controller;
		contentLoading = true;
		contentError = '';
		try {
			const response = await fetch(`/api/reference-docs/${encodeURIComponent(doc.id)}`, {
				signal: controller.signal
			});
			if (!response.ok || response.redirected) throw new Error('Document unavailable');
			const detail = await response.json();
			if (
				detail.id !== doc.id ||
				!(detail.content === null || typeof detail.content === 'string')
			) {
				throw new Error('Invalid document response');
			}
			if (controller.signal.aborted || contentRequest !== controller || selectedDoc?.id !== doc.id)
				return;
			selectedDoc = detail;
			editTitle = detail.title;
			editType = detail.document_type;
			const raw = detail.content ?? '';
			const match = raw.match(/\n\n\[attachment:(.+)\]$/);
			editAttachRef = match ? match[1] : '';
			editContent = match ? raw.replace(/\n\n\[attachment:.+\]$/, '') : raw;
		} catch {
			if (!controller.signal.aborted && contentRequest === controller) {
				contentError =
					'Could not load this document. Retry, or sign in again if your session expired.';
			}
		} finally {
			if (contentRequest === controller) contentLoading = false;
		}
	}

	function closeDocModal() {
		contentRequest?.abort();
		contentRequest = null;
		isDocModalOpen = false;
		selectedDoc = null;
		confirmDelete = false;
	}

	// React to form action results
	$: if (form?.uploadSuccess) {
		isUploadOpen = false;
		uploadTitle = '';
		uploadType = '';
		uploadContent = '';
		uploadFile = null;
		toastRef?.show(
			'Saved to database. NLP pipeline will generate embeddings shortly.',
			'Document Uploaded'
		);
	}
	$: if (form?.uploadError) {
		toastRef?.show(form.uploadError as string, 'Upload Failed', true);
	}
	$: if (form?.categorySuccess) {
		isCategoryOpen = false;
		categoryName = '';
		categoryDescription = '';
		toastRef?.show(`"${form.categoryName}" is now available in the NLP engine.`, 'Category Added');
	}
	$: if (form?.categoryError) {
		toastRef?.show(form.categoryError as string, 'Error', true);
	}
	$: if (form?.editSuccess) {
		closeDocModal();
		toastRef?.show('Changes saved successfully.', 'Document Updated');
	}
	$: if (form?.editError) {
		toastRef?.show(form.editError as string, 'Update Failed', true);
	}
	$: if (form?.toggleSuccess) {
		closeDocModal();
		toastRef?.show(form.toggleMessage as string, 'Status Updated');
	}
	$: if (form?.toggleError) {
		toastRef?.show(form.toggleError as string, 'Error', true);
	}
	$: if (form?.deleteSuccess) {
		closeDocModal();
		toastRef?.show('Removed from the knowledge base.', 'Document Deleted');
	}
	$: if (form?.deleteError) {
		toastRef?.show(form.deleteError as string, 'Delete Failed', true);
	}

	// ── Helpers ──────────────────────────────────────────────────────────────
	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function closeUpload() {
		isUploadOpen = false;
	}
	function closeCategory() {
		isCategoryOpen = false;
	}

	function onBackdropClick(e: MouseEvent, closeFn: () => void) {
		if (e.target === e.currentTarget) closeFn();
	}
</script>

<svelte:window
	on:keydown={(event) => {
		if (event.key === 'Escape') closeDocModal();
	}}
/>

<!-- ── Page ──────────────────────────────────────────────────────────────── -->
<div class="animate-fade-in mx-auto max-w-7xl space-y-8 p-8">
	<!-- Header -->
	<PageHeader
		icon="docs"
		title="Reference Documents"
		subtitle="The NLP engine uses these official LGU documents as a knowledge base to cross-reference public claims."
	>
		{#snippet right()}
			<button type="button" on:click={() => (isUploadOpen = true)} class="btn-primary">
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
					/>
				</svg>
				Upload Document
			</button>
		{/snippet}
	</PageHeader>

	<!-- Main grid -->
	<div class="grid grid-cols-1 gap-8 md:grid-cols-3">
		<!-- ── Left: search + doc list ─────────────────────────────────────── -->
		<div class="space-y-6 md:col-span-2">
			<!-- Search -->
			<form method="GET" class="flex items-center gap-3">
				<div class="relative flex-1">
					<svg
						class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-faint"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<circle cx="11" cy="11" r="8" /><path
							d="m21 21-4.35-4.35"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					<input
						type="search"
						name="q"
						aria-label="Search document titles or types"
						placeholder="Search document titles or types..."
						bind:value={searchTerm}
						class="input w-full rounded-xl py-2.5 pr-10 pl-10"
					/>
					{#if searchTerm}
						<a
							href="?"
							aria-label="Clear search"
							class="absolute top-1/2 right-3 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
						>
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
						</a>
					{/if}
				</div>
				<button type="submit" class="btn-secondary">Search</button>
			</form>

			<!-- Document cards -->
			<div class="space-y-3">
				{#if data.documentCount === 0}
					<div
						class="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center text-gray-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400"
					>
						<svg
							class="mx-auto mb-3 h-8 w-8 opacity-30"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
						<p class="text-sm font-medium">No documents in the knowledge base yet.</p>
						<p class="mt-1 text-xs opacity-70">Upload an LGU document to get started.</p>
					</div>
				{:else if documents.length === 0}
					<div
						class="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center text-gray-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400"
					>
						<p class="text-sm">
							No documents found matching "<span class="font-medium">{searchTerm}</span>"
						</p>
					</div>
				{:else}
					{#each documents as doc (doc.id)}
						<button
							type="button"
							class="flex w-full cursor-pointer items-center justify-between rounded-xl border p-4 text-left shadow-sm backdrop-blur-sm transition-all hover:shadow-md dark:border-slate-700/70
							{doc.is_active
								? 'border-gray-200/70 bg-white/50 hover:border-signal-200 dark:bg-slate-900/50 dark:hover:border-signal-700/40'
								: 'border-gray-200/50 bg-gray-50/60 opacity-60 hover:opacity-80 dark:border-slate-700/40 dark:bg-slate-800/30'}"
							on:click={() => openDocModal(doc)}
						>
							<div class="flex items-center gap-4">
								<!-- File icon -->
								<div
									class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border
								{doc.is_active
										? 'border-signal-100 bg-signal-50 text-signal-500 dark:border-signal-900/60 dark:bg-signal-950/60 dark:text-signal-400'
										: 'border-gray-200 bg-gray-100 text-gray-400 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-500'}"
								>
									<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
										/>
									</svg>
								</div>
								<div>
									<h4 class="text-sm font-semibold text-gray-800 dark:text-slate-200">
										{doc.title}
									</h4>
									<div
										class="mt-1 flex items-center gap-2 text-xs text-gray-400 dark:text-slate-500"
									>
										<span>{formatDate(doc.uploaded_at)}</span>
										<span class="h-1 w-1 rounded-full bg-gray-300 dark:bg-slate-600"></span>
										<span>{doc.document_type}</span>
									</div>
								</div>
							</div>

							<!-- Status badge -->
							{#if doc.is_active}
								<span
									class="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400"
								>
									Active
								</span>
							{:else}
								<span
									class="inline-flex items-center rounded-md border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-400 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-500"
								>
									Inactive
								</span>
							{/if}
						</button>
					{/each}
				{/if}
			</div>
			<Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
		</div>

		<!-- ── Right sidebar ────────────────────────────────────────────────── -->
		<div class="space-y-6 md:col-span-1">
			<!-- Knowledge Base Status -->
			<div
				class="card border-signal-100 bg-signal-50/40 p-6 dark:border-signal-900/60 dark:bg-signal-950/30"
			>
				<div class="mb-4">
					<h3 class="text-lg font-semibold text-gray-800 dark:text-slate-200">
						Knowledge Base Status
					</h3>
					<p class="mt-0.5 text-sm text-gray-500 dark:text-slate-400">
						Engine vector database metrics
					</p>
				</div>

				<div class="space-y-4">
					<div class="flex items-center justify-between">
						<span class="text-sm text-gray-500 dark:text-slate-400">Indexed Documents</span>
						<span class="font-semibold text-gray-800 dark:text-slate-200">{data.documentCount}</span
						>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-sm text-gray-500 dark:text-slate-400">NLP Categories</span>
						<span class="font-semibold text-gray-800 dark:text-slate-200">{categories.length}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-sm text-gray-500 dark:text-slate-400">Last Sync</span>
						<span class="text-sm font-semibold text-emerald-600 dark:text-emerald-400"
							>Just now</span
						>
					</div>

					<!-- Add Category — admin only (UI gate; server enforces too) -->
					{#if role === 'admin'}
						<div class="mt-2 border-t border-signal-100 pt-4 dark:border-signal-900/60">
							<button
								type="button"
								on:click={() => (isCategoryOpen = true)}
								class="btn-secondary w-full"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 4v16m8-8H4"
									/>
								</svg>
								Add Category
							</button>
						</div>
					{/if}
				</div>
			</div>

			<!-- NLP Categories list -->
			{#if categories.length > 0}
				<div class="card border-gray-200/70 p-5 dark:border-slate-700/70 dark:bg-slate-900">
					<h3 class="mb-3 text-sm font-semibold text-gray-700 dark:text-slate-300">
						NLP Topic Categories
					</h3>
					<ul class="space-y-2">
						{#each categories as cat (cat.id)}
							<li class="flex items-start gap-2">
								<span class="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-signal-400 dark:bg-signal-500"
								></span>
								<div>
									<p class="label">{cat.name}</p>
									{#if cat.description}
										<p class="text-xs text-gray-400 dark:text-slate-500">{cat.description}</p>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- ── Doc Action Modal ───────────────────────────────────────────────────── -->
{#if isDocModalOpen && selectedDoc}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		class="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
		on:click={(e) => onBackdropClick(e, closeDocModal)}
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="document-modal-title"
			tabindex="-1"
			class="animate-zoom-in card mx-0 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-b-none sm:mx-4 sm:rounded-b-xl"
		>
			<!-- Header -->
			<div class="flex items-start justify-between gap-3 border-b border-line p-5">
				<div>
					<p
						class="mb-0.5 text-xs font-medium tracking-wider text-gray-400 uppercase dark:text-slate-500"
					>
						{selectedDoc.document_type}
					</p>
					<h2
						id="document-modal-title"
						class="text-base leading-snug font-semibold text-gray-900 dark:text-slate-100"
					>
						{selectedDoc.title}
					</h2>
					<p class="mt-0.5 text-xs text-gray-400 dark:text-slate-500">
						Uploaded {formatDate(selectedDoc.uploaded_at)}
					</p>
				</div>
				<button
					type="button"
					on:click={closeDocModal}
					aria-label="Close document details"
					class="mt-0.5 shrink-0 text-ink-faint transition-colors hover:text-ink"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			{#if contentLoading}
				<p role="status" class="px-5 pt-5 text-sm text-ink-muted">Loading document content…</p>
			{:else if contentError}
				<div role="alert" class="space-y-3 px-5 pt-5 text-sm text-ink-muted">
					<p>{contentError}</p>
					<button
						type="button"
						class="btn-secondary"
						on:click={() => selectedDoc && loadDocContent(selectedDoc)}
						>Retry loading document</button
					>
				</div>
			{/if}

			<!-- ── Edit form ── -->
			<form
				method="POST"
				action="?/editDocument"
				use:enhance={({ cancel }) => {
					if (contentLoading || contentError) {
						cancel();
						return;
					}
					editLoading = true;
					return async ({ update }) => {
						await update();
						editLoading = false;
					};
				}}
			>
				<fieldset disabled={contentLoading || !!contentError}>
					<input type="hidden" name="id" value={selectedDoc.id} />
					<input type="hidden" name="attachRef" value={editAttachRef} />

					<div class="space-y-4 p-5">
						<h3
							class="text-xs font-semibold tracking-wider text-gray-500 uppercase dark:text-slate-400"
						>
							Edit Details
						</h3>

						<div class="space-y-1.5">
							<label for="edit-title" class="label">Title</label>
							<input
								id="edit-title"
								name="title"
								type="text"
								bind:value={editTitle}
								required
								class="input"
							/>
						</div>

						<div class="space-y-1.5">
							<label for="edit-type" class="label">Document Type</label>
							<select
								id="edit-type"
								name="documentType"
								bind:value={editType}
								required
								class="input [&_option]:bg-slate-800 [&_option]:text-slate-200"
							>
								{#each documentTypes as t}
									<option value={t}>{t}</option>
								{/each}
							</select>
						</div>

						<div class="space-y-1.5">
							<label for="edit-content" class="label">Content / Summary</label>
							<textarea
								id="edit-content"
								name="content"
								bind:value={editContent}
								rows="4"
								class="input resize-none"></textarea>
						</div>
					</div>

					<div class="flex justify-end px-5 pb-4">
						<button
							type="submit"
							disabled={editLoading || contentLoading || !!contentError}
							class="btn-primary"
						>
							{#if editLoading}
								<span
									class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
								></span>
								Saving…
							{:else}
								Save Changes
							{/if}
						</button>
					</div>
				</fieldset>
			</form>

			<div class="mx-5 border-t border-line"></div>

			<!-- ── Status toggle ── -->
			<form
				method="POST"
				action="?/toggleActive"
				use:enhance={() => {
					toggleLoading = true;
					return async ({ update }) => {
						await update();
						toggleLoading = false;
					};
				}}
				class="p-5"
			>
				<input type="hidden" name="id" value={selectedDoc.id} />
				<input type="hidden" name="is_active" value={String(selectedDoc.is_active)} />

				<div class="flex items-center justify-between">
					<div>
						<p class="label">Status</p>
						<p class="mt-0.5 text-xs text-gray-400 dark:text-slate-500">
							{selectedDoc.is_active
								? 'Active — visible to the NLP pipeline.'
								: 'Inactive — excluded from NLP queries.'}
						</p>
					</div>
					<button
						type="submit"
						disabled={toggleLoading}
						class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60
							{selectedDoc.is_active
							? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20'
							: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20'}"
					>
						{#if toggleLoading}
							<span
								class="h-3 w-3 animate-spin rounded-full border-2 border-current/30 border-t-current"
							></span>
						{/if}
						{selectedDoc.is_active ? 'Mark Inactive' : 'Mark Active'}
					</button>
				</div>
			</form>

			<div class="mx-5 border-t border-line"></div>

			<!-- ── Delete ── -->
			<form
				method="POST"
				action="?/deleteDocument"
				use:enhance={() => {
					deleteLoading = true;
					return async ({ update }) => {
						await update();
						deleteLoading = false;
					};
				}}
				class="p-5"
			>
				<input type="hidden" name="id" value={selectedDoc.id} />

				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-rose-600 dark:text-rose-400">Delete Document</p>
						<p class="mt-0.5 text-xs text-gray-400 dark:text-slate-500">
							Permanently removes from the knowledge base.
						</p>
					</div>

					{#if confirmDelete}
						<div class="flex items-center gap-2">
							<button type="button" on:click={() => (confirmDelete = false)} class="btn-secondary">
								Cancel
							</button>
							<button type="submit" disabled={deleteLoading} class="btn-danger">
								{#if deleteLoading}
									<span
										class="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white"
									></span>
								{/if}
								Confirm Delete
							</button>
						</div>
					{:else}
						<button
							type="button"
							on:click={() => (confirmDelete = true)}
							class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-100 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
						>
							Delete
						</button>
					{/if}
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- ── Upload Document Modal ──────────────────────────────────────────────── -->
{#if isUploadOpen}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
		on:click={(e) => onBackdropClick(e, closeUpload)}
	>
		<div class="animate-zoom-in card mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto">
			<div class="border-b border-line p-6">
				<h2 class="text-lg font-semibold text-gray-900 dark:text-slate-100">
					Upload Reference Document
				</h2>
				<p class="mt-1 text-sm text-gray-500 dark:text-slate-400">
					Add an official LGU document to the NLP knowledge base.
				</p>
			</div>

			<!--
				SvelteKit form action — all validation and DB writes happen server-side.
				use:enhance prevents full-page reload and feeds ActionData back reactively.
			-->
			<form
				method="POST"
				action="?/uploadDocument"
				enctype="multipart/form-data"
				use:enhance={() => {
					uploadLoading = true;
					return async ({ update }) => {
						await update();
						uploadLoading = false;
					};
				}}
			>
				<div class="space-y-4 p-6">
					<!-- Title -->
					<div class="space-y-1.5">
						<label for="upload-title" class="label">
							Document Title / Reference No. <span class="text-rose-500 dark:text-rose-400">*</span>
						</label>
						<input
							id="upload-title"
							name="title"
							type="text"
							bind:value={uploadTitle}
							required
							placeholder="e.g. Ordinance No. 15 Series of 2024"
							class="input"
						/>
					</div>

					<!-- Document Type (dropdown mirrors DB CHECK constraint) -->
					<div class="space-y-1.5">
						<label for="upload-type" class="label">
							Document Type <span class="text-rose-500 dark:text-rose-400">*</span>
						</label>
						<select
							id="upload-type"
							name="documentType"
							bind:value={uploadType}
							required
							class="input [&_option]:bg-slate-800 [&_option]:text-slate-200"
						>
							<option value="" disabled selected>Select a type…</option>
							{#each documentTypes as t}
								<option value={t}>{t}</option>
							{/each}
						</select>
					</div>

					<!-- Content / Summary -->
					<div class="space-y-1.5">
						<label for="upload-content" class="label">
							Document Content / Summary <span class="text-rose-500 dark:text-rose-400">*</span>
						</label>
						<textarea
							id="upload-content"
							name="content"
							bind:value={uploadContent}
							required
							rows="4"
							placeholder="Paste the document text or a summary for the NLP engine to embed…"
							class="input resize-none"></textarea>
					</div>

					<!-- File attachment (optional) -->
					<div class="space-y-1.5">
						<label for="upload-file" class="label">
							Attach File <span class="text-xs text-gray-400 dark:text-slate-500"
								>(optional · PDF, DOCX, or TXT · max 10 MB)</span
							>
						</label>
						<input
							id="upload-file"
							name="file"
							type="file"
							accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
							bind:files={uploadFile}
							class="w-full text-sm text-gray-500 transition-all file:mr-3 file:rounded-lg file:border-0 file:bg-signal-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-signal-600 hover:file:bg-signal-100 dark:text-slate-400 dark:file:bg-signal-950/60 dark:file:text-signal-400 dark:hover:file:bg-signal-900/60"
						/>
					</div>

					{#if form?.uploadError}
						<p
							class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400"
						>
							{form.uploadError}
						</p>
					{/if}
				</div>

				<div class="flex justify-end gap-3 p-6 pt-0">
					<button type="button" on:click={closeUpload} class="btn-secondary"> Cancel </button>
					<button type="submit" disabled={uploadLoading} class="btn-primary">
						{#if uploadLoading}
							<span
								class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
							></span>
							Processing…
						{:else}
							Process Document
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- ── Add Category Modal ─────────────────────────────────────────────────── -->
{#if isCategoryOpen}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
		on:click={(e) => onBackdropClick(e, closeCategory)}
	>
		<div class="animate-zoom-in card mx-4 w-full max-w-sm overflow-hidden">
			<div class="border-b border-line p-6">
				<h2 class="text-lg font-semibold text-gray-900 dark:text-slate-100">
					Add NLP Topic Category
				</h2>
				<p class="mt-1 text-sm text-gray-500 dark:text-slate-400">
					Create a new theme for the topic modelling pipeline to classify incoming feedback.
				</p>
			</div>

			<form
				method="POST"
				action="?/addCategory"
				use:enhance={() => {
					categoryLoading = true;
					return async ({ update }) => {
						await update();
						categoryLoading = false;
					};
				}}
			>
				<div class="space-y-4 p-6">
					<div class="space-y-1.5">
						<label for="cat-name" class="label">
							Category Name <span class="text-rose-500 dark:text-rose-400">*</span>
						</label>
						<input
							id="cat-name"
							name="name"
							type="text"
							bind:value={categoryName}
							required
							maxlength="60"
							placeholder="e.g. Public Safety"
							class="input"
						/>
					</div>

					<div class="space-y-1.5">
						<label for="cat-desc" class="label">
							Description <span class="text-xs text-gray-400 dark:text-slate-500">(optional)</span>
						</label>
						<input
							id="cat-desc"
							name="description"
							type="text"
							bind:value={categoryDescription}
							placeholder="Brief description of this category's scope"
							class="input"
						/>
					</div>

					{#if form?.categoryError}
						<p
							class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400"
						>
							{form.categoryError}
						</p>
					{/if}
				</div>

				<div class="flex justify-end gap-3 p-6 pt-0">
					<button type="button" on:click={closeCategory} class="btn-secondary"> Cancel </button>
					<button type="submit" disabled={categoryLoading} class="btn-primary">
						{#if categoryLoading}
							<span
								class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
							></span>
							Saving…
						{:else}
							Add to Engine
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<Toast bind:this={toastRef} />

<style>
	.animate-fade-in {
		animation: fadeIn 0.5s ease-out both;
	}
	.animate-zoom-in {
		animation: zoomIn 0.2s ease-out both;
	}

	/* Opacity-only — see CONTEXT.md gotcha: transform on this wrapper would
	   trap position:fixed modals/toasts to the document container. */
	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes zoomIn {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
</style>
