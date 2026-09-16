<script lang="ts">
	import { ChevronDown, Clock, RotateCcw } from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import AnsiLine from "$lib/components/ansi-line.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { timeAgo } from "$lib/formatting";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();

	onMount(() => title.set(`${data.service.name} · Revisions`));

	let expandedDeploymentId = $state<string | null>(
		untrack(() => page.url.searchParams.get("deployment")),
	);
	let confirmOpen = $state(false);
	let pendingRevision = $state<(typeof data.deployments)[number] | null>(null);
	let revisionForm = $state<HTMLFormElement | null>(null);
	let deploying = $state(false);

	const HEALTH_LABELS = {
		healthy: {
			class: "border-emerald-500/30 text-emerald-600",
			label: "Healthy",
		},
		rolled_back: {
			class: "border-red-500/30 text-red-600",
			label: "Rolled back",
		},
		unhealthy: { class: "border-red-500/30 text-red-600", label: "Unhealthy" },
		watching: {
			class: "border-amber-500/30 text-amber-600",
			label: "Checking health",
		},
	};

	function commitHref(commit: string): string | null {
		const url = data.service.gitUrl;
		if (!url?.startsWith("http")) {
			return null;
		}
		return `${url.replace(/\.git$/, "").replace(/\/$/, "")}/commit/${commit}`;
	}

	function isRevision(dep: (typeof data.deployments)[number]): boolean {
		return (
			Boolean(dep.imageRef) &&
			(dep.status === "running" || dep.status === "stopped")
		);
	}

	function rollbackLabel(id: string): string {
		const target = data.deployments.find((dep) => dep.id === id);
		return target?.imageRef ?? id.slice(0, 8);
	}

	function askDeploy(dep: (typeof data.deployments)[number]) {
		pendingRevision = dep;
		confirmOpen = true;
	}
</script>

<section class="panel rounded-md">
    <div class="border-border flex items-center gap-2 border-b px-5 py-4">
        <Clock class="text-text-muted size-4" />
        <h2 class="eyebrow">Revisions</h2>
        <p class="text-text-muted ml-auto text-xs">
            The last 5 distinct images are kept on this host for instant rollback.
        </p>
    </div>

    {#if data.deployments.length === 0}
        <div
            class="flex flex-col items-center justify-center py-12 text-center"
        >
            <p class="text-text-muted text-sm font-medium">
                No revisions yet
            </p>
        </div>
    {:else}
        <div class="divide-border divide-y">
            {#each data.deployments as dep (dep.id)}
                <div>
                    <div class="flex w-full items-center gap-4 px-5 py-3">
                        <button
                            class="flex min-w-0 flex-1 items-center gap-4 text-left"
                            onclick={() => {
                                expandedDeploymentId =
                                    expandedDeploymentId === dep.id ? null : dep.id;
                            }}
                            type="button"
                        >
                            <StatusBadge status={dep.status} />
                            <div class="min-w-0 flex-1">
                                <p class="text-text flex flex-wrap items-center gap-2 truncate text-xs font-medium">
                                    <span class="truncate">
                                        {dep.imageRef ?? `${data.service.image}:${data.service.tag}`}
                                    </span>
                                    {#if dep.current}
                                        <span class="border-accent/40 text-accent rounded-sm border px-1.5 py-px text-[0.625rem] font-semibold tracking-[0.08em] uppercase">
                                            Current
                                        </span>
                                    {/if}
                                    {#if dep.health}
                                        <span class="rounded-sm border px-1.5 py-px text-[0.625rem] font-semibold tracking-[0.08em] uppercase {HEALTH_LABELS[dep.health].class}">
                                            {HEALTH_LABELS[dep.health].label}
                                        </span>
                                    {/if}
                                    {#if dep.startedAt && dep.finishedAt}
                                        <span class="text-text-subtle font-normal">
                                            took {Math.max(
                                                1,
                                                Math.round(
                                                    (new Date(dep.finishedAt).getTime() -
                                                        new Date(dep.startedAt).getTime()) /
                                                        1000,
                                                ),
                                            )}s
                                        </span>
                                    {/if}
                                </p>
                                <p class="text-text-muted truncate text-xs">
                                    {timeAgo(dep.createdAt)}
                                    {#if dep.imageDigest}
                                        · {dep.imageDigest.slice(0, 19)}
                                    {/if}
                                    {#if dep.gitCommit}
                                        ·
                                        {#if commitHref(dep.gitCommit)}
                                            <a
                                                class="text-accent underline"
                                                href={commitHref(dep.gitCommit)}
                                                rel="noreferrer"
                                                target="_blank"
                                            >
                                                {dep.gitRef ? `${dep.gitRef}@` : ""}{dep.gitCommit.slice(0, 7)}
                                            </a>
                                        {:else}
                                            {dep.gitRef ? `${dep.gitRef}@` : ""}{dep.gitCommit.slice(0, 7)}
                                        {/if}
                                    {/if}
                                    {#if dep.rollbackOfDeploymentId}
                                        · rollback to {rollbackLabel(dep.rollbackOfDeploymentId)}
                                    {/if}
                                    {#if isRevision(dep) && !dep.retained}
                                        · image not retained
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
                        {#if isRevision(dep) && !dep.current}
                            <Button
                                aria-label="Deploy revision {dep.imageRef}"
                                class="shrink-0"
                                disabled={deploying}
                                onclick={() => askDeploy(dep)}
                                size="sm"
                                type="button"
                                variant="outline"
                            >
                                <RotateCcw class="size-3.5" />
                                Deploy this revision
                            </Button>
                        {/if}
                    </div>
                    {#if expandedDeploymentId === dep.id && dep.log}
                        <div
                            class="mx-5 mb-3 max-h-64 overflow-y-auto rounded-md bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300"
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

<form
  action="?/deployRevision"
  class="hidden"
  method="POST"
  bind:this={revisionForm}
  use:enhance={enhanceToast({
    error: "Couldn't queue the revision.",
    loading: "Queueing the revision",
    onSuccess: async () => {
      await goto(
        resolve("/(protected)/services/[serviceId]", {
          serviceId: data.service.id,
        }),
      );
    },
    onSettled: () => {
      deploying = false;
    },
    onStart: () => {
      deploying = true;
    },
    success: "Rollback queued.",
  })}
>
  <input name="revisionId" type="hidden" value={pendingRevision?.id ?? ""}>
</form>

<ConfirmDialog
  bind:open={confirmOpen}
  confirmLabel="Deploy this revision"
  description={pendingRevision
    ? `Redeploys ${pendingRevision.imageRef}${pendingRevision.gitCommit ? ` (commit ${pendingRevision.gitCommit.slice(0, 7)})` : ""} exactly as it ran, skipping the build and the image scan. The service's current environment, volumes and networking are kept.`
    : ""}
  destructive={false}
  onConfirm={() => revisionForm?.requestSubmit()}
  title="Deploy this revision?"
/>
