<script lang="ts">
	import { enhance } from '$app/forms';
	import { env } from '$env/dynamic/public';
	import ConsolePanel from '$lib/components/ConsolePanel.svelte';

	// Preconnect target: same origin the auth POST hits at sign-in.
	const supabaseOrigin = new URL(env.PUBLIC_SUPABASE_URL).origin;

	let {
		data,
		form
	}: {
		data: { invalidInviteLink: boolean; passwordSet: boolean };
		form: { error?: string; email?: string } | null;
	} = $props();
	let loading = $state(false);
	let loginStatus = $state('');

	// Product scope — factual, bounded statements shared with the landing page.
	const METRICS = [
		{ value: 18, suffix: '', label: 'barangays represented in the geographic analysis model' },
		{ value: 5, suffix: '-step', label: 'verification pipeline from ingestion to human review' },
		{ value: 3, suffix: '', label: 'languages supported: Tagalog, English, and Taglish' }
	];
</script>

<svelte:head>
	<link rel="preconnect" href={supabaseOrigin} />
	<link rel="dns-prefetch" href={supabaseOrigin} />
</svelte:head>

<div class="relative min-h-dvh overflow-clip">
	<!-- Subtle signal gradient overlay -->
	<div
		class="pointer-events-none fixed inset-0"
		style="background: radial-gradient(ellipse at top left, rgba(13,107,77,0.06) 0%, transparent 60%), radial-gradient(ellipse at bottom right, rgba(13,107,77,0.06) 0%, transparent 60%);"
	></div>

	<div
		class="relative mx-auto grid min-h-dvh w-full max-w-7xl grid-cols-1 items-center gap-12 px-6 py-12 md:px-10 lg:grid-cols-[1.15fr_1fr] lg:items-start lg:gap-20 lg:py-0"
	>
		<!-- Brand + "Why it matters." impact metrics -->
		<aside class="order-2 w-full lg:order-1 lg:py-16">
			<div class="animate-slide-up">
				<div class="flex items-center gap-3">
					<div
						class="inline-flex items-center justify-center rounded-xl border border-signal-100 bg-surface p-2 shadow-sm dark:border-signal-900/50 dark:bg-signal-950/50"
					>
						<img
							src="/img/civic-pulse-mark.png"
							alt=""
							aria-hidden="true"
							class="h-6 w-6 object-contain dark:brightness-150"
							width="24"
							height="24"
						/>
					</div>
					<span class="font-display text-2xl leading-none text-ink dark:text-slate-100">
						Civic Pulse
					</span>
					<span
						class="hidden font-mono text-[11px] tracking-[0.18em] text-ink-faint uppercase sm:inline"
					>
						Pulilan LGU Intelligence Engine
					</span>
				</div>

				<div class="mt-10 lg:mt-14">
					<span class="hero-kicker">
						<span class="pulse-dot bg-signal-600 dark:bg-signal-400"></span>
						Municipal signal intelligence
					</span>
					<h1
						class="font-display text-[2.75rem] leading-[1.05] tracking-tight text-ink md:text-5xl lg:text-[3.25rem] dark:text-slate-100"
					>
						Why it matters<i class="text-signal-600 dark:text-signal-400">.</i>
					</h1>
					<p class="mt-4 max-w-md text-base leading-relaxed text-ink-muted">
						Public discourse is a civic signal. The engine turns it into verified, actionable
						intelligence across three documented measures.
					</p>

					<div
						class="mt-10 grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-3 md:gap-x-8"
						role="group"
						aria-label="Impact metrics"
					>
						{#each METRICS as m, i (m.label)}
							<div class="border-t border-line pt-4">
								<span class="font-mono text-[11px] tracking-[0.18em] text-ink-faint">
									{String(i + 1).padStart(2, '0')}
								</span>
								<div class="mt-2 flex items-baseline gap-1.5">
									<span class="metric-num">{Intl.NumberFormat('en-PH').format(m.value)}</span>
									{#if m.suffix}
										<span
											class="font-mono text-lg font-medium text-signal-600 md:text-xl dark:text-signal-400"
											aria-hidden="true">{m.suffix}</span
										>
									{/if}
								</div>
								<p class="mt-1.5 text-sm leading-snug text-ink-muted">{m.label}</p>
							</div>
						{/each}
					</div>
				</div>

				<div class="mt-10 lg:mt-12">
					<div class="relative">
						<div class="graticule" aria-hidden="true"></div>
						<div class="scope-frame">
							<div class="scope-channel">
								<span
									class="font-mono text-[11px] font-semibold tracking-widest text-ink-faint uppercase"
									>Sample analysis console</span
								>
								<span
									class="flex items-center gap-1.5 font-mono text-[10px] text-signal-600 dark:text-signal-400"
								>
									<span class="pulse-dot bg-signal-600 dark:bg-signal-400"></span>
									Signal
								</span>
							</div>
							<ConsolePanel flushed />
						</div>
					</div>
					<p class="hero-trust">
						<span>Hashed author identifiers</span>
						<span aria-hidden="true">·</span>
						<span>Human-in-the-loop review</span>
						<span aria-hidden="true">·</span>
						<span>18-barangay geographic model</span>
					</p>
				</div>
			</div>
		</aside>

		<!-- Authentication -->
		<main
			class="order-1 w-full md:max-w-md lg:sticky lg:top-0 lg:order-2 lg:flex lg:h-dvh lg:flex-col lg:justify-center lg:justify-self-end"
		>
			<div class="animate-slide-up">
				<a
					href="/"
					class="mb-6 inline-flex min-h-11 items-center gap-1.5 py-2 font-mono text-[11px] tracking-[0.18em] text-ink-faint uppercase transition-colors hover:text-signal-600 dark:hover:text-signal-400"
				>
					<svg
						class="h-3.5 w-3.5"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15 19l-7-7 7-7"
						/>
					</svg>
					Back to home
				</a>

				<div
					class="overflow-hidden rounded-xl border border-line bg-surface/90 shadow-md backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/80"
				>
					<!-- Top accent bar -->
					<div class="h-1.5 bg-signal-600 dark:bg-signal-500"></div>

					<div class="px-6 pt-6 pb-2">
						<h2 class="text-xl font-semibold text-ink dark:text-slate-100">Authentication</h2>
						<p class="mt-1 text-sm text-ink-muted">
							Enter your credentials to access the dashboard
						</p>
					</div>

					{#if data.passwordSet}
						<div
							role="status"
							aria-live="polite"
							class="mx-6 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-500/20 dark:bg-emerald-500/10"
						>
							<svg
								class="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							<p class="text-sm text-emerald-700 dark:text-emerald-400">
								Password set successfully. Please sign in with your new password.
							</p>
						</div>
					{:else if data.invalidInviteLink}
						<div
							role="alert"
							class="mx-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-500/20 dark:bg-amber-500/10"
						>
							<svg
								class="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
								/>
							</svg>
							<p class="text-sm text-amber-700 dark:text-amber-400">
								This invite link is invalid or has expired. Please ask your administrator to send a
								new invitation.
							</p>
						</div>
					{/if}

					<form
						method="POST"
						aria-busy={loading}
						use:enhance={() => {
							loading = true;
							loginStatus = 'Checking your account…';
							return async ({ update, result }) => {
								// Keep the busy state through the redirect response. Clearing it
								// before update() restores the form during the navigation handoff.
								if (result.type === 'redirect') loginStatus = 'Opening your dashboard…';
								try {
									await update();
								} finally {
									loading = false;
									loginStatus = '';
								}
							};
						}}
						class="space-y-4 px-6 pt-4 pb-6"
					>
						<!-- Email -->
						<div class="space-y-1.5">
							<label for="email" class="label">Official Email</label>
							<div class="relative">
								<svg
									class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
									/>
								</svg>
								<input
									id="email"
									name="email"
									type="email"
									required
									autocomplete="username"
									inputmode="email"
									autocapitalize="none"
									spellcheck="false"
									value={form?.email ?? ''}
									aria-invalid={form?.error ? 'true' : undefined}
									aria-describedby={form?.error ? 'login-error' : 'email-help'}
									placeholder="name@pulilan.gov.ph"
									class="input min-h-11 rounded-xl py-2.5 pr-4 pl-10 text-base"
								/>
							</div>
							<p id="email-help" class="px-1 text-xs text-ink-faint">
								Use the account assigned by your LGU administrator.
							</p>
						</div>

						<!-- Password -->
						<div class="space-y-1.5">
							<label for="password" class="label">Password</label>
							<div class="relative">
								<svg
									class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
									/>
								</svg>
								<input
									id="password"
									name="password"
									type="password"
									required
									autocomplete="current-password"
									aria-invalid={form?.error ? 'true' : undefined}
									aria-describedby={form?.error ? 'login-error' : undefined}
									class="input min-h-11 rounded-xl py-2.5 pr-4 pl-10 text-base"
								/>
							</div>
						</div>

						<!-- Error message -->
						{#if form?.error}
							<div
								id="login-error"
								role="alert"
								aria-live="assertive"
								class="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 dark:border-rose-500/20 dark:bg-rose-500/10"
							>
								<svg
									class="h-4 w-4 shrink-0 text-rose-500"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
									/>
								</svg>
								<p class="text-sm text-rose-600 dark:text-rose-400">{form.error}</p>
							</div>
						{/if}

						<!-- Submit -->
						<div class="space-y-4 pt-2">
							<button
								type="submit"
								disabled={loading}
								class="btn-primary group flex h-11 w-full rounded-lg text-base"
							>
								{#if loading}
									<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
										<circle
											class="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											stroke-width="4"
										></circle>
										<path
											class="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
										></path>
									</svg>
									{loginStatus || 'Signing in…'}
								{:else}
									Sign In to Engine
									<svg
										class="h-4 w-4 transition-transform group-hover:translate-x-1"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M13 7l5 5m0 0l-5 5m5-5H6"
										/>
									</svg>
								{/if}
							</button>
							{#if loading}
								<p class="text-center text-xs text-ink-faint" aria-live="polite" aria-atomic="true">
									{loginStatus}
								</p>
							{/if}

							<p class="micro-label pt-1 text-center">Authorized Personnel Only</p>
						</div>
					</form>
				</div>

				<p class="mt-6 px-8 text-center text-xs leading-relaxed text-ink-faint">
					By logging in, you agree to the LGU Data Privacy Policy and terms of automated
					intelligence handling.
				</p>
			</div>
		</main>
	</div>
</div>
