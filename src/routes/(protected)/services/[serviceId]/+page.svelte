<script lang="ts">
	import {
		CheckCircle2,
		Circle,
		Play,
		Rocket,
		RotateCw,
		Square,
		XCircle,
	} from "@lucide/svelte";
	import { onDestroy, onMount, tick } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import AnsiLine from "$lib/components/ansi-line.svelte";
	import ConnectionStrings from "$lib/components/connection-strings.svelte";
	import LiveLogViewer from "$lib/components/live-log-viewer.svelte";
	import ReplicaStats from "$lib/components/replica-stats.svelte";
	import ServiceGraph from "$lib/components/service-graph.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import UsageChart from "$lib/components/usage-chart.svelte";
	import { deployPhaseStates } from "$lib/deploy-phases";
	import { DeployProgress } from "$lib/deploy-progress.svelte";
	import { isDeployed, workloadId } from "$lib/service-state";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

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
			success: `${svc.name} ${label.done}.`,
		});
	}

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

<!-- ═══ Actions ═══ -->
<div class="mb-4 flex flex-wrap gap-2">
    <form action="?/deploy" method="POST" use:enhance={progress.deployEnhance()}>
        <Button disabled={progress.pendingAction !== null} type="submit">
            {#if progress.pendingAction === "deploy"}
                <Spinner />
                {svc.containerId ? "Deploying…" : "Deploying…"}
            {:else}
                <Rocket class="size-4" />
                {svc.containerId ? "Redeploy" : "Deploy"}
            {/if}
        </Button>
    </form>

    {#if svc.containerId}
        {#if svc.desiredState === "running"}
            <form
                action="?/stop"
                method="POST"
                use:enhance={withPending("stop")}
            >
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
            <form
                action="?/start"
                method="POST"
                use:enhance={withPending("start")}
            >
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

        <form
            action="?/restart"
            method="POST"
            use:enhance={withPending("restart")}
        >
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
    {/if}
</div>

{#if svc.swarmServiceId}
    <ReplicaStats serviceId={svc.id} />
{/if}

<div class="mb-4 grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <UsageChart serviceId={svc.id} title="Resource usage" />
    <div class="space-y-4">
        <ServiceGraph
            dependsOn={data.dependsOn}
            name={svc.name}
            usedBy={data.usedBy}
        />
        <ConnectionStrings
            service={{
                containerPort: svc.containerPort,
                envVars: svc.envVars ?? {},
                image: svc.image,
                name: svc.name,
                slug: svc.slug,
            }}
        />
    </div>
</div>

{#if progress.pendingAction === "deploy"}
    <div class="panel mb-6 rounded-md">
        <ul class="border-border grid gap-2 border-b px-5 py-4 sm:grid-cols-3">
            {#each deployPhaseStates(progress.progressLines.join("\n"), progress.progressStatus, svc.buildSource) as { phase, state } (phase.id)}
                <li class="flex items-center gap-2 text-xs">
                    {#if state === "done"}
                        <CheckCircle2 class="size-3.5 shrink-0 text-emerald-500" />
                        <span class="text-text">{phase.label}</span>
                    {:else if state === "active"}
                        <Spinner class="size-3.5 shrink-0" />
                        <span class="text-text font-medium">{phase.label}</span>
                    {:else if state === "failed"}
                        <XCircle class="size-3.5 shrink-0 text-red-500" />
                        <span class="text-red-500">{phase.label}</span>
                    {:else}
                        <Circle class="text-text-subtle size-3.5 shrink-0" />
                        <span class="text-text-subtle">{phase.label}</span>
                    {/if}
                </li>
            {/each}
        </ul>
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

{#if !(isDeployed(svc) || progress.pendingAction === "deploy")}
    <div
        class="border-border bg-surface-2 text-text-muted mb-6 rounded-md border p-4 text-sm"
    >
        This service hasn't been deployed yet : click <strong>Deploy</strong> to
        pull
        <span class="text-text">{svc.image}:{svc.tag}</span>
        and start it.
    </div>
{:else if progress.pendingAction !== "deploy"}
    <!-- Live container logs, right on the Overview tab : same panel as the
       Logs tab (see $lib/components/live-log-viewer.svelte), just shorter.
       Hidden mid-deploy since the progress panel above already covers
       live output for that. -->
    <div class="mb-6">
        <LiveLogViewer
            heightClass="h-56"
            serviceId={svc.id}
            workloadId={workloadId(svc)}
        />
        <a
            class="text-accent mt-2 inline-block text-xs underline"
            href={resolve("/(protected)/services/[serviceId]/observability", {
                serviceId: svc.id,
            })}
        >
            View full logs
        </a>
    </div>
{/if}
