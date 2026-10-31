<script lang="ts">
	import { resolve } from "$app/paths";
	import { AlertTriangle } from "@lucide/svelte";
	import { toast } from "svelte-sonner";

	import { can, type Permissions } from "#lib/permissions.js";
	import {
		getSetupStatus,
		reapplyTraefikConfig,
	} from "#lib/remote/setup.remote.js";
	import { toastError } from "#lib/toast.js";

	const { permissions }: { permissions: Permissions } = $props();

	const setup = getSetupStatus();
	const setupIssues = $derived(
		(setup.current?.checks ?? []).filter((check) => check.severity !== "ok"),
	);
	let reviewOpen = $state(false);
	let reapplying = $state(false);

	async function reapplyCallback() {
		reapplying = true;
		try {
			await reapplyTraefikConfig();
		} finally {
			reapplying = false;
		}
	}

	function handleReapply() {
		return toast.promise(reapplyCallback(), {
			error: (error) =>
				toastError(error, "Couldn't re-apply the Traefik configuration."),
			loading: "Re-applying the Traefik configuration",
			success: "Traefik is back on the settings' configuration.",
		});
	}
</script>

{#if setupIssues.length > 0}
	<div class="rounded-lg border border-amber-400/40 bg-amber-400/10 text-xs">
		<button
			class="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-amber-400/15"
			aria-expanded={reviewOpen}
			onclick={() => {
				reviewOpen = !reviewOpen;
			}}
			type="button"
		>
			<AlertTriangle
				class="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
			/>
			<span class="flex-1 text-amber-700 dark:text-amber-300">
				{setupIssues.length}
				{setupIssues.length === 1 ? "setup issue" : "setup issues"}
				found : {setupIssues[0].label.toLowerCase()}
				{setupIssues.length > 1 ? ", and more" : ""}.
			</span>
			<span class="eyebrow shrink-0 text-amber-700 dark:text-amber-400">
				{reviewOpen ? "Hide" : "Review"}
			</span>
		</button>
		{#if reviewOpen}
			<ul class="divide-y divide-amber-400/30 border-t border-amber-400/30">
				{#each setupIssues as issue (issue.id)}
					{@const fields = setup.current?.fieldsByCheck[issue.id] ?? []}
					<li class="flex flex-wrap items-start gap-x-4 gap-y-1 px-3 py-2.5">
						<div class="min-w-0 flex-1">
							<p class="text-text font-medium">
								<span
									class="mr-1.5 inline-block size-1.5 rounded-full align-middle {issue.severity ===
									'danger'
										? 'bg-red-500'
										: 'bg-amber-500'}"
								></span>
								{issue.label}
							</p>
							<p class="text-text-muted mt-0.5">{issue.detail}</p>
							{#if issue.envVar}
								<p class="text-text-subtle mt-0.5">
									Env var : <code>{issue.envVar}</code>
								</p>
							{/if}
						</div>
						{#if issue.action === "reapply-traefik" && can(permissions, "settings", "write")}
							<button
								class="eyebrow shrink-0 text-amber-700 hover:underline disabled:opacity-50 dark:text-amber-400"
								disabled={reapplying}
								onclick={handleReapply}
								type="button"
							>
								Re-apply
							</button>
						{/if}
						{#if fields.length > 0}
							<a
								class="eyebrow shrink-0 text-amber-700 hover:underline dark:text-amber-400"
								href="{resolve('settings')}?highlight={fields.join(',')}"
								>Fix in settings</a
							>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}
