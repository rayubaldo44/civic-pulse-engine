<script lang="ts">
	import { enhance } from '$app/forms';

	let {
		data,
		form
	}: { data: { maskedEmail: string; fullName: string }; form: { error?: string } | null } =
		$props();

	let loading = $state(false);
	let showPassword = $state(false);
	let showConfirm = $state(false);
</script>

<div class="flex min-h-screen w-full items-center justify-center p-4">
	<!-- Subtle signal gradient overlay -->
	<div
		class="pointer-events-none fixed inset-0"
		style="background: radial-gradient(ellipse at top left, rgba(13,107,77,0.06) 0%, transparent 60%), radial-gradient(ellipse at bottom right, rgba(13,107,77,0.06) 0%, transparent 60%);"
	></div>

	<div class="animate-slide-up relative w-full max-w-100 space-y-8">
		<!-- Logo + title -->
		<div class="space-y-3 text-center">
			<div
				class="mx-auto inline-flex items-center justify-center rounded-xl border border-signal-100 bg-surface p-3 text-signal-500 shadow-sm dark:border-signal-900/50 dark:bg-signal-950/50 dark:text-signal-400"
			>
				<img
					src="/img/civic-pulse-mark.png"
					alt=""
					class="h-8 w-8 object-contain dark:brightness-150"
					width="32"
					height="32"
				/>
			</div>
			<h1
				class="font-display text-[2.5rem] leading-none tracking-tight text-ink dark:text-slate-100"
			>
				Civic Pulse
			</h1>
			<p class="font-medium text-ink-muted">Set Your Password</p>
		</div>

		<!-- Card -->
		<div
			class="overflow-hidden rounded-xl border border-line bg-surface/90 shadow-md backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/80"
		>
			<!-- Top accent bar -->
			<div class="h-1.5 w-full bg-signal-600 dark:bg-signal-500"></div>

			<div class="px-6 pt-6 pb-2">
				<h2 class="text-xl font-semibold text-ink dark:text-slate-100">First-Time Setup</h2>
				<p class="mt-1 text-sm text-ink-muted">
					Choose a password for <span class="font-medium text-ink dark:text-slate-300"
						>{data.maskedEmail}</span
					>
					to finish activating your account{#if data.fullName}, {data.fullName}{/if}.
				</p>
			</div>

			<form
				method="POST"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						loading = false;
						await update();
					};
				}}
				class="space-y-4 px-6 pt-4 pb-6"
			>
				<!-- New password -->
				<div class="space-y-1.5">
					<label for="password" class="label">New Password</label>
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
							type={showPassword ? 'text' : 'password'}
							required
							minlength={12}
							autocomplete="new-password"
							class="input rounded-xl py-2.5 pr-11 pl-10"
						/>
						<button
							type="button"
							aria-label={showPassword ? 'Hide password' : 'Show password'}
							onclick={() => (showPassword = !showPassword)}
							class="absolute top-1/2 right-3 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
						>
							{#if showPassword}
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
									/>
								</svg>
							{:else}
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
									/>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
									/>
								</svg>
							{/if}
						</button>
					</div>
					<ul class="list-inside list-disc space-y-0.5 px-1 text-xs text-ink-faint">
						<li>At least 12 characters</li>
						<li>Upper and lowercase letters, a number, and a special character</li>
					</ul>
				</div>

				<!-- Confirm password -->
				<div class="space-y-1.5">
					<label for="confirm_password" class="label">Confirm Password</label>
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
								d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<input
							id="confirm_password"
							name="confirm_password"
							type={showConfirm ? 'text' : 'password'}
							required
							minlength={12}
							autocomplete="new-password"
							class="input rounded-xl py-2.5 pr-11 pl-10"
						/>
						<button
							type="button"
							aria-label={showConfirm ? 'Hide confirmation' : 'Show confirmation'}
							onclick={() => (showConfirm = !showConfirm)}
							class="absolute top-1/2 right-3 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
						>
							{#if showConfirm}
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
									/>
								</svg>
							{:else}
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
									/>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
									/>
								</svg>
							{/if}
						</button>
					</div>
				</div>

				<!-- Error message -->
				{#if form?.error}
					<div
						class="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 dark:border-rose-500/20 dark:bg-rose-500/10"
					>
						<svg
							class="mt-0.5 h-4 w-4 shrink-0 text-rose-500"
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
							Saving...
						{:else}
							Set Password &amp; Continue
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

					<p class="text-center text-xs leading-relaxed text-ink-faint">
						After setting your password you will be returned to the sign-in page.
					</p>
				</div>
			</form>
		</div>

		<p class="micro-label text-center">Authorized Personnel Only</p>
	</div>
</div>
