<script lang="ts">
	import { enhance } from "$app/forms";
	import { refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { ArrowRight, PackageCheck, RotateCcw } from "@lucide/svelte";

	import RunStatusBadge from "#lib/components/run-status-badge.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { timeAgo } from "#lib/formatting.js";
	import {
		trialAttempts,
		type UpdateTrialStatus,
	} from "#lib/image-versions.js";
	import { enhanceToast } from "#lib/toast.js";

	interface Props {
		canWrite: boolean;
		updates: {
			currentTag: string;
			foundAt: string;
			image: string;
			serviceId: string;
			serviceName: string;
			tag: string;
			trialAttempts: number | null;
			trialMessage: string | null;
			trialStatus: UpdateTrialStatus | null;
		}[];
	}

	const { canWrite, updates }: Props = $props();

	let applying = $state<string | null>(null);
	let retrying = $state<string | null>(null);
</script>

<section class="panel mb-4 rounded-xl">
	<div class="panel-head">
		<h2 class="eyebrow flex items-center gap-1.5">
			<PackageCheck class="size-3.5" />
			Available updates
		</h2>
		<span class="text-text-subtle ml-auto text-xs">{updates.length}</span>
	</div>
	{#if updates.length > 0}
		<div class="divide-border divide-y">
			{#each updates as update (update.serviceId)}
				{@const href = resolve(
					"/(protected)/services/[serviceId]/environments/source",
					{ serviceId: update.serviceId },
				)}
				<div class="flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs">
					<a
						class="text-text truncate text-sm font-medium hover:underline"
						{href}
					>
						{update.serviceName}
					</a>
					<span
						class="text-text-muted inline-flex items-center gap-1 font-mono"
					>
						{update.image}:{update.currentTag}
						<ArrowRight class="size-3" />
						<span class="text-text">
							{update.tag === update.currentTag
								? `newer :${update.tag}`
								: `:${update.tag}`}
						</span>
					</span>
					{#if update.trialStatus}
						<span class="inline-flex items-center gap-1.5">
							<span class="text-text-subtle">Trial</span>
							<RunStatusBadge
								error={update.trialMessage}
								success={update.trialStatus === "running"
									? null
									: update.trialStatus === "passed"}
							/>
						</span>
					{/if}
					<span class="text-text-subtle ml-auto">
						{timeAgo(update.foundAt)}
					</span>
					{#if update.trialStatus === "failed"}
						<span class="text-xs text-red-500">
							Health check fails ({trialAttempts(update.trialAttempts)}), not
							offered
						</span>
					{/if}
					{#if canWrite && update.trialStatus === "failed"}
						<form
							action="{href}?/retryTrial"
							method="POST"
							use:enhance={enhanceToast({
								error: `Couldn't retry the trial of ${update.serviceName}.`,
								loading: `Starting the trial of ${update.serviceName} again`,
								onComplete: () => refreshAll(),
								onSettled: () => {
									retrying = null;
								},
								onStart: () => {
									retrying = update.serviceId;
								},
								success: `Trying :${update.tag} on ${update.serviceName} again.`,
							})}
						>
							<Button
								disabled={retrying !== null}
								loading={retrying === update.serviceId}
								size="sm"
								type="submit"
								variant="outline"
							>
								<RotateCcw class="size-4" />
								Retry trial
							</Button>
						</form>
					{:else if canWrite}
						<form
							action="{href}?/applyUpdate"
							method="POST"
							use:enhance={enhanceToast({
								error: `Couldn't update ${update.serviceName}.`,
								loading: `Queuing the update of ${update.serviceName}`,
								onComplete: () => refreshAll(),
								onSettled: () => {
									applying = null;
								},
								onStart: () => {
									applying = update.serviceId;
								},
								success: `Deploying ${update.serviceName} on :${update.tag}.`,
							})}
						>
							<Button
								disabled={applying !== null || update.trialStatus === "running"}
								loading={applying === update.serviceId}
								size="sm"
								type="submit"
							>
								Update now
							</Button>
						</form>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<p class="text-text-muted px-4 py-3 text-xs">No updates available.</p>
	{/if}
</section>
