<script lang="ts">
	import { enhance } from "$app/forms";
	import { refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { ArrowRight, RotateCcw } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";

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

{#each updates as update (update.serviceId)}
	{@const href = resolve(
		"/(protected)/services/[serviceId]/environments/source",
		{ serviceId: update.serviceId },
	)}
	{@const failed = update.trialStatus === "failed"}
	<div
		class="border-border relative flex flex-col gap-1.5 rounded-lg border p-4 before:absolute before:inset-y-3 before:-left-px before:w-0.75 before:rounded-full {failed
			? 'before:bg-red-500'
			: 'before:bg-(--lane-1)'}"
	>
		<p class="text-text flex items-center gap-2 text-sm font-semibold">
			<span
				class="size-2 shrink-0 rounded-full {failed
					? 'bg-red-500'
					: 'bg-(--lane-1)'}"
			></span>
			<a class="truncate hover:underline" {href}>
				{update.serviceName}
				{update.tag === update.currentTag
					? `has a newer :${update.tag}`
					: `:${update.tag}`}
				{failed ? "trial failed" : "is available"}
			</a>
		</p>
		<p class="text-text-muted text-sm">
			{#if failed}
				Health check failed ({trialAttempts(update.trialAttempts)}), :{update.currentTag}
				is still serving.
			{:else if update.trialStatus === "running"}
				Trying it now, :{update.currentTag} is still serving.
			{:else if update.trialStatus === "passed"}
				Its trial passed, ready to roll out.
			{:else}
				Found {timeAgo(update.foundAt)}, currently on :{update.currentTag}.
			{/if}
		</p>
		<p
			class="text-text-subtle inline-flex items-center gap-1 truncate font-mono text-xs"
		>
			{update.image}:{update.currentTag}
			<ArrowRight class="size-3 shrink-0" />
			:{update.tag} · {timeAgo(update.foundAt)}
		</p>
		{#if canWrite}
			<div class="mt-1.5 flex flex-wrap gap-2">
				{#if failed}
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
						>
							<RotateCcw class="size-4" />
							Retry trial
						</Button>
					</form>
				{:else}
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
				<Button {href} size="sm" variant="outline">Source</Button>
			</div>
		{/if}
	</div>
{/each}
