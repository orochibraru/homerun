<script lang="ts">
	import { ChevronRight, Clock } from "@lucide/svelte";
	import { onMount } from "svelte";
	import EnvironmentBadge from "#lib/components/environment-badge.svelte";
	import StatusBadge from "#lib/components/status-badge.svelte";
	import { timeAgo } from "#lib/formatting.js";
	import { title } from "#lib/store/title.js";
	import { resolve } from "$app/paths";

	const { data } = $props();

	onMount(() => title.set(`${data.service.name} · Revisions`));

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
                <a
                    class="hover:bg-surface-2 flex w-full items-center gap-4 px-5 py-3"
                    href={resolve(
                        "/(protected)/services/[serviceId]/environments/revisions/[revisionId]",
                        { revisionId: revision.id, serviceId: data.service.id },
                    )}
                >
                    <StatusBadge status={revision.status} />
                    <div class="min-w-0 flex-1">
                        <p class="text-text flex flex-wrap items-center gap-2 truncate text-xs font-medium">
                            <span class="truncate">
                                {revision.imageRef ?? `${data.service.image}:${data.service.tag}`}
                            </span>
                            <EnvironmentBadge environment={revision.environment} />
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
                                · {revision.gitRef ? `${revision.gitRef}@` : ""}{revision.gitCommit.slice(0, 7)}
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
                    <ChevronRight class="text-text-muted size-4 shrink-0" />
                </a>
            {/each}
        </div>
    {/if}
</section>
