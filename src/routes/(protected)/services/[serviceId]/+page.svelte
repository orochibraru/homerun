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
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import StatusBadge from "$lib/components/status-badge.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import Spinner from "$lib/components/ui/spinner/spinner.svelte";
  import { timeAgo } from "$lib/formatting";
  import { title } from "$lib/store/title";

  const { data } = $props();

  const svc = $derived(data.service);

  onMount(() => title.set(svc.name));

  let pendingAction = $state<string | null>(null);
  let progressLines = $state<string[]>([]);
  let pollGeneration = 0;
  let expandedDeploymentId = $state<string | null>(null);

  function withPending(action: string) {
    return () => {
      pendingAction = action;
      return async ({
        result,
        update,
      }: {
        result: { type: string; data?: { error?: string } };
        update: () => Promise<void>;
      }) => {
        pendingAction = null;
        if (result.type === "failure" && result.data?.error) {
          toast.error(result.data.error);
        } else if (result.type === "success") {
          toast.success("Done.");
        }
        await update();
      };
    };
  }

  const IN_FLIGHT_STATUSES = new Set(["pending", "pulling", "starting"]);

  /** One poll tick — returns the deployment's current status, or undefined on a missed tick. */
  async function fetchProgress(
    deploymentId: string
  ): Promise<string | undefined> {
    try {
      const res = await fetch(
        resolve(
          "/(protected)/services/[serviceId]/deployments/[deploymentId]/progress",
          {
            deploymentId,
            serviceId: svc.id,
          }
        )
      );
      if (res.ok) {
        const body = (await res.json()) as { log: string; status: string };
        progressLines = body.log.split("\n").filter(Boolean);
        return body.status;
      }
    } catch {
      // A missed poll tick isn't worth surfacing — the next one usually succeeds.
    }
  }

  /**
   * Polls until the deployment reaches a terminal status, then clears
   * pendingAction itself — this is the single mechanism for both a live
   * deploy just submitted from this tab AND resuming the progress view
   * after a mid-deploy page reload (see onMount below), since in both
   * cases there's no other signal telling the client when it's done.
   */
  async function pollProgress(deploymentId: string) {
    pollGeneration += 1;
    const myGeneration = pollGeneration;
    let status = await fetchProgress(deploymentId);
    while (
      myGeneration === pollGeneration &&
      status &&
      IN_FLIGHT_STATUSES.has(status)
    ) {
      // biome-ignore lint/performance/noAwaitInLoops: a poll tick must wait out the interval before the next fetch — inherently sequential.
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
      pollProgress(latest.id);
    }
  });

  function deployEnhance() {
    return ({ formData }: { formData: FormData }) => {
      pendingAction = "deploy";
      progressLines = [];
      const deploymentId = crypto.randomUUID();
      formData.set("deploymentId", deploymentId);
      pollProgress(deploymentId);

      return async ({
        result,
        update,
      }: {
        result: { type: string; data?: { error?: string } };
        update: () => Promise<void>;
      }) => {
        if (result.type === "failure" && result.data?.error) {
          toast.error(result.data.error);
        } else if (result.type === "success") {
          toast.success("Deployed.");
        }
        await update();
      };
    };
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
      <form action="?/stop" method="POST" use:enhance={withPending("stop")}>
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
      <form action="?/start" method="POST" use:enhance={withPending("start")}>
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

    <form action="?/restart" method="POST" use:enhance={withPending("restart")}>
      <Button disabled={pendingAction !== null} type="submit" variant="outline">
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
      <div class="break-all whitespace-pre-wrap">{line}</div>
    {/each}
  </div>
{/if}

{#if !svc.containerId}
  <div
    class="mb-6 rounded-xl border border-border bg-surface-2 p-4 text-sm text-text-muted"
  >
    This service hasn't been deployed yet — click <strong>Deploy</strong> to
    pull
    <span class="font-mono text-text">{svc.image}:{svc.tag}</span>
    and start it.
  </div>
{/if}

<!-- ═══ Deployment history ═══ -->
<section class="rounded-2xl border border-border bg-surface">
  <div class="flex items-center gap-2 border-b border-border px-5 py-4">
    <Clock class="size-4 text-text-muted" />
    <h2 class="text-sm font-semibold text-text">Deployment history</h2>
  </div>

  {#if data.deployments.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <p class="text-sm font-medium text-text-muted">No deployments yet</p>
    </div>
  {:else}
    <div class="divide-y divide-border">
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
              <p class="truncate text-xs text-text-muted">
                {timeAgo(dep.createdAt)}
                {#if dep.imageDigest}
                  ·
                  <span class="font-mono">{dep.imageDigest.slice(0, 19)}</span>
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
                class="size-4 shrink-0 text-text-muted transition-transform {expandedDeploymentId ===
                dep.id
                  ? 'rotate-180'
                  : ''}"
              />
            {/if}
          </button>
          {#if expandedDeploymentId === dep.id && dep.log}
            <div
              class="mx-5 mb-3 max-h-64 overflow-y-auto rounded-xl bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300"
            >
              {#each dep.log.split("\n").filter(Boolean) as line, i (i)}
                <div class="break-all whitespace-pre-wrap">{line}</div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>
