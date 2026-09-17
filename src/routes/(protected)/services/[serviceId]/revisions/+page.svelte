<script lang="ts">
	import { ChevronDown, Clock, RotateCcw } from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import CheckBox from "$lib/components/check-box.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import DeployLogPanel from "$lib/components/deploy-log-panel.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { timeAgo } from "$lib/formatting";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();

	onMount(() => title.set(`${data.service.name} · Revisions`));

	let expandedRevisionId = $state<string | null>(
		untrack(() => {
			const deploymentId = page.url.searchParams.get("deployment");
			return (
				data.revisions.find(
					(revision) =>
						revision.id === deploymentId ||
						revision.latestDeploymentId === deploymentId,
				)?.id ?? null
			);
		}),
	);
	let confirmOpen = $state(false);
	let pendingRevision = $state<(typeof data.revisions)[number] | null>(null);
	let revisionForm = $state<HTMLFormElement | null>(null);
	let deploying = $state(false);
	let restoreConfig = $state(false);

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

	function askDeploy(revision: (typeof data.revisions)[number]) {
		pendingRevision = revision;
		restoreConfig = false;
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

    {#if data.revisions.length === 0}
        <div
            class="flex flex-col items-center justify-center py-12 text-center"
        >
            <p class="text-text-muted text-sm font-medium">
                No revisions yet
            </p>
        </div>
    {:else}
        <div class="divide-border divide-y">
            {#each data.revisions as revision (revision.id)}
                <div>
                    <div class="flex w-full items-center gap-4 px-5 py-3">
                        <button
                            class="flex min-w-0 flex-1 items-center gap-4 text-left"
                            onclick={() => {
                                expandedRevisionId =
                                    expandedRevisionId === revision.id ? null : revision.id;
                            }}
                            type="button"
                        >
                            <StatusBadge status={revision.status} />
                            <div class="min-w-0 flex-1">
                                <p class="text-text flex flex-wrap items-center gap-2 truncate text-xs font-medium">
                                    <span class="truncate">
                                        {revision.imageRef ?? `${data.service.image}:${data.service.tag}`}
                                    </span>
                                    {#if revision.current}
                                        <span class="border-accent/40 text-accent rounded-sm border px-1.5 py-px text-[0.625rem] font-semibold tracking-[0.08em] uppercase">
                                            Current
                                        </span>
                                    {/if}
                                    {#if revision.health}
                                        <span class="rounded-sm border px-1.5 py-px text-[0.625rem] font-semibold tracking-[0.08em] uppercase {HEALTH_LABELS[revision.health].class}">
                                            {HEALTH_LABELS[revision.health].label}
                                        </span>
                                    {/if}
                                    {#if revision.startedAt && revision.finishedAt}
                                        <span class="text-text-subtle font-normal">
                                            took {Math.max(
                                                1,
                                                Math.round(
                                                    (new Date(revision.finishedAt).getTime() -
                                                        new Date(revision.startedAt).getTime()) /
                                                        1000,
                                                ),
                                            )}s
                                        </span>
                                    {/if}
                                </p>
                                <p class="text-text-muted truncate text-xs">
                                    deployed {timeAgo(revision.createdAt)}
                                    {#if revision.redeployCount > 0 && revision.lastDeployedAt}
                                        · redeployed {timeAgo(revision.lastDeployedAt)}
                                    {/if}
                                    {#if revision.imageDigest}
                                        · {revision.imageDigest.slice(0, 19)}
                                    {/if}
                                    {#if revision.gitCommit}
                                        ·
                                        {#if commitHref(revision.gitCommit)}
                                            <a
                                                class="text-accent underline"
                                                href={commitHref(revision.gitCommit)}
                                                rel="noreferrer"
                                                target="_blank"
                                            >
                                                {revision.gitRef ? `${revision.gitRef}@` : ""}{revision.gitCommit.slice(0, 7)}
                                            </a>
                                        {:else}
                                            {revision.gitRef ? `${revision.gitRef}@` : ""}{revision.gitCommit.slice(0, 7)}
                                        {/if}
                                    {/if}
                                    {#if revision.deployable && !revision.retained}
                                        · image not retained
                                    {/if}
                                </p>
                                {#if revision.errorMessage}
                                    <p class="mt-0.5 truncate text-xs text-red-500">
                                        {revision.errorMessage}
                                    </p>
                                {/if}
                            </div>
                            {#if revision.log}
                                <ChevronDown
                                    class="
                      text-text-muted size-4 shrink-0 transition-transform {expandedRevisionId ===
                                    revision.id
                                        ? 'rotate-180'
                                        : ''}
                   "
                                />
                            {/if}
                        </button>
                        {#if revision.deployable && !revision.current}
                            <Button
                                aria-label="Deploy revision {revision.imageRef}"
                                class="shrink-0"
                                disabled={deploying}
                                onclick={() => askDeploy(revision)}
                                size="sm"
                                type="button"
                                variant="outline"
                            >
                                <RotateCcw class="size-3.5" />
                                Deploy this revision
                            </Button>
                        {/if}
                    </div>
                    {#if expandedRevisionId === revision.id && revision.log}
                        <DeployLogPanel errorMessage={revision.errorMessage} log={revision.log} />
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
  <input name="restoreConfig" type="hidden" value={restoreConfig ? "on" : ""}>
</form>

<ConfirmDialog
  bind:open={confirmOpen}
  confirmLabel="Deploy this revision"
  description={pendingRevision
    ? `Redeploys ${pendingRevision.imageRef}${pendingRevision.gitCommit ? ` (commit ${pendingRevision.gitCommit.slice(0, 7)})` : ""} exactly as it ran, skipping the build and the image scan. Volumes are always kept as they are now.`
    : ""}
  destructive={false}
  onConfirm={() => revisionForm?.requestSubmit()}
  title="Deploy this revision?"
>
  <CheckBox
    helperText={pendingRevision?.hasConfigSnapshot
      ? "Put back the environment variables, CPU, memory, replicas, port and network mode this revision ran with. Off keeps the current ones."
      : "This revision was deployed before configs were recorded, so only its image can be restored."}
    id="restoreConfig"
    label="Also restore env vars, resources and networking"
    name="restoreConfigToggle"
    bind:checked={restoreConfig}
  />
</ConfirmDialog>
