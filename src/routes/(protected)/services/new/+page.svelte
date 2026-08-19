<script lang="ts">
	import {
		ChevronDown,
		Loader2,
		Lock,
		Plus,
		Server,
		Trash2,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { title } from "$lib/store/title";
	import type { ActionData, PageData } from "./$types";

	const { data, form }: { data: PageData; form: ActionData } = $props();

	onMount(() => title.set("Deploy a Service"));

	const input =
		"w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";
	const label = "block mb-1.5 text-sm font-medium text-[var(--color-text)]";
	const errorClass = "mt-1.5 text-xs text-red-500";
	const values = $derived(form?.values as Record<string, string> | undefined);
	const errors = $derived(form?.errors as Record<string, string[]> | undefined);
	// Flat list of every error message, so a field we forgot to render a
	// dedicated <p> for still surfaces instead of silently failing.
	const errorMessages = $derived(errors ? Object.values(errors).flat() : []);

	let name = $state((form?.values?.name as string) ?? "");
	let slug = $state((form?.values?.slug as string) ?? "");
	let slugTouched = $state(false);
	let submitting = $state(false);
	let showRegistry = $state(!!values?.registryUsername);

	function slugify(value: string): string {
		return value
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9-]+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 63);
	}

	function onNameInput() {
		if (!slugTouched) slug = slugify(name);
	}

	function onSlugInput() {
		slugTouched = true;
	}

	type EnvRow = { key: string; value: string };
	let envRows = $state<EnvRow[]>([{ key: "", value: "" }]);

	function addEnvRow() {
		envRows.push({ key: "", value: "" });
	}

	function removeEnvRow(i: number) {
		envRows.splice(i, 1);
		if (envRows.length === 0) envRows.push({ key: "", value: "" });
	}
</script>

<div class="mx-auto max-w-2xl space-y-6 p-6 md:p-8">
	<div>
		<h1 class="text-xl font-bold text-[var(--color-text)]">
			Deploy a Service
		</h1>
		<p class="mt-0.5 text-sm text-[var(--color-text-muted)]">
			Point at an image, fill in the config, deploy.
		</p>
	</div>

	<form
		method="POST"
		action="?/create"
		use:enhance={() => {
			submitting = true;
			return async ({ result, update }) => {
				submitting = false;
				if (result.type === "failure") {
					const data = result.data as
						| { errors?: Record<string, string[]> }
						| undefined;
					const first = data?.errors
						? Object.values(data.errors).flat()[0]
						: undefined;
					toast.error(first ?? "Check the form for errors.");
				} else if (result.type === "error") {
					toast.error(result.error?.message ?? "Something went wrong.");
				}
				await update();
			};
		}}
		class="space-y-6"
	>
		{#if errorMessages.length > 0}
			<div
				class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
			>
				<p class="font-semibold">Couldn't create the service:</p>
				<ul class="mt-1 ml-4 list-disc">
					{#each errorMessages as msg}
						<li>{msg}</li>
					{/each}
				</ul>
			</div>
		{/if}

		<!-- ═══ Basics ═══ -->
		<section
			class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
		>
			<div
				class="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-4"
			>
				<div
					class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
				>
					<Server class="size-4" />
				</div>
				<div>
					<h2 class="text-sm font-semibold text-[var(--color-text)]">
						Basics
					</h2>
					<p class="text-xs text-[var(--color-text-muted)]">
						Name it and point at an image.
					</p>
				</div>
			</div>

			<div class="space-y-5 p-5">
				<div>
					<label for="name" class={label}>
						Name <span class="text-red-500">*</span>
					</label>
					<input
						id="name"
						name="name"
						type="text"
						placeholder="My API"
						required
						bind:value={name}
						oninput={onNameInput}
						class={input}
					/>
					{#if errors?.name}
						<p class={errorClass}>{errors.name[0]}</p>
					{/if}
				</div>

				<div>
					<label for="slug" class={label}>
						Slug <span class="text-red-500">*</span>
					</label>
					<input
						id="slug"
						name="slug"
						type="text"
						placeholder="my-api"
						required
						pattern="[a-z0-9\-]+"
						maxlength="63"
						bind:value={slug}
						oninput={onSlugInput}
						class={input}
					/>
					<p class="mt-1 text-xs text-[var(--color-text-subtle)]">
						Routed at <span class="text-accent"
							>{slug || "your-slug"}.{data.baseDomain}</span
						>
					</p>
					{#if errors?.slug}
						<p class={errorClass}>{errors.slug[0]}</p>
					{/if}
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
							placeholder="ghcr.io/acme/api"
							required
							value={values?.image ?? ""}
							class={input}
						/>
						{#if errors?.image}
							<p class={errorClass}>{errors.image[0]}</p>
						{/if}
					</div>
					<div>
						<label for="tag" class={label}>Tag</label>
						<input
							id="tag"
							name="tag"
							type="text"
							placeholder="latest"
							value={values?.tag ?? "latest"}
							class={input}
						/>
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
						placeholder="3000"
						required
						value={values?.containerPort ?? ""}
						class={input}
					/>
					<p class="mt-1 text-xs text-[var(--color-text-subtle)]">
						The port your app listens on inside the container.
					</p>
					{#if errors?.containerPort}
						<p class={errorClass}>{errors.containerPort[0]}</p>
					{/if}
				</div>
			</div>
		</section>

		<!-- ═══ Private registry (collapsible) ═══ -->
		<section
			class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
		>
			<button
				type="button"
				onclick={() => (showRegistry = !showRegistry)}
				class="flex w-full items-center gap-3 px-5 py-4 text-left"
			>
				<div
					class="flex size-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400"
				>
					<Lock class="size-4" />
				</div>
				<div class="flex-1">
					<h2 class="text-sm font-semibold text-[var(--color-text)]">
						Private registry
					</h2>
					<p class="text-xs text-[var(--color-text-muted)]">
						Only needed for non-public images.
					</p>
				</div>
				<ChevronDown
					class="size-4 text-[var(--color-text-muted)] transition-transform {showRegistry
						? 'rotate-180'
						: ''}"
				/>
			</button>

			{#if showRegistry}
				<div
					class="space-y-4 border-t border-[var(--color-border)] p-5"
				>
					<div>
						<label for="registryUrl" class={label}>
							Registry URL
						</label>
						<input
							id="registryUrl"
							name="registryUrl"
							type="text"
							placeholder="ghcr.io (blank = Docker Hub)"
							value={values?.registryUrl ?? ""}
							class={input}
						/>
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div>
							<label for="registryUsername" class={label}>
								Username
							</label>
							<input
								id="registryUsername"
								name="registryUsername"
								type="text"
								value={values?.registryUsername ?? ""}
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
								class={input}
							/>
						</div>
					</div>
				</div>
			{/if}
		</section>

		<!-- ═══ Environment variables ═══ -->
		<section
			class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
		>
			<div class="border-b border-[var(--color-border)] px-5 py-4">
				<h2 class="text-sm font-semibold text-[var(--color-text)]">
					Environment variables
				</h2>
				<p class="text-xs text-[var(--color-text-muted)]">
					Passed to the container at deploy time.
				</p>
			</div>

			<div class="space-y-2.5 p-5">
				{#each envRows as row, i}
					<div class="flex items-center gap-2">
						<input
							name="envKey"
							type="text"
							placeholder="KEY"
							bind:value={row.key}
							class="{input} font-mono"
						/>
						<input
							name="envValue"
							type="text"
							placeholder="value"
							bind:value={row.value}
							class="{input} font-mono"
						/>
						<button
							type="button"
							onclick={() => removeEnvRow(i)}
							aria-label="Remove"
							class="shrink-0 rounded-lg p-2 text-red-500 transition-all hover:bg-red-500/10"
						>
							<Trash2 class="size-4" />
						</button>
					</div>
				{/each}

				<button
					type="button"
					onclick={addEnvRow}
					class="text-accent mt-1 flex items-center gap-1.5 text-sm font-medium hover:underline"
				>
					<Plus class="size-3.5" />
					Add variable
				</button>
			</div>
		</section>

		<!-- ═══ Runtime ═══ -->
		<section
			class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
		>
			<div class="border-b border-[var(--color-border)] px-5 py-4">
				<h2 class="text-sm font-semibold text-[var(--color-text)]">
					Runtime
				</h2>
			</div>
			<div class="space-y-5 p-5">
				<div>
					<label for="restartPolicy" class={label}>
						Restart policy
					</label>
					<select
						id="restartPolicy"
						name="restartPolicy"
						class={input}
					>
						<option value="unless-stopped" selected>Unless stopped</option>
						<option value="always">Always</option>
						<option value="on-failure">On failure</option>
						<option value="no">Never</option>
					</select>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="cpuLimit" class={label}>
							CPU limit
						</label>
						<input
							id="cpuLimit"
							name="cpuLimit"
							type="text"
							placeholder="e.g. 0.5 (cores)"
							class={input}
						/>
						{#if errors?.cpuLimit}
							<p class={errorClass}>{errors.cpuLimit[0]}</p>
						{/if}
					</div>
					<div>
						<label for="memoryLimitMb" class={label}>
							Memory limit (MB)
						</label>
						<input
							id="memoryLimitMb"
							name="memoryLimitMb"
							type="number"
							min="1"
							placeholder="e.g. 512"
							class={input}
						/>
						{#if errors?.memoryLimitMb}
							<p class={errorClass}>{errors.memoryLimitMb[0]}</p>
						{/if}
					</div>
				</div>
				<p class="text-xs text-[var(--color-text-subtle)]">
					Leave blank for unlimited.
				</p>
			</div>
		</section>

		<div class="flex justify-end gap-3">
			<a
				href={resolve("/services")}
				class="rounded-xl border border-[var(--color-border)] px-5 py-2.5 text-sm font-medium text-[var(--color-text)] transition-all hover:bg-[var(--color-surface-2)]"
			>
				Cancel
			</a>
			<button
				type="submit"
				disabled={submitting}
				class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-60"
			>
				{#if submitting}
					<Loader2 class="size-4 animate-spin" />
					Creating…
				{:else}
					Create service
				{/if}
			</button>
		</div>
	</form>
</div>
