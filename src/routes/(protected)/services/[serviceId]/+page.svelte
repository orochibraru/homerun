<script lang="ts">
	import {
		CheckCircle2,
		ChevronDown,
		Circle,
		Clock,
		Play,
		Rocket,
		RotateCw,
		Square,
		XCircle,
	} from "@lucide/svelte";
	import { onDestroy, onMount, tick } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { goto, refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import AnsiLine from "$lib/components/ansi-line.svelte";
	import ConnectionStrings from "$lib/components/connection-strings.svelte";
	import LiveLogViewer from "$lib/components/live-log-viewer.svelte";
	import ReplicaStats from "$lib/components/replica-stats.svelte";
	import ServiceGraph from "$lib/components/service-graph.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import UsageChart from "$lib/components/usage-chart.svelte";
	import { deployPhaseStates } from "$lib/deploy-phases";
	import { timeAgo } from "$lib/formatting";
	import { randomId } from "$lib/random-id";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();

	const svc = $derived(data.service);

	onMount(() => title.set(svc.name));

	let pendingAction = $state<string | null>(null);
	let progressLines = $state<string[]>([]);
	let progressStatus = $state("pending");
	let progressSource: EventSource | null = null;
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
				progressStatus = body.status;
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
	 * pendingAction itself : this is the single mechanism for a live deploy
	 * just submitted from this tab, for resuming the progress view after a
	 * mid-deploy page reload, AND for a deploy queued somewhere else
	 * entirely (a template quick-deploy, the create wizard, cron) that this
	 * page is only arriving at (see onMount below), since in all three
	 * cases there's no other signal telling the client when it's done. It
	 * pulls the page's own data along on every status transition too : the
	 * header status pill and the deployment-history rows come from `load`,
	 * not from this endpoint, and would otherwise sit frozen until a manual
	 * reload.
	 */
	async function pollProgress(deploymentId: string) {
		pollGeneration += 1;
		const myGeneration = pollGeneration;
		let status = await fetchProgress(deploymentId);
		let lastStatus = status;
		let misses = 0;
		while (myGeneration === pollGeneration) {
			if (status) {
				misses = 0;
				if (status !== lastStatus) {
					lastStatus = status;
					void refreshAll();
				}
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
			settleDeploy(deploymentId, status ?? "");
		}
	}

	/**
	 * Ends the progress view once a deploy reaches a terminal status. A failed
	 * deploy opens its revision instead of refreshing: `refreshAll` claims the
	 * navigation token a microtask later than `goto`, so running both cancels
	 * the navigation.
	 */
	function settleDeploy(deploymentId: string, status: string) {
		pendingAction = null;
		if (status !== "failed") {
			void refreshAll();
			return;
		}
		toast.error(`${svc.name} failed to deploy.`, {
			action: {
				label: "See why",
				onClick: () => goto(revisionHref(deploymentId)),
			},
			description: "Opening the revision that failed.",
		});
		void goto(revisionHref(deploymentId));
	}

	function closeProgressSource() {
		progressSource?.close();
		progressSource = null;
	}

	/**
	 * Live deploy progress over server-sent events : the server pushes each
	 * new log line and status transition instead of the client asking once a
	 * second. Falls back to pollProgress above if the stream can't be held
	 * open (a buffering proxy, a dropped connection mid-deploy).
	 */
	function revisionHref(deploymentId: string): string {
		return `${resolve("/(protected)/services/[serviceId]/revisions", {
			serviceId: svc.id,
		})}?deployment=${deploymentId}`;
	}

	function watchProgress(deploymentId: string) {
		pollGeneration += 1;
		closeProgressSource();

		const source = new EventSource(
			resolve(
				"/(protected)/services/[serviceId]/deployments/[deploymentId]/events",
				{ deploymentId, serviceId: svc.id },
			),
		);
		progressSource = source;
		let lastStatus = "";

		source.addEventListener("progress", (event) => {
			const body = JSON.parse((event as MessageEvent).data) as {
				log: string;
				status: string;
			};
			progressLines = body.log.split("\n").filter(Boolean);
			progressStatus = body.status;
			if (body.status !== lastStatus) {
				lastStatus = body.status;
				void refreshAll();
			}
		});

		source.addEventListener("done", (event) => {
			closeProgressSource();
			const body = JSON.parse((event as MessageEvent).data) as {
				status: string;
			};
			settleDeploy(deploymentId, body.status);
		});

		source.onerror = () => {
			closeProgressSource();
			void pollProgress(deploymentId);
		};
	}

	onDestroy(closeProgressSource);

	onMount(() => {
		const [latest] = data.deployments;
		if (!latest) {
			return;
		}
		if (
			IN_FLIGHT_STATUSES.has(latest.status) ||
			IN_FLIGHT_STATUSES.has(svc.currentStatus)
		) {
			pendingAction = "deploy";
			watchProgress(latest.id);
		}
	});

	function deployEnhance() {
		let submittedDeploymentId: string | null = null;
		return enhanceToast({
			error: `Couldn't queue a deploy for ${svc.name}.`,
			loading: `Queueing a deploy for ${svc.name}`,
			onComplete: () => refreshAll(),
			onStart: () => {
				pendingAction = "deploy";
				progressLines = [];
				progressStatus = "pending";
			},
			onSubmit: ({ formData }) => {
				submittedDeploymentId = randomId();
				formData.set("deploymentId", submittedDeploymentId);
				watchProgress(submittedDeploymentId);
			},
			onSuccess: (data) => {
				const actual = data?.deploymentId;
				if (typeof actual === "string" && actual !== submittedDeploymentId) {
					watchProgress(actual);
				}
			},
			success: `${svc.name} is queued for deploy.`,
		});
	}

	let progressEl = $state<HTMLElement | undefined>();

	// A build streams hundreds of lines; pinning the view to the bottom is the
	// only way to watch one happen without chasing the scrollbar.
	$effect(() => {
		const lineCount = progressLines.length;
		if (lineCount > 0 && progressEl) {
			void tick().then(() => {
				progressEl?.scrollTo({ top: progressEl.scrollHeight });
			});
		}
	});
</script>

<!-- ═══ Actions ═══ -->
<div class="mb-4 flex flex-wrap gap-2">
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

{#if pendingAction === "deploy"}
    <div class="panel mb-6 rounded-md">
        <ul class="border-border grid gap-2 border-b px-5 py-4 sm:grid-cols-3">
            {#each deployPhaseStates(progressLines.join("\n"), progressStatus, svc.buildSource) as { phase, state } (phase.id)}
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
            {#if progressLines.length === 0}
                <span class="text-zinc-500">Waiting for the deploy to start…</span>
            {:else}
                {#each progressLines as line, i (i)}
                    <AnsiLine {line} />
                {/each}
            {/if}
        </div>
    </div>
{/if}

{#if !(svc.containerId || pendingAction === "deploy")}
    <div
        class="border-border bg-surface-2 text-text-muted mb-6 rounded-md border p-4 text-sm"
    >
        This service hasn't been deployed yet : click <strong>Deploy</strong> to
        pull
        <span class="text-text">{svc.image}:{svc.tag}</span>
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
            href={resolve("/(protected)/services/[serviceId]/observability", {
                serviceId: svc.id,
            })}
        >
            View full logs
        </a>
    </div>
{/if}
