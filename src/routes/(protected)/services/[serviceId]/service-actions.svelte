<script lang="ts">
	import { enhance } from "$app/forms";
	import {
		Ban,
		Download,
		Ellipsis,
		Hammer,
		Play,
		Rocket,
		RotateCw,
		Sparkles,
		Square,
		Undo2,
		Zap,
	} from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import * as DropdownMenu from "@orochibraru/ui/dropdown-menu";
	import { Spinner } from "@orochibraru/ui/spinner";

	import type { DeployProgress } from "#lib/deploy-progress.svelte.js";
	import { isDeployed } from "#lib/service-state.js";
	import { enhanceToast } from "#lib/toast.js";

	interface Props {
		actionPath: string;
		canRollBack: boolean;
		progress: DeployProgress;
		service: {
			buildSource: string;
			containerId: string | null;
			desiredState: string;
			image: string | null;
			name: string;
			swarmServiceId: string | null;
			tag: string | null;
		};
	}

	const { actionPath, canRollBack, progress, service }: Props = $props();

	const ACTION_LABELS: Record<
		string,
		{ done: string; progressive: string; verb: string }
	> = {
		kill: { done: "killed", progressive: "Killing", verb: "kill" },
		pull: {
			done: "pulled",
			progressive: "Pulling the image for",
			verb: "pull the image for",
		},
		restart: { done: "restarted", progressive: "Restarting", verb: "restart" },
		start: { done: "started", progressive: "Starting", verb: "start" },
		stop: { done: "stopped", progressive: "Stopping", verb: "stop" },
	};

	function withPending(action: string) {
		const label = ACTION_LABELS[action];
		return enhanceToast({
			error: `Couldn't ${label.verb} ${service.name}.`,
			loading: `${label.progressive} ${service.name}`,
			onSettled: () => {
				progress.pendingAction = null;
			},
			onStart: () => {
				progress.pendingAction = action;
			},
			success: (data) =>
				typeof data?.message === "string"
					? data.message
					: `${service.name} ${label.done}.`,
		});
	}

	let freshForm = $state<HTMLFormElement>();
	let pullForm = $state<HTMLFormElement>();
	let stopForm = $state<HTMLFormElement>();
	let startForm = $state<HTMLFormElement>();
	let rollbackForm = $state<HTMLFormElement>();
	let killForm = $state<HTMLFormElement>();

	const busy = $derived(progress.pendingAction !== null);
	const deployed = $derived(isDeployed(service));
	const git = $derived(service.buildSource === "git");
</script>

<div class="flex flex-wrap items-center gap-2 max-sm:w-full">
	{#if progress.pendingAction === "deploy"}
		<form
			action="{actionPath}?/cancel"
			method="POST"
			use:enhance={enhanceToast({
				error: "Couldn't cancel the deploy.",
				loading: `Cancelling the deploy of ${service.name}`,
				success: "Deploy cancelled.",
			})}
		>
			<Button type="submit" variant="outline">
				<Ban class="size-4" />
				Cancel
			</Button>
		</form>
	{/if}

	{#if deployed}
		<form
			action="{actionPath}?/restart"
			method="POST"
			use:enhance={withPending("restart")}
		>
			<Button disabled={busy} type="submit" variant="outline">
				{#if progress.pendingAction === "restart"}
					<Spinner />
				{:else}
					<RotateCw class="size-4" />
				{/if}
				Restart
			</Button>
		</form>
	{/if}

	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					aria-label="More actions"
					class="px-3"
					disabled={busy}
					variant="outline"
				>
					{#if busy && progress.pendingAction !== "deploy" && progress.pendingAction !== "restart"}
						<Spinner />
					{:else}
						<Ellipsis class="size-4.5" />
					{/if}
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-60">
			{#if git}
				<DropdownMenu.Item onSelect={() => freshForm?.requestSubmit()}>
					<Sparkles class="size-4" />
					Fresh build, no cache
				</DropdownMenu.Item>
			{:else}
				<DropdownMenu.Item onSelect={() => pullForm?.requestSubmit()}>
					<Download class="size-4" />
					Pull image
				</DropdownMenu.Item>
			{/if}
			{#if deployed}
				{#if canRollBack}
					<DropdownMenu.Item onSelect={() => rollbackForm?.requestSubmit()}>
						<Undo2 class="size-4" />
						Roll back to the previous version
					</DropdownMenu.Item>
				{/if}
				<DropdownMenu.Separator />
				{#if service.desiredState === "running"}
					<DropdownMenu.Item
						onSelect={() => stopForm?.requestSubmit()}
						variant="destructive"
					>
						<Square class="size-4" />
						Stop
					</DropdownMenu.Item>
				{:else}
					<DropdownMenu.Item onSelect={() => startForm?.requestSubmit()}>
						<Play class="size-4" />
						Start
					</DropdownMenu.Item>
				{/if}
				{#if service.containerId}
					<DropdownMenu.Item
						onSelect={() => killForm?.requestSubmit()}
						title="SIGKILL the container, no grace period"
						variant="destructive"
					>
						<Zap class="size-4" />
						Kill
					</DropdownMenu.Item>
				{/if}
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>

	<form
		action="{actionPath}?/deploy"
		method="POST"
		use:enhance={progress.deployEnhance()}
	>
		<Button disabled={busy} type="submit">
			{#if progress.pendingAction === "deploy"}
				<Spinner />
				{git ? "Building…" : "Deploying…"}
			{:else if git && deployed}
				<Hammer class="size-4" />
				Rebuild
			{:else}
				<Rocket class="size-4" />
				{deployed ? "Redeploy" : "Deploy"}
			{/if}
		</Button>
	</form>
</div>

<div class="hidden">
	{#if git}
		<form
			action="{actionPath}?/deploy"
			method="POST"
			use:enhance={progress.deployEnhance()}
			bind:this={freshForm}
		>
			<input name="noCache" type="hidden" value="1" />
		</form>
	{:else}
		<form
			action="{actionPath}?/pull"
			method="POST"
			use:enhance={withPending("pull")}
			bind:this={pullForm}
		></form>
	{/if}
	<form
		action="{actionPath}?/stop"
		method="POST"
		use:enhance={withPending("stop")}
		bind:this={stopForm}
	></form>
	<form
		action="{actionPath}?/start"
		method="POST"
		use:enhance={withPending("start")}
		bind:this={startForm}
	></form>
	<form
		action="{actionPath}?/kill"
		method="POST"
		use:enhance={withPending("kill")}
		bind:this={killForm}
	></form>
	<form
		action="{actionPath}?/rollback"
		method="POST"
		use:enhance={enhanceToast({
			error: "Couldn't roll back.",
			loading: `Rolling ${service.name} back to the previous version`,
			onFailure: () => {
				progress.pendingAction = null;
			},
			onStart: () => {
				progress.pendingAction = "rollback";
			},
			onSuccess: (result) => {
				progress.pendingAction = "deploy";
				if (typeof result?.deploymentId === "string") {
					progress.watchProgress(result.deploymentId);
				}
			},
			success: "Rollback queued.",
		})}
		bind:this={rollbackForm}
	></form>
</div>
