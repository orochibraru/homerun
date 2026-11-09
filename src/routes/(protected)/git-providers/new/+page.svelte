<script lang="ts">
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { Button } from "@orochibraru/ui/button";
	import {
		Select as SelectRoot,
		SelectContent,
		SelectItem,
		SelectTrigger,
	} from "@orochibraru/ui/select";
	import { onMount, tick } from "svelte";

	import {
		inputClass as input,
		labelClass as label,
	} from "#lib/components/form-styles.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";

	const { form } = $props();

	onMount(() => title.set("New Git Provider"));

	const kindOptions: [string, string][] = [
		["github", "GitHub"],
		["gitlab", "GitLab"],
		["gitea", "Gitea (self-hosted)"],
		["bitbucket", "Bitbucket"],
	];

	let kind = $state("github");
	const kindLabel = $derived(
		kindOptions.find(([value]) => value === kind)?.[1] ?? "GitHub",
	);
	const requiresBaseUrl = $derived(kind === "gitea");
	const isGithub = $derived(kind === "github");
	let submitting = $state(false);

	let githubApp = $state<{ action: string; manifest: string } | null>(null);
	let githubAppForm: HTMLFormElement | null = $state(null);

	async function openGithub(registration: unknown) {
		githubApp = registration as { action: string; manifest: string };
		await tick();
		githubAppForm?.submit();
	}
</script>

<div class="p-5 md:p-6">
	<div class="mb-8">
		<h1 class="text-text text-lg font-semibold tracking-tight">
			Add a git provider
		</h1>
		<p class="text-text-muted mt-1 text-sm">
			{#if isGithub}
				Homerun creates a GitHub App for you: GitHub asks you to confirm it,
				then to install it on the repositories Homerun should see.
			{:else}
				Register an OAuth App on the provider's own site first (its
				developer/application settings), then paste the client ID/secret here.
				The callback URL to give it is shown on the provider's page once it's
				added.
			{/if}
		</p>
	</div>

	<form
		action={isGithub ? "?/createGithubApp" : "?/addProvider"}
		class="panel space-y-4 rounded-md p-5"
		method="POST"
		use:enhance={enhanceToast({
			error: "Check the form for errors.",
			loading: isGithub ? "Preparing the GitHub App" : "Adding the provider",
			onSettled: () => {
				submitting = false;
			},
			onStart: () => {
				submitting = true;
			},
			onSuccess: async (result) => {
				if (result?.githubApp) {
					await openGithub(result.githubApp);
					return;
				}
				if (result?.providerId) {
					await goto(
						resolve("/(protected)/git-providers/[providerId]", {
							providerId: String(result.providerId),
						}),
						{ refreshAll: true },
					);
				}
			},
			success: (result) =>
				result?.githubApp ? "Opening GitHub" : "Provider added.",
		})}
	>
		{#if form?.error}
			<p class="text-sm text-red-500">{form.error}</p>
		{/if}
		<div>
			<p class={label}>Provider</p>
			<SelectRoot name="kind" type="single" bind:value={kind}>
				<SelectTrigger class="w-full">
					{kindLabel}
				</SelectTrigger>
				<SelectContent>
					{#each kindOptions as [value, optionLabel] (value)}
						<SelectItem label={optionLabel} {value} />
					{/each}
				</SelectContent>
			</SelectRoot>
		</div>
		<div>
			<label class={label} for="name">Name</label>
			<input
				class={input}
				id="name"
				name="name"
				placeholder={isGithub ? "e.g. homerun-acme" : "e.g. Company GitLab"}
				required
				type="text"
			/>
		</div>
		{#if requiresBaseUrl}
			<div>
				<label class={label} for="baseUrl">
					Base URL <span class="text-red-500">*</span>
				</label>
				<input
					class={input}
					id="baseUrl"
					name="baseUrl"
					placeholder="https://gitea.example.com"
					required
					type="text"
				/>
			</div>
		{/if}
		{#if isGithub}
			<div>
				<label class={label} for="org">Organization</label>
				<input
					class={input}
					id="org"
					name="org"
					placeholder="Leave empty to create it on your personal account"
					type="text"
				/>
			</div>
		{:else}
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label class={label} for="clientId">Client ID</label>
					<input
						class={input}
						id="clientId"
						name="clientId"
						required
						type="text"
					/>
				</div>
				<div>
					<label class={label} for="clientSecret">Client secret</label>
					<input
						class={input}
						id="clientSecret"
						name="clientSecret"
						required
						type="password"
					/>
				</div>
			</div>
		{/if}
		<div class="flex justify-end gap-3">
			<Button href={resolve("git-providers")} variant="outline">Cancel</Button>
			<Button disabled={submitting} type="submit">
				{isGithub ? "Create GitHub App" : "Add provider"}
			</Button>
		</div>
	</form>
	{#if githubApp}
		<form
			bind:this={githubAppForm}
			action={githubApp.action}
			class="hidden"
			method="POST"
		>
			<input name="manifest" type="hidden" value={githubApp.manifest} />
		</form>
	{/if}
</div>
