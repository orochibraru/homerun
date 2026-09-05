<script lang="ts">
	import {
		ChevronDown,
		Clock,
		Play,
		Rocket,
		RotateCw,
		Square,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import AnsiLine from "$lib/components/ansi-line.svelte";
	import LiveLogViewer from "$lib/components/live-log-viewer.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { timeAgo } from "$lib/formatting";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();

	const svc = $derived(data.service);

	onMount(() => title.set(svc.name));

	let pendingAction = $state<string | null>(null);
	let progressLines = $state<string[]>([]);
	let pollGeneration = 0;
	let expandedDeploymentId = $state<string | null>(null);

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
				pendingAction = null;
			},
			onStart: () => {
				pendingAction = action;
			},
			success: `${svc.name} ${label.done}.`,
		});
	}

	const IN_FLIGHT_STATUSES = new Set(["pending", "pulling", "starting"]);

	/** One poll tick : returns the deployment's current status, or undefined on a missed tick. */
	async function fetchProgress(
		deploymentId: string,
	): Promise<string | undefined> {
		try {
			const res = await fetch(
				resolve(
					"/(protected)/services/[serviceId]/deployments/[deploymentId]/progress",
					{
						deploymentId,
						serviceId: svc.id,
					},
				),
			);
			if (res.ok) {
				const body = (await res.json()) as {
					log: string;
					status: string;
				};
				progressLines = body.log.split("\n").filter(Boolean);
				return body.status;
			}
		} catch {
			// A missed poll tick isn't worth surfacing : the next one usually succeeds.
		}
	}

	// Polling starts client-side (see deployEnhance below) before the
	// deploy action's own POST has even reached the server, so the very
	// first tick(s) almost always race ahead of DeploymentDTO.create() and
	// come back 404 ("not found yet"), not just an occasional dropped
	// request. A missing status must be retried like any other missed
	// tick, not treated as "done" : only an explicit terminal status (not
	// in IN_FLIGHT_STATUSES) actually stops the loop. Capped so a
	// genuinely broken connection doesn't poll forever.
	const MAX_CONSECUTIVE_MISSES = 30;

	/**
	 * Polls until the deployment reaches a terminal status, then clears
	 * pendingAction itself : this is the single mechanism for both a live
	 * deploy just submitted from this tab AND resuming the progress view
	 * after a mid-deploy page reload (see onMount below), since in both
	 * cases there's no other signal telling the client when it's done.
	 */
	async function pollProgress(deploymentId: string) {
		pollGeneration += 1;
		const myGeneration = pollGeneration;
		let status = await fetchProgress(deploymentId);
		let misses = 0;
		while (myGeneration === pollGeneration) {
			if (status) {
				misses = 0;
				if (!IN_FLIGHT_STATUSES.has(status)) {
					break;
				}
			} else if (++misses >= MAX_CONSECUTIVE_MISSES) {
				break;
			}
			// biome-ignore lint/performance/noAwaitInLoops: progress polling is sequential by definition
			await new Promise((r) => setTimeout(r, 1000));
			if (myGeneration !== pollGeneration) {
				return;
			}
			status = await fetchProgress(deploymentId);
		}
		if (myGeneration === pollGeneration) {
			pendingAction = null;
		}
	}

	onMount(() => {
		const [latest] = data.deployments;
		if (latest && IN_FLIGHT_STATUSES.has(svc.currentStatus)) {
			pendingAction = "deploy";
			void pollProgress(latest.id);
		}
	});

	function deployEnhance() {
		return enhanceToast({
			error: `Couldn't deploy ${svc.name}.`,
			loading: `Deploying ${svc.name}`,
			onComplete: () => refreshAll(),
			onStart: () => {
				pendingAction = "deploy";
				progressLines = [];
			},
			onSubmit: ({ formData }) => {
				const deploymentId = crypto.randomUUID();
				formData.set("deploymentId", deploymentId);
				void pollProgress(deploymentId);
			},
			success: `${svc.name} deployed.`,
		});
	}
</script>

<!-- ═══ Actions ═══ -->
<div class="mb-6 flex flex-wrap gap-2">
    <form action="?/deploy" method="POST" use:enhance={deployEnhance()}>
        <Button disabled={pendingAction !== null} type="submit">
            {#if pendingAction === "deploy"}
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
                    disabled={pendingAction !== null}
                    type="submit"
                    variant="outline"
                >
                    {#if pendingAction === "stop"}
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
                    disabled={pendingAction !== null}
                    type="submit"
                    variant="outline"
                >
                    {#if pendingAction === "start"}
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
                disabled={pendingAction !== null}
                type="submit"
                variant="outline"
            >
                {#if pendingAction === "restart"}
                    <Spinner />
                {:else}
                    <RotateCw class="size-4" />
                {/if}
                Restart
            </Button>
        </form>
    {/if}
</div>

{#if pendingAction === "deploy" && progressLines.length > 0}
    <div
        class="mb-6 h-48 overflow-y-auto rounded-xl bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300"
    >
        {#each progressLines as line, i (i)}
            <AnsiLine {line} />
        {/each}
    </div>
{/if}

{#if !svc.containerId}
    <div
        class="border-border bg-surface-2 text-text-muted mb-6 rounded-xl border p-4 text-sm"
    >
        This service hasn't been deployed yet : click <strong>Deploy</strong> to
        pull
        <span class="text-text font-mono">{svc.image}:{svc.tag}</span>
        and start it.
    </div>
{:else if pendingAction !== "deploy"}
    <!-- Live container logs, right on the Overview tab : same panel as the
       Logs tab (see $lib/components/live-log-viewer.svelte), just shorter.
       Hidden mid-deploy since the progress panel above already covers
       live output for that. -->
    <div class="mb-6">
        <LiveLogViewer
            containerId={svc.containerId}
            heightClass="h-56"
            serviceId={svc.id}
        />
        <a
            class="text-accent mt-2 inline-block text-xs underline"
            href={resolve("/(protected)/services/[serviceId]/logs", {
                serviceId: svc.id,
            })}
        >
            View full logs
        </a>
    </div>
{/if}

<!-- ═══ Deployment history ═══ -->
<section class="glass rounded-2xl">
    <div class="border-border flex items-center gap-2 border-b px-5 py-4">
        <Clock class="text-text-muted size-4" />
        <h2 class="eyebrow">Deployment history</h2>
    </div>

    {#if data.deployments.length === 0}
        <div
            class="flex flex-col items-center justify-center py-12 text-center"
        >
            <p class="text-text-muted text-sm font-medium">
                No deployments yet
            </p>
        </div>
    {:else}
        <div class="divide-border divide-y">
            {#each data.deployments as dep (dep.id)}
                <div>
                    <button
                        class="flex w-full items-center gap-4 px-5 py-3 text-left"
                        onclick={() => {
                            expandedDeploymentId =
                                expandedDeploymentId === dep.id ? null : dep.id;
                        }}
                        type="button"
                    >
                        <StatusBadge status={dep.status} />
                        <div class="min-w-0 flex-1">
                            <p class="text-text-muted truncate text-xs">
                                {timeAgo(dep.createdAt)}
                                {#if dep.imageDigest}
                                    ·
                                    <span class="font-mono"
                                        >{dep.imageDigest.slice(0, 19)}</span
                                    >
                                {/if}
                            </p>
                            {#if dep.errorMessage}
                                <p class="mt-0.5 truncate text-xs text-red-500">
                                    {dep.errorMessage}
                                </p>
                            {/if}
                        </div>
                        {#if dep.log}
                            <ChevronDown
                                class="
                  text-text-muted size-4 shrink-0 transition-transform {expandedDeploymentId ===
                                dep.id
                                    ? 'rotate-180'
                                    : ''}
                "
                            />
                        {/if}
                    </button>
                    {#if expandedDeploymentId === dep.id && dep.log}
                        <div
                            class="mx-5 mb-3 max-h-64 overflow-y-auto rounded-xl bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300"
                        >
                            {#each dep.log
                                .split("\n")
                                .filter(Boolean) as line, i (i)}
                                <AnsiLine {line} />
                            {/each}
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</section>
