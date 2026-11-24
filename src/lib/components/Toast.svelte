<script lang="ts">
	let visible = $state(false);
	let message = $state('');
	let title = $state('');
	let isError = $state(false);
	let timer: ReturnType<typeof setTimeout>;

	// Exposed via bind:this — call toast.show() from any parent component.
	// title and isError are optional; duration defaults to 3500 ms.
	export function show(msg: string, ttl = '', err = false, duration = 3500) {
		clearTimeout(timer);
		message = msg;
		title = ttl;
		isError = err;
		visible = true;
		timer = setTimeout(() => {
			visible = false;
		}, duration);
	}
</script>

{#if visible}
	<div class="animate-slide-up fixed right-6 bottom-6 z-50" role="status" aria-live="polite">
		<div
			class="flex max-w-sm items-center gap-3 rounded-xl border border-white/10 bg-slate-900 px-5 py-3.5 shadow-xl dark:border-line dark:bg-surface"
		>
			<!-- Icon -->
			<span class="shrink-0">
				{#if isError}
					<svg
						class="h-4 w-4 text-rose-400"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<circle cx="12" cy="12" r="10" />
						<line x1="15" y1="9" x2="9" y2="15" />
						<line x1="9" y1="9" x2="15" y2="15" />
					</svg>
				{:else}
					<svg
						class="h-4 w-4 text-emerald-400"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polyline points="20 6 9 17 4 12" />
					</svg>
				{/if}
			</span>

			<!-- Text -->
			<div>
				{#if title}
					<p
						class="micro-label mb-0.5
					          {isError ? 'text-rose-400' : 'text-slate-500 dark:text-slate-400'}"
					>
						{title}
					</p>
				{/if}
				<p class="text-sm text-slate-100 dark:text-ink">{message}</p>
			</div>
		</div>
	</div>
{/if}
