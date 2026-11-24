<script lang="ts">
	import { page as currentPage } from '$app/state';
	import { pageHref } from '$lib/utils/pagination';
	let { page, pageSize = 25, total }: { page: number; pageSize?: number; total: number } = $props();
</script>

<nav
	aria-label="Pagination"
	class="flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-ink-muted"
>
	<p aria-live="polite">
		{total === 0 ? 0 : Math.min((page - 1) * pageSize + 1, total)}–{Math.min(
			page * pageSize,
			total
		)} of {total}
	</p>
	<div class="flex items-center gap-4">
		{#if page > 1}<a
				class="font-medium underline-offset-4 hover:underline"
				href={pageHref(currentPage.url, page - 1)}>Previous</a
			>{/if}
		<span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
		{#if page * pageSize < total}<a
				class="font-medium underline-offset-4 hover:underline"
				href={pageHref(currentPage.url, page + 1)}>Next</a
			>{/if}
	</div>
</nav>
