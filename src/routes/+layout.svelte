<script lang="ts">
	import './layout.css';
	import '$lib/fonts.css';

	import { invalidate } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: any } = $props();

	onMount(() => {
		document.documentElement.dataset.sveltekitHydrated = 'true';
		const {
			data: { subscription }
		} = data.supabase.auth.onAuthStateChange((event, _session) => {
			// Skip the INITIAL_SESSION event that fires on hydration — the SSR
			// page is already rendered, so re-running every load function would
			// duplicate all server queries. Only invalidate on real changes.
			if (event === 'INITIAL_SESSION') return;
			// Re-run all load functions when auth state changes
			invalidate('supabase:auth');
		});

		return () => subscription.unsubscribe();
	});
</script>

<svelte:head><link rel="icon" type="image/png" href="/img/civic-pulse-mark.png" /></svelte:head>

{@render children()}
