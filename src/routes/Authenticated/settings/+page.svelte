<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { CATEGORY_LABELS, CATEGORY_DESCRIPTIONS, CATEGORY_ORDER } from '$lib/types/notifications';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let lastSignIn = $derived(
		data.lastSignIn ? new Date(data.lastSignIn).toLocaleString() : 'Unknown'
	);

	let nameLoading = $state(false);
	let pwLoading = $state(false);
	let prefsLoading = $state(false);
	let prefs = $derived(data.notificationPrefs);
</script>

<div class="p-6 lg:p-8">
	<!-- Header -->
	<div class="mb-8">
		<PageHeader
			icon="settings"
			title="Settings"
			subtitle="Manage your profile and account security."
		/>
	</div>

	<div class="mx-auto max-w-2xl space-y-6">
		<!-- ── Session Info (read-only) ──────────────────────────────────────── -->
		<div class="card card-pad">
			<h2 class="mb-4 text-base font-semibold text-ink">Account</h2>
			<dl class="space-y-3 text-sm">
				<div class="flex items-center justify-between">
					<dt class="text-slate-500 dark:text-slate-400">Email</dt>
					<dd class="font-medium text-ink">{data.email}</dd>
				</div>
				<div class="flex items-center justify-between">
					<dt class="text-slate-500 dark:text-slate-400">Role</dt>
					<dd>
						<span
							class="rounded-full border border-signal-100 bg-signal-50 px-2.5 py-0.5 text-xs font-bold tracking-wide text-signal-600 uppercase dark:border-signal-900/60 dark:bg-signal-950/60 dark:text-signal-400"
						>
							{data.role}
						</span>
					</dd>
				</div>
				<div class="flex items-center justify-between">
					<dt class="text-slate-500 dark:text-slate-400">Last sign-in</dt>
					<dd class="text-slate-500 tabular-nums dark:text-slate-400">{lastSignIn}</dd>
				</div>
			</dl>
		</div>

		<!-- ── Display Name ───────────────────────────────────────────────────── -->
		<div class="card card-pad">
			<h2 class="mb-1 text-base font-semibold text-slate-700 dark:text-slate-200">Display Name</h2>
			<p class="mb-5 text-xs text-slate-400 dark:text-slate-500">
				Shown in the admin panel and activity logs.
			</p>

			<form
				method="POST"
				action="?/updateName"
				use:enhance={() => {
					nameLoading = true;
					return async ({ update }) => {
						await update();
						nameLoading = false;
					};
				}}
				class="space-y-4"
			>
				<div>
					<label
						for="full_name"
						class="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
					>
						Full name
					</label>
					<input
						id="full_name"
						name="full_name"
						type="text"
						value={data.fullName}
						maxlength="100"
						required
						class="input px-3 py-2"
					/>
				</div>

				{#if form?.nameError}
					<p class="text-xs text-rose-600 dark:text-rose-400">{form.nameError}</p>
				{/if}
				{#if form?.nameSuccess}
					<p class="text-xs text-emerald-600 dark:text-emerald-400">Display name updated.</p>
				{/if}

				<button type="submit" disabled={nameLoading} class="btn-primary px-4 py-2 text-sm">
					{nameLoading ? 'Saving…' : 'Save Name'}
				</button>
			</form>
		</div>

		<!-- ── Change Password ────────────────────────────────────────────────── -->
		<div class="card card-pad">
			<h2 class="mb-1 text-base font-semibold text-slate-700 dark:text-slate-200">
				Change Password
			</h2>
			<p class="mb-5 text-xs text-slate-400 dark:text-slate-500">
				Must be at least 12 characters with upper and lowercase letters, a number, and a special
				character.
			</p>

			<form
				method="POST"
				action="?/updatePassword"
				use:enhance={() => {
					pwLoading = true;
					return async ({ update }) => {
						await update();
						pwLoading = false;
					};
				}}
				class="space-y-4"
			>
				<div>
					<label
						for="current_password"
						class="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
					>
						Current password
					</label>
					<input
						id="current_password"
						name="current_password"
						type="password"
						autocomplete="current-password"
						required
						class="input px-3 py-2"
					/>
				</div>

				<div>
					<label
						for="new_password"
						class="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
					>
						New password
					</label>
					<input
						id="new_password"
						name="new_password"
						type="password"
						autocomplete="new-password"
						minlength="8"
						required
						class="input px-3 py-2"
					/>
				</div>

				<div>
					<label
						for="confirm_password"
						class="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400"
					>
						Confirm new password
					</label>
					<input
						id="confirm_password"
						name="confirm_password"
						type="password"
						autocomplete="new-password"
						minlength="8"
						required
						class="input px-3 py-2"
					/>
				</div>

				{#if form?.pwError}
					<p class="text-xs text-rose-600 dark:text-rose-400">{form.pwError}</p>
				{/if}
				{#if form?.pwSuccess}
					<p class="text-xs text-emerald-600 dark:text-emerald-400">
						Password updated successfully.
					</p>
				{/if}

				<button type="submit" disabled={pwLoading} class="btn-primary px-4 py-2 text-sm">
					{pwLoading ? 'Updating…' : 'Update Password'}
				</button>
			</form>
		</div>

		<!-- ── Notifications ────────────────────────────────────────────────────── -->
		<form
			method="POST"
			action="?/updatePrefs"
			use:enhance={() => {
				prefsLoading = true;
				return async ({ update }) => {
					await update();
					prefsLoading = false;
				};
			}}
			class="card card-pad"
		>
			<h2 class="mb-1 text-base font-semibold text-slate-700 dark:text-slate-200">Notifications</h2>
			<p class="mb-5 text-xs text-slate-400 dark:text-slate-500">
				Choose which channels alert you when an issue topic's priority score changes.
			</p>

			<!-- Master switches. A channel turned off here mutes every category
			     below; the per-category toggles then re-enable individual
			     categories within a live channel. Mirrors isChannelEnabled()'s
			     AND semantics in $lib/types/notifications.ts. -->
			<div class="mb-5 space-y-2 rounded-lg border border-line p-4">
				<label class="flex cursor-pointer items-center justify-between gap-3 text-sm">
					<span>
						<span class="font-semibold text-ink">In-app notifications</span>
						<span class="block text-xs text-ink-muted"> Show alerts in the sidebar bell. </span>
					</span>
					<input
						type="checkbox"
						name="in_app"
						checked={prefs.in_app}
						class="rounded border-line text-signal-600 focus:ring-signal-300 dark:border-slate-600 dark:bg-slate-800"
					/>
				</label>
				<label
					class="flex cursor-pointer items-center justify-between gap-3 border-t border-line pt-3 text-sm"
				>
					<span>
						<span class="font-semibold text-ink">Email notifications</span>
						<span class="block text-xs text-ink-muted">
							Send alerts to your account email address.
						</span>
					</span>
					<input
						type="checkbox"
						name="email"
						checked={prefs.email}
						class="rounded border-line text-signal-600 focus:ring-signal-300 dark:border-slate-600 dark:bg-slate-800"
					/>
				</label>
			</div>

			<div class="space-y-4">
				{#each CATEGORY_ORDER as category (category)}
					{@const entry = prefs.categories[category]}
					<fieldset class="rounded-lg border border-line p-4">
						<legend class="px-1 text-sm font-semibold text-ink">
							{CATEGORY_LABELS[category]}
						</legend>
						<p class="mb-3 text-xs text-ink-muted">{CATEGORY_DESCRIPTIONS[category]}</p>

						<div class="flex flex-wrap gap-5">
							<label
								class="flex items-center gap-2 text-sm text-ink {prefs.in_app
									? 'cursor-pointer'
									: 'cursor-not-allowed opacity-50'}"
							>
								<input
									type="checkbox"
									name={`cat_${category}_in_app`}
									checked={entry.in_app}
									disabled={!prefs.in_app}
									onchange={(e) => {
										prefs.categories[category].in_app = e.currentTarget.checked;
									}}
									class="rounded border-line text-signal-600 focus:ring-signal-300 dark:border-slate-600 dark:bg-slate-800"
								/>
								In-app
							</label>
							<label
								class="flex items-center gap-2 text-sm text-ink {prefs.email
									? 'cursor-pointer'
									: 'cursor-not-allowed opacity-50'}"
							>
								<input
									type="checkbox"
									name={`cat_${category}_email`}
									checked={entry.email}
									disabled={!prefs.email}
									onchange={(e) => {
										prefs.categories[category].email = e.currentTarget.checked;
									}}
									class="rounded border-line text-signal-600 focus:ring-signal-300 dark:border-slate-600 dark:bg-slate-800"
								/>
								Email
							</label>
						</div>
					</fieldset>
				{/each}
			</div>

			{#if form?.prefsError}
				<p class="mt-4 text-xs text-rose-600 dark:text-rose-400">{form.prefsError}</p>
			{/if}
			{#if form?.prefsSuccess}
				<p class="mt-4 text-xs text-emerald-600 dark:text-emerald-400">
					Notification settings updated.
				</p>
			{/if}

			<button type="submit" disabled={prefsLoading} class="btn-primary mt-5 px-4 py-2 text-sm">
				{prefsLoading ? 'Saving…' : 'Save Preferences'}
			</button>
		</form>
	</div>
</div>
