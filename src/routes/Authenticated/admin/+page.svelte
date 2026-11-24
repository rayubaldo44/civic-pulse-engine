<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Toast from '$lib/components/Toast.svelte';

	export let data: import('./$types').PageData;
	export let form: import('./$types').ActionData;

	// ── Server data ────────────────────────────────────────────────────────────
	$: config = data.config;
	$: personnel = data.personnel;
	$: currentUserId = data.currentUserId;

	// ── NLP Config state (initialised from DB) ─────────────────────────────────
	// Use data.config directly with fallbacks so SSR never hits undefined.
	let sensitivity = data.config?.flagging_sensitivity ?? 75;
	let codeswitching = data.config?.codeswitching_model ?? true;
	let sentiment = data.config?.contextual_sentiment ?? true;
	let spamFilter = data.config?.spam_filter ?? true;
	let configLoading = false;

	// ── Restart Services state ─────────────────────────────────────────────────
	let confirmRestart = false;
	let restartLoading = false;

	// ── Invite Personnel modal ─────────────────────────────────────────────────
	let isInviteOpen = false;
	let inviteFullName = '';
	let inviteEmail = '';
	let inviteRole = 'analyst';
	let inviteLoading = false;

	// ── Edit Personnel modal ───────────────────────────────────────────────────
	let isEditOpen = false;
	let editTargetId = '';
	let editFullName = '';
	let editRole = 'analyst';
	let editLoading = false;

	let toastRef: Toast;

	function openEditModal(p: { id: string; full_name: string; role: string }) {
		editTargetId = p.id;
		editFullName = p.full_name;
		editRole = p.role;
		isEditOpen = true;
	}

	function onBackdrop(e: MouseEvent, close: () => void) {
		if (e.target === e.currentTarget) close();
	}

	// ── React to form results ──────────────────────────────────────────────────
	$: if (form?.configSuccess) {
		toastRef?.show('NLP engine settings updated successfully.', 'Config Saved');
	}
	$: if (form?.configError) {
		toastRef?.show(form.configError as string, 'Save Failed', true);
	}
	$: if (form?.restartSuccess) {
		confirmRestart = false;
		toastRef?.show('Processing pipeline triggered successfully.', 'Services Restarted');
	}
	$: if (form?.restartError) {
		confirmRestart = false;
		toastRef?.show(form.restartError as string, 'Restart Failed', true);
	}
	$: if (form?.inviteSuccess) {
		isInviteOpen = false;
		inviteFullName = '';
		inviteEmail = '';
		inviteRole = 'analyst';
		toastRef?.show(`An invitation email was sent to ${form.invitedEmail}.`, 'Invite Sent');
	}
	$: if (form?.inviteError) {
		toastRef?.show(form.inviteError as string, 'Invite Failed', true);
	}
	$: if (form?.editPersonnelSuccess) {
		isEditOpen = false;
		toastRef?.show('Personnel record saved.', 'User Updated');
	}
	$: if (form?.editPersonnelError) {
		toastRef?.show(form.editPersonnelError as string, 'Update Failed', true);
	}

	// ── Helpers ────────────────────────────────────────────────────────────────
	function roleBadge(role: string) {
		return role === 'admin'
			? 'bg-signal-600 text-white border-transparent'
			: 'bg-surface text-ink-muted border-line dark:text-slate-300';
	}

	function formatDate(iso: string | null) {
		if (!iso) return 'Never';
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<div class="animate-fade-in mx-auto max-w-7xl space-y-8 p-8">
	<!-- ── Header ──────────────────────────────────────────────────────────── -->
	<PageHeader
		icon="admin"
		title="System Administration"
		subtitle="Manage NLP configurations, system health, and user access."
	>
		{#snippet right()}
			<span
				class="inline-flex items-center gap-1.5 rounded-md border border-signal-100 bg-signal-50 px-3 py-1.5 text-xs font-semibold text-signal-600 dark:border-signal-500/20 dark:bg-signal-500/10 dark:text-signal-400"
			>
				<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
					/>
				</svg>
				Admin Access Level
			</span>
		{/snippet}
	</PageHeader>

	<div class="grid grid-cols-1 gap-8 md:grid-cols-2">
		<!-- ── Card 1: NLP Engine Configuration ─────────────────────────────── -->
		<div class="card card-pad">
			<div class="mb-5">
				<h3
					class="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-slate-100"
				>
					<svg
						class="h-5 w-5 text-signal-500"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M13 10V3L4 14h7v7l9-11h-7z"
						/>
					</svg>
					NLP Engine Configuration
				</h3>
				<p class="mt-1 text-sm text-gray-500 dark:text-slate-400">
					Adjust the core parameters of the text analysis models.
				</p>
				{#if config?.updated_at}
					<p class="telemetry mt-1">Last saved: {formatDate(config?.updated_at ?? null)}</p>
				{/if}
			</div>

			<form
				method="POST"
				action="?/saveConfig"
				use:enhance={() => {
					configLoading = true;
					return async ({ update }) => {
						await update();
						configLoading = false;
					};
				}}
			>
				<!-- Hidden inputs carry the toggle states into the form POST -->
				<input type="hidden" name="flagging_sensitivity" value={sensitivity} />
				<input type="hidden" name="codeswitching_model" value={String(codeswitching)} />
				<input type="hidden" name="contextual_sentiment" value={String(sentiment)} />
				<input type="hidden" name="spam_filter" value={String(spamFilter)} />

				<div class="space-y-6">
					<!-- Flagging Sensitivity slider -->
					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<div>
								<h4 class="text-sm font-semibold text-gray-800 dark:text-slate-200">
									Flagging Sensitivity
								</h4>
								<p class="text-xs text-gray-400 dark:text-slate-500">
									Threshold for marking potential misinformation.
								</p>
							</div>
							<span class="font-mono text-sm font-bold text-signal-600">{sensitivity}%</span>
						</div>
						<input
							type="range"
							min="0"
							max="100"
							step="1"
							bind:value={sensitivity}
							class="h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-signal-600 dark:bg-slate-700 dark:accent-signal-500"
						/>
						<div class="flex justify-between text-xs text-gray-400 dark:text-slate-500">
							<span>Permissive (0%)</span>
							<span>Strict (100%)</span>
						</div>
					</div>

					<!-- Toggle switches -->
					<div class="space-y-4 border-t border-gray-100 pt-4 dark:border-slate-800">
						<!-- Code-Switching Model -->
						<div class="flex items-center justify-between">
							<div>
								<h4 class="text-sm font-semibold text-gray-800 dark:text-slate-200">
									Code-Switching Model (Tag/Eng)
								</h4>
								<p class="text-xs text-gray-400 dark:text-slate-500">
									Handles mixed Tagalog-English inputs.
								</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={codeswitching}
								aria-label="Toggle Code-Switching Model"
								on:click={() => (codeswitching = !codeswitching)}
								class="toggle-switch"
							>
								<span
									class="toggle-switch-knob"
									class:translate-x-5={codeswitching}
									class:translate-x-0={!codeswitching}
								></span>
							</button>
						</div>

						<!-- Contextual Sentiment Analysis -->
						<div class="flex items-center justify-between">
							<div>
								<h4 class="text-sm font-semibold text-gray-800 dark:text-slate-200">
									Contextual Sentiment Analysis
								</h4>
								<p class="text-xs text-gray-400 dark:text-slate-500">
									Deep sentiment parsing beyond keyword matching.
								</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={sentiment}
								aria-label="Toggle Contextual Sentiment Analysis"
								on:click={() => (sentiment = !sentiment)}
								class="toggle-switch"
							>
								<span
									class="toggle-switch-knob"
									class:translate-x-5={sentiment}
									class:translate-x-0={!sentiment}
								></span>
							</button>
						</div>

						<!-- Automated Spam Filtering -->
						<div class="flex items-center justify-between">
							<div>
								<h4 class="text-sm font-semibold text-gray-800 dark:text-slate-200">
									Automated Spam Filtering
								</h4>
								<p class="text-xs text-gray-400 dark:text-slate-500">
									Discards bot-like and low-signal inputs.
								</p>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={spamFilter}
								aria-label="Toggle Automated Spam Filtering"
								on:click={() => (spamFilter = !spamFilter)}
								class="toggle-switch"
							>
								<span
									class="toggle-switch-knob"
									class:translate-x-5={spamFilter}
									class:translate-x-0={!spamFilter}
								></span>
							</button>
						</div>
					</div>

					<!-- Save button -->
					<div class="pt-2">
						<button type="submit" disabled={configLoading} class="btn-primary w-full">
							{#if configLoading}
								<span
									class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
								></span>
								Saving…
							{:else}
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M5 13l4 4L19 7"
									/>
								</svg>
								Save Configuration
							{/if}
						</button>
					</div>
				</div>
			</form>
		</div>

		<!-- ── Card 2: System Health & Restart ──────────────────────────────── -->
		<div class="card card-pad">
			<div class="mb-5">
				<h3
					class="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-slate-100"
				>
					<svg class="h-5 w-5 text-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
						/>
					</svg>
					System Health &amp; Integrations
				</h3>
				<p class="mt-1 text-sm text-gray-500 dark:text-slate-400">
					Live status of data feeds and internal databases.
				</p>
			</div>

			<div class="space-y-6">
				<!-- Status rows -->
				<div class="space-y-3">
					{#each [{ label: 'Vector Database', status: 'Operational', color: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' }, { label: 'Simulated Data Stream Pipeline', status: 'Active (12 req/m)', color: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' }, { label: 'LGU Official API Bridge', status: 'Degraded', color: 'bg-amber-50  text-amber-600  border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20' }] as item}
						<div
							class="flex items-center justify-between rounded-lg border border-line bg-gray-50 p-3 dark:bg-slate-800/40"
						>
							<div class="flex items-center gap-3">
								<svg
									class="h-4 w-4 text-ink-faint"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
									/>
								</svg>
								<span class="text-sm font-medium text-ink">{item.label}</span>
							</div>
							<span
								class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold {item.color}"
							>
								{#if item.status === 'Operational' || item.status.startsWith('Active')}
									<span class="pulse-dot bg-emerald-500"></span>
								{/if}
								{item.status}
							</span>
						</div>
					{/each}
				</div>

				<!-- Restart Services — requires confirmation -->
				<form
					method="POST"
					action="?/restartServices"
					use:enhance={() => {
						restartLoading = true;
						return async ({ update }) => {
							await update();
							restartLoading = false;
						};
					}}
				>
					{#if confirmRestart}
						<div
							class="space-y-3 rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-500/20 dark:bg-rose-500/10"
						>
							<p class="text-sm font-medium text-rose-700 dark:text-rose-400">
								This will re-trigger the NLP processing pipeline on all pending comments. Continue?
							</p>
							<div class="flex gap-2">
								<button
									type="button"
									on:click={() => (confirmRestart = false)}
									class="btn-secondary flex-1"
								>
									Cancel
								</button>
								<button type="submit" disabled={restartLoading} class="btn-danger flex-1">
									{#if restartLoading}
										<span
											class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
										></span>
										Restarting…
									{:else}
										Confirm Restart
									{/if}
								</button>
							</div>
						</div>
					{:else}
						<button
							type="button"
							on:click={() => (confirmRestart = true)}
							class="btn-danger w-full"
						>
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728M12 8v4l3 3"
								/>
							</svg>
							Restart Services
						</button>
					{/if}
				</form>
			</div>
		</div>

		<!-- ── Card 3: Authorized Personnel ─────────────────────────────────── -->
		<div class="card card-pad md:col-span-2">
			<div class="mb-5 flex items-start justify-between">
				<div>
					<h3
						class="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-slate-100"
					>
						<svg
							class="h-5 w-5 text-signal-500"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
							/>
						</svg>
						Authorized Personnel
					</h3>
					<p class="mt-1 text-sm text-gray-500 dark:text-slate-400">
						Manage analysts and administrators. Invitations are sent by email.
					</p>
				</div>
				<button type="button" on:click={() => (isInviteOpen = true)} class="btn-secondary">
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 4v16m8-8H4"
						/>
					</svg>
					Add Personnel
				</button>
			</div>

			<div class="overflow-hidden rounded-lg border border-gray-200/70 dark:border-slate-700/70">
				<table class="w-full text-sm">
					<thead class="bg-gray-50 text-gray-500 dark:bg-slate-800/60 dark:text-slate-400">
						<tr>
							<th class="px-4 py-3 text-left font-medium">Name</th>
							<th class="px-4 py-3 text-left font-medium">Email</th>
							<th class="px-4 py-3 text-left font-medium">Role</th>
							<th class="px-4 py-3 text-left font-medium">Last Sign-in</th>
							<th class="px-4 py-3 text-right font-medium">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100 dark:divide-slate-800">
						{#each personnel as person (person.id)}
							<tr
								class="bg-white transition-colors hover:bg-gray-50 dark:bg-slate-900 dark:hover:bg-slate-800/50"
							>
								<td class="px-4 py-3 font-medium text-gray-800 dark:text-slate-200">
									{person.full_name}
									{#if person.id === currentUserId}
										<span class="ml-1.5 text-xs text-gray-400 dark:text-slate-500">(you)</span>
									{/if}
								</td>
								<td class="px-4 py-3 text-gray-400 dark:text-slate-500">{person.email}</td>
								<td class="px-4 py-3">
									<span
										class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold {roleBadge(
											person.role
										)}"
									>
										{person.role === 'admin' ? 'Admin' : 'Analyst'}
									</span>
								</td>
								<td class="px-4 py-3 text-xs text-gray-400 dark:text-slate-500"
									>{formatDate(person.last_sign_in)}</td
								>
								<td class="px-4 py-3 text-right">
									<button
										type="button"
										disabled={person.id === currentUserId}
										on:click={() => openEditModal(person)}
										class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors
{person.id === currentUserId
											? 'cursor-not-allowed text-gray-300 dark:text-slate-600'
											: 'text-gray-600 hover:bg-gray-100 hover:text-gray-800 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'}"
									>
										Edit
									</button>
								</td>
							</tr>
						{:else}
							<tr>
								<td
									colspan="5"
									class="px-4 py-8 text-center text-sm text-gray-400 dark:text-slate-500"
								>
									No personnel records found.
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
</div>

<!-- ── Invite Personnel Modal ─────────────────────────────────────────────── -->
{#if isInviteOpen}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
		on:click={(e) => onBackdrop(e, () => (isInviteOpen = false))}
	>
		<div class="animate-zoom-in card mx-4 w-full max-w-md overflow-hidden">
			<div class="border-b border-line p-6">
				<h2 class="text-lg font-semibold text-gray-900 dark:text-slate-100">
					Invite New Personnel
				</h2>
				<p class="mt-1 text-sm text-gray-500 dark:text-slate-400">
					An invitation email will be sent. The user sets their own password on first login.
				</p>
			</div>

			<form
				method="POST"
				action="?/invitePersonnel"
				use:enhance={() => {
					inviteLoading = true;
					return async ({ update }) => {
						await update();
						inviteLoading = false;
					};
				}}
			>
				<div class="space-y-4 p-6">
					<div class="space-y-1.5">
						<label for="inv-name" class="label">
							Full Name <span class="text-rose-500 dark:text-rose-400">*</span>
						</label>
						<input
							id="inv-name"
							name="full_name"
							type="text"
							bind:value={inviteFullName}
							required
							placeholder="e.g. Juan dela Cruz"
							class="input"
						/>
					</div>

					<div class="space-y-1.5">
						<label for="inv-email" class="label">
							Email Address <span class="text-rose-500 dark:text-rose-400">*</span>
						</label>
						<input
							id="inv-email"
							name="email"
							type="email"
							bind:value={inviteEmail}
							required
							placeholder="analyst@pulilan.gov.ph"
							class="input"
						/>
					</div>

					<div class="space-y-1.5">
						<label for="inv-role" class="label">
							Role <span class="text-rose-500 dark:text-rose-400">*</span>
						</label>
						<select
							id="inv-role"
							name="role"
							bind:value={inviteRole}
							class="input [&_option]:bg-slate-800 [&_option]:text-slate-200"
						>
							<option value="analyst">Analyst</option>
							<option value="admin">Admin</option>
						</select>
						<p class="text-xs text-gray-400 dark:text-slate-500">
							Admins have full system access. Analysts can view and review flagged content.
						</p>
					</div>

					{#if form?.inviteError}
						<p
							class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400"
						>
							{form.inviteError}
						</p>
					{/if}
				</div>

				<div class="flex justify-end gap-3 p-6 pt-0">
					<button type="button" on:click={() => (isInviteOpen = false)} class="btn-secondary">
						Cancel
					</button>
					<button type="submit" disabled={inviteLoading} class="btn-primary">
						{#if inviteLoading}
							<span
								class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
							></span>
							Sending…
						{:else}
							Send Invitation
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- ── Edit Personnel Modal ───────────────────────────────────────────────── -->
{#if isEditOpen}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
		on:click={(e) => onBackdrop(e, () => (isEditOpen = false))}
	>
		<div class="animate-zoom-in card mx-4 w-full max-w-sm overflow-hidden">
			<div class="border-b border-line p-6">
				<h2 class="text-lg font-semibold text-gray-900 dark:text-slate-100">Edit Personnel</h2>
				<p class="mt-1 text-sm text-gray-500 dark:text-slate-400">
					Changes take effect on the user's next sign-in.
				</p>
			</div>

			<form
				method="POST"
				action="?/editPersonnel"
				use:enhance={() => {
					editLoading = true;
					return async ({ update }) => {
						await update();
						editLoading = false;
					};
				}}
			>
				<input type="hidden" name="target_id" value={editTargetId} />

				<div class="space-y-4 p-6">
					<div class="space-y-1.5">
						<label for="edit-name" class="label">
							Full Name <span class="text-rose-500 dark:text-rose-400">*</span>
						</label>
						<input
							id="edit-name"
							name="full_name"
							type="text"
							bind:value={editFullName}
							required
							class="input"
						/>
					</div>

					<div class="space-y-1.5">
						<label for="edit-role" class="label">Role</label>
						<select
							id="edit-role"
							name="role"
							bind:value={editRole}
							class="input [&_option]:bg-slate-800 [&_option]:text-slate-200"
						>
							<option value="analyst">Analyst</option>
							<option value="admin">Admin</option>
						</select>
					</div>

					{#if form?.editPersonnelError}
						<p
							class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400"
						>
							{form.editPersonnelError}
						</p>
					{/if}
				</div>

				<div class="flex justify-end gap-3 p-6 pt-0">
					<button type="button" on:click={() => (isEditOpen = false)} class="btn-secondary">
						Cancel
					</button>
					<button type="submit" disabled={editLoading} class="btn-primary">
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
			</form>
		</div>
	</div>
{/if}

<Toast bind:this={toastRef} />

<style>
	.animate-zoom-in {
		animation: zoomIn 0.2s ease-out both;
	}

	/* Opacity-only — see CONTEXT.md gotcha: transform on this wrapper would
	   trap position:fixed modals/toasts to the document container. */
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

	input[type='range']::-webkit-slider-runnable-track {
		height: 8px;
		border-radius: 9999px;
		background: var(--color-line);
	}
	:global(.dark) :global(input[type='range'])::-webkit-slider-runnable-track {
		background: var(--color-line);
	}
	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		height: 18px;
		width: 18px;
		border-radius: 9999px;
		background: var(--color-signal-600);
		margin-top: -5px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
		cursor: pointer;
	}
	:global(.dark) :global(input[type='range'])::-webkit-slider-thumb {
		background: var(--color-signal-500);
	}
	input[type='range']::-moz-range-thumb {
		height: 18px;
		width: 18px;
		border-radius: 9999px;
		background: var(--color-signal-600);
		border: none;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
		cursor: pointer;
	}
	:global(.dark) :global(input[type='range'])::-moz-range-thumb {
		background: var(--color-signal-500);
	}
</style>
