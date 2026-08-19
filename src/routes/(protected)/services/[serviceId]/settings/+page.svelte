<script lang="ts">
	import {
		AlertTriangle,
		Check,
		ChevronDown,
		Loader2,
		Lock,
		Settings,
		Trash2,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { title } from "$lib/store/title";
	import type { ActionData, PageData } from "./$types";

	const { data, form }: { data: PageData; form: ActionData } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Settings`));

	const input =
		"w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";
	const label = "block mb-1.5 text-sm font-medium text-[var(--color-text)]";
	const errorClass = "mt-1.5 text-xs text-red-500";

	const values = $derived(
		(form?.values as Record<string, string> | undefined) ?? {
			name: svc.name,
			slug: svc.slug,
			image: svc.image,
			tag: svc.tag,
			registryUrl: svc.registryUrl ?? "",
			registryUsername: svc.registryUsername ?? "",
			containerPort: String(svc.containerPort),
			restartPolicy: svc.restartPolicy,
			cpuLimit: svc.cpuLimit ?? "",
			memoryLimitMb: svc.memoryLimitMb ? String(svc.memoryLimitMb) : "",
		},
	);
	const errors = $derived(form?.errors as Record<string, string[]> | undefined);

	let submitting = $state(false);
	let showRegistry = $state(!!svc.registryUsername);
	let showDeleteConfirm = $state(false);
	let deleting = $state(false);
</script>

<div class="space-y-6">
	<section
		class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
	>
		<div class="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-4">
			<div
				class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
			>
				<Settings class="size-4" />
			</div>
			<div>
				<h2 class="text-sm font-semibold text-[var(--color-text)]">
					Service settings
				</h2>
				<p class="text-xs text-[var(--color-text-muted)]">
					Changes take effect on the next deploy.
				</p>
			</div>
		</div>

		<form
			method="POST"
			action="?/update"
			use:enhance={() => {
				submitting = true;
				return async ({ result, update }) => {
					submitting = false;
					if (result.type === "success") toast.success("Saved.");
					if (result.type === "failure") toast.error("Check the form for errors.");
					await update();
				};
			}}
			class="space-y-5 p-5"
		>
			<div>
				<label for="name" class={label}>
					Name <span class="text-red-500">*</span>
				</label>
				<input
					id="name"
					name="name"
					type="text"
					required
					value={values.name}
					class={input}
				/>
				{#if errors?.name}<p class={errorClass}>{errors.name[0]}</p>{/if}
			</div>

			<div>
				<label for="slug" class={label}>
					Slug <span class="text-red-500">*</span>
				</label>
				<input
					id="slug"
					name="slug"
					type="text"
					required
					pattern="[a-z0-9\-]+"
					maxlength="63"
					value={values.slug}
					class={input}
				/>
				<p class="mt-1 text-xs text-[var(--color-text-subtle)]">
					Routed at <span class="text-accent">{values.slug}.{data.baseDomain}</span>
					— redeploy to apply a change.
				</p>
				{#if errors?.slug}<p class={errorClass}>{errors.slug[0]}</p>{/if}
			</div>

			<div class="grid grid-cols-3 gap-3">
				<div class="col-span-2">
					<label for="image" class={label}>
						Image <span class="text-red-500">*</span>
					</label>
					<input
						id="image"
						name="image"
						type="text"
						required
						value={values.image}
						class={input}
					/>
					{#if errors?.image}<p class={errorClass}>{errors.image[0]}</p>{/if}
				</div>
				<div>
					<label for="tag" class={label}>Tag</label>
					<input id="tag" name="tag" type="text" value={values.tag} class={input} />
				</div>
			</div>

			<div>
				<label for="containerPort" class={label}>
					Container port <span class="text-red-500">*</span>
				</label>
				<input
					id="containerPort"
					name="containerPort"
					type="number"
					min="1"
					max="65535"
					required
					value={values.containerPort}
					class={input}
				/>
				{#if errors?.containerPort}
					<p class={errorClass}>{errors.containerPort[0]}</p>
				{/if}
			</div>

			<div>
				<label for="restartPolicy" class={label}>Restart policy</label>
				<select id="restartPolicy" name="restartPolicy" class={input}>
					{#each [["unless-stopped", "Unless stopped"], ["always", "Always"], ["on-failure", "On failure"], ["no", "Never"]] as [val, lbl]}
						<option value={val} selected={values.restartPolicy === val}>
							{lbl}
						</option>
					{/each}
				</select>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="cpuLimit" class={label}>CPU limit</label>
					<input
						id="cpuLimit"
						name="cpuLimit"
						type="text"
						placeholder="e.g. 0.5 (cores)"
						value={values.cpuLimit}
						class={input}
					/>
					{#if errors?.cpuLimit}<p class={errorClass}>{errors.cpuLimit[0]}</p>{/if}
				</div>
				<div>
					<label for="memoryLimitMb" class={label}>Memory limit (MB)</label>
					<input
						id="memoryLimitMb"
						name="memoryLimitMb"
						type="number"
						min="1"
						placeholder="e.g. 512"
						value={values.memoryLimitMb}
						class={input}
					/>
					{#if errors?.memoryLimitMb}
						<p class={errorClass}>{errors.memoryLimitMb[0]}</p>
					{/if}
				</div>
			</div>

			<div class="rounded-xl border border-[var(--color-border)]">
				<button
					type="button"
					onclick={() => (showRegistry = !showRegistry)}
					class="flex w-full items-center gap-3 px-4 py-3 text-left"
				>
					<Lock class="size-4 text-[var(--color-text-muted)]" />
					<span class="flex-1 text-sm font-medium text-[var(--color-text)]">
						Private registry
					</span>
					<ChevronDown
						class="size-4 text-[var(--color-text-muted)] transition-transform {showRegistry
							? 'rotate-180'
							: ''}"
					/>
				</button>
				{#if showRegistry}
					<div class="space-y-4 border-t border-[var(--color-border)] p-4">
						<div>
							<label for="registryUrl" class={label}>Registry URL</label>
							<input
								id="registryUrl"
								name="registryUrl"
								type="text"
								value={values.registryUrl}
								class={input}
							/>
						</div>
						<div class="grid grid-cols-2 gap-3">
							<div>
								<label for="registryUsername" class={label}>Username</label>
								<input
									id="registryUsername"
									name="registryUsername"
									type="text"
									value={values.registryUsername}
									class={input}
								/>
							</div>
							<div>
								<label for="registryPassword" class={label}>
									Password / token
								</label>
								<input
									id="registryPassword"
									name="registryPassword"
									type="password"
									placeholder="Leave blank to keep current"
									class={input}
								/>
							</div>
						</div>
					</div>
				{/if}
			</div>

			<div class="flex justify-end">
				<button
					type="submit"
					disabled={submitting}
					class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-60"
				>
					{#if submitting}
						<Loader2 class="size-4 animate-spin" />
						Saving…
					{:else}
						<Check class="size-4" />
						Save
					{/if}
				</button>
			</div>
		</form>
	</section>

	<!-- ═══ Danger zone ═══ -->
	<section
		class="rounded-2xl border border-red-200 bg-[var(--color-surface)] dark:border-red-900/40"
	>
		<div class="flex items-center gap-3 border-b border-red-100 px-5 py-4 dark:border-red-900/30">
			<div class="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600">
				<AlertTriangle class="size-4" />
			</div>
			<div>
				<h2 class="text-sm font-semibold text-red-600 dark:text-red-400">
					Danger zone
				</h2>
				<p class="text-xs text-[var(--color-text-muted)]">
					Irreversible. Removes the container and all deployment history.
				</p>
			</div>
		</div>
		<div class="p-5">
			{#if !showDeleteConfirm}
				<div class="flex items-center justify-between gap-4">
					<div>
						<p class="text-sm font-medium text-[var(--color-text)]">
							Delete this service
						</p>
					</div>
					<button
						onclick={() => (showDeleteConfirm = true)}
						class="shrink-0 rounded-xl border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-500 hover:text-white dark:border-red-700/60"
					>
						Delete service
					</button>
				</div>
			{:else}
				<form
					method="POST"
					action="?/delete"
					use:enhance={() => {
						deleting = true;
						return async ({ result }) => {
							if (result.type === "redirect") {
								toast.success("Service deleted.");
								goto(result.location);
							} else {
								deleting = false;
								toast.error("Couldn't delete the service.");
							}
						};
					}}
					class="space-y-4"
				>
					<div
						class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
					>
						<p class="font-semibold">Delete "{svc.name}"?</p>
						<p class="mt-1">
							Its container will be stopped and removed. This can't be undone.
						</p>
					</div>
					<div class="flex items-center gap-3">
						<button
							type="button"
							onclick={() => (showDeleteConfirm = false)}
							class="rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-all hover:bg-[var(--color-surface-2)]"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={deleting}
							class="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
						>
							{#if deleting}
								<Loader2 class="size-4 animate-spin" />
								Deleting…
							{:else}
								<Trash2 class="size-4" />
								Yes, delete
							{/if}
						</button>
					</div>
				</form>
			{/if}
		</div>
	</section>
</div>
