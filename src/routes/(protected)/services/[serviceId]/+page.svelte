<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import {
		Ban,
		Download,
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
	import { Spinner } from "@orochibraru/ui/spinner";
	import { onDestroy, onMount, tick } from "svelte";

	import Alert from "#lib/components/alert.svelte";
	import AnsiLine from "#lib/components/ansi-line.svelte";
	import ConnectionStrings from "#lib/components/connection-strings.svelte";
	import DeployStepper from "#lib/components/deploy-stepper.svelte";
	import ErrorBoundary from "#lib/components/error-boundary.svelte";
	import LiveLogViewer from "#lib/components/live-log-viewer.svelte";
	import ReplicaStats from "#lib/components/replica-stats.svelte";
	import ServiceGraph from "#lib/components/service-graph.svelte";
	import ServiceSummary from "#lib/components/service-summary.svelte";
	import { DeployProgress } from "#lib/deploy-progress.svelte.js";
	import { isDeployed, workloadId } from "#lib/service-state.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";

	const { data } = $props();

	const svc = $derived(data.service);

	onMount(() => title.set(svc.name));

	const progress = new DeployProgress({
		id: () => svc.id,
		name: () => svc.name,
	});

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
			error: `Couldn't ${label.verb} ${svc.name}.`,
			loading: `${label.progressive} ${svc.name}`,
			onSettled: () => {
				progress.pendingAction = null;
			},
			onStart: () => {
				progress.pendingAction = action;
			},
			success: (data) =>
				typeof data?.message === "string"
					? data.message
					: `${svc.name} ${label.done}.`,
		});
	}

	let freshBuild = $state(false);

	onDestroy(() => progress.close());

	onMount(() => progress.resume(data.deployments[0], svc.currentStatus));

	let progressEl = $state<HTMLElement | undefined>();

	// A build streams hundreds of lines; pinning the view to the bottom is the
	// only way to watch one happen without chasing the scrollbar.
	$effect(() => {
		const lineCount = progress.progressLines.length;
		if (lineCount > 0 && progressEl) {
			void tick().then(() => {
				progressEl?.scrollTo({ top: progressEl.scrollHeight });
			});
		}
	});
</script>

{#if progress.pendingAction === "deploy"}
	<div class="panel mb-6 rounded-md">
		<DeployStepper
			buildSource={svc.buildSource}
			log={progress.progressLines.join("\n")}
			status={progress.progressStatus}
		/>
		<div
			class="h-48 overflow-y-auto rounded-b-md log-output"
			bind:this={progressEl}
		>
			{#if progress.progressLines.length === 0}
				<span class="text-zinc-500">Waiting for the deploy to start…</span>
			{:else}
				{#each progress.progressLines as line, i (i)}
					<AnsiLine {line} />
				{/each}
			{/if}
		</div>
	</div>
{/if}

{#if progress.failedDeploymentId && progress.pendingAction !== "deploy"}
	{@const failedId = progress.failedDeploymentId}
	<Alert class="mb-4" title="The last deploy failed">
		Its revision has the error and the full log.
		{#snippet actions()}
			<Button
				href={progress.revisionHref(failedId)}
				size="sm"
				variant="outline"
			>
				See why
			</Button>
		{/snippet}
	</Alert>
{/if}

<!-- ═══ Actions ═══ -->
<div class="mb-4 flex flex-wrap gap-2">
	<form action="?/deploy" method="POST" use:enhance={progress.deployEnhance()}>
		<Button
			disabled={progress.pendingAction !== null}
			onclick={() => (freshBuild = false)}
			type="submit"
		>
			{#if progress.pendingAction === "deploy" && !freshBuild}
				<Spinner />
				{svc.buildSource === "git" ? "Building…" : "Deploying…"}
			{:else if svc.buildSource === "git" && isDeployed(svc)}
				<Hammer class="size-4" />
				Rebuild
			{:else}
				<Rocket class="size-4" />
				{isDeployed(svc) ? "Redeploy" : "Deploy"}
			{/if}
		</Button>
	</form>

	{#if progress.pendingAction === "deploy"}
		<form
			action="?/cancel"
			method="POST"
			use:enhance={enhanceToast({
				error: "Couldn't cancel the deploy.",
				loading: `Cancelling the deploy of ${svc.name}`,
				success: "Deploy cancelled.",
			})}
		>
			<Button type="submit" variant="outline">
				<Ban class="size-4" />
				Cancel
			</Button>
		</form>
	{/if}

	{#if svc.buildSource === "git"}
		<form
			action="?/deploy"
			method="POST"
			use:enhance={progress.deployEnhance()}
		>
			<input name="noCache" type="hidden" value="1" />
			<Button
				disabled={progress.pendingAction !== null}
				onclick={() => (freshBuild = true)}
				title="Rebuild from scratch, ignoring every cached layer"
				type="submit"
				variant="outline"
			>
				{#if progress.pendingAction === "deploy" && freshBuild}
					<Spinner />
				{:else}
					<Sparkles class="size-4" />
				{/if}
				Fresh build
			</Button>
		</form>
	{:else}
		<form action="?/pull" method="POST" use:enhance={withPending("pull")}>
			<Button
				disabled={progress.pendingAction !== null}
				title="Pull {svc.image}:{svc.tag} without redeploying"
				type="submit"
				variant="outline"
			>
				{#if progress.pendingAction === "pull"}
					<Spinner />
				{:else}
					<Download class="size-4" />
				{/if}
				Pull image
			</Button>
		</form>
	{/if}

	{#if isDeployed(svc)}
		{#if svc.desiredState === "running"}
			<form action="?/stop" method="POST" use:enhance={withPending("stop")}>
				<Button
					class="border-red-100 bg-red-600/10 text-red-600 dark:border-red-600"
					disabled={progress.pendingAction !== null}
					type="submit"
					variant="outline"
				>
					{#if progress.pendingAction === "stop"}
						<Spinner />
					{:else}
						<Square class="size-4" />
					{/if}
					Stop
				</Button>
			</form>
		{:else}
			<form action="?/start" method="POST" use:enhance={withPending("start")}>
				<Button
					class="border-green-100 bg-green-600/10 text-green-600 dark:border-green-600"
					disabled={progress.pendingAction !== null}
					type="submit"
					variant="outline"
				>
					{#if progress.pendingAction === "start"}
						<Spinner />
					{:else}
						<Play class="size-4" />
					{/if}
					Start
				</Button>
			</form>
		{/if}

		<form action="?/restart" method="POST" use:enhance={withPending("restart")}>
			<Button
				disabled={progress.pendingAction !== null}
				type="submit"
				variant="outline"
			>
				{#if progress.pendingAction === "restart"}
					<Spinner />
				{:else}
					<RotateCw class="size-4" />
				{/if}
				Restart
			</Button>
		</form>

		{#if data.canRollBack}
			<form
				action="?/rollback"
				method="POST"
				use:enhance={enhanceToast({
					error: "Couldn't roll back.",
					loading: `Rolling ${svc.name} back to the previous version`,
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
			>
				<Button
					disabled={progress.pendingAction !== null}
					title="Redeploy the version that ran before this one"
					type="submit"
					variant="outline"
				>
					{#if progress.pendingAction === "rollback"}
						<Spinner />
					{:else}
						<Undo2 class="size-4" />
					{/if}
					Roll back to the previous version
				</Button>
			</form>
		{/if}

		{#if svc.containerId}
			<form action="?/kill" method="POST" use:enhance={withPending("kill")}>
				<Button
					class="border-red-100 bg-red-600/10 text-red-600 dark:border-red-600"
					disabled={progress.pendingAction !== null}
					title="SIGKILL the container, no grace period"
					type="submit"
					variant="outline"
				>
					{#if progress.pendingAction === "kill"}
						<Spinner />
					{:else}
						<Zap class="size-4" />
					{/if}
					Kill
				</Button>
			</form>
		{/if}
	{/if}
</div>

{#if svc.swarmServiceId}
	<ErrorBoundary title="Replica stats didn't load.">
		<ReplicaStats serviceId={svc.id} />
	</ErrorBoundary>
{/if}

<div
	class="mb-4 grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
>
	{#if isDeployed(svc)}
		<div>
			<LiveLogViewer
				heightClass="h-[32rem]"
				serviceId={svc.id}
				workloadId={workloadId(svc)}
			/>
			<a
				class="text-accent mt-2 inline-block text-xs underline"
				href={resolve("/(protected)/services/[serviceId]/observability/logs", {
					serviceId: svc.id,
				})}
			>
				View full logs
			</a>
		</div>
	{:else if progress.pendingAction !== "deploy"}
		<div
			class="border-border bg-surface-2 text-text-muted rounded-md border p-4 text-sm"
		>
			This service hasn't been deployed yet : click <strong>Deploy</strong> to
			pull
			<span class="text-text">{svc.image}:{svc.tag}</span>
			and start it.
		</div>
	{/if}
	<div class="space-y-4">
		<ServiceSummary
			lastDeployment={data.lastDeployment}
			mountCount={data.mountCount}
			service={svc}
		/>
		<ServiceGraph
			dependsOn={data.dependsOn}
			name={svc.name}
			serviceId={svc.id}
			usedBy={data.usedBy}
		/>
		<ConnectionStrings
			service={{
				command: svc.command,
				containerPort: svc.containerPort,
				envVars: svc.envVars ?? {},
				image: svc.image,
				name: svc.name,
				slug: svc.slug,
			}}
		/>
	</div>
</div>
