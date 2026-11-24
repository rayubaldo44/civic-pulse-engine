<script lang="ts">
	// ── Theme Toggle ─────────────────────────────────────────────────────────
	// Persists choice to localStorage('civic-pulse-theme'). Reads/writes the
	// `dark` class on <html> (set early in app.html to avoid FOUC).
	//
	// Behaviour:
	//   • default → follow system via prefers-color-scheme
	//   • explicit 'light' / 'dark' → force that theme, persist it
	let { class: className = '' } = $props();

	let isDark = $state(
		typeof document !== 'undefined' &&
			(document.documentElement.classList.contains('dark') ||
				localStorage.getItem('civic-pulse-theme') === 'dark')
	);

	$effect(() => {
		document.documentElement.classList.toggle('dark', isDark);
		try {
			localStorage.setItem('civic-pulse-theme', isDark ? 'dark' : 'light');
		} catch (_) {}
	});
</script>

<button
	type="button"
	role="switch"
	aria-checked={isDark}
	aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
	title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
	onclick={() => (isDark = !isDark)}
	class="flex flex-1 items-center justify-center rounded-md p-2.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 {className}"
>
	{#if isDark}
		<!-- Sun -->
		<svg
			class="h-4 w-4"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<circle cx="12" cy="12" r="4" />
			<path
				d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
			/>
		</svg>
	{:else}
		<!-- Moon -->
		<svg
			class="h-4 w-4"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
		</svg>
	{/if}
</button>
