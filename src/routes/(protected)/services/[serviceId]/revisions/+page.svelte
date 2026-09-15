<script lang="ts">
	import { ChevronDown, Clock } from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { page } from "$app/state";
	import AnsiLine from "$lib/components/ansi-line.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { timeAgo } from "$lib/formatting";
	import { title } from "$lib/store/title";

	const { data } = $props();

	onMount(() => title.set(`${data.service.name} · Revisions`));

	let expandedDeploymentId = $state<string | null>(
		untrack(() => page.url.searchParams.get("deployment")),
	);

	// Every provider Homerun can clone from (GitHub, GitLab, Gitea, Forgejo)
	// serves a commit at <repo>/commit/<sha>, so the link is derived from the
	// clone URL rather than costing an API call per revision.
	function commitHref(commit: string): string | null {
		const url = data.service.gitUrl;
		if (!url?.startsWith("http")) {
			return null;
		}
		return `${url.replace(/\.git$/, "").replace(/\/$/, "")}/commit/${commit}`;
	}
</script>

<section class="panel rounded-md">
    <div class="border-border flex items-center gap-2 border-b px-5 py-4">
        <Clock class="text-text-muted size-4" />
        <h2 class="eyebrow">Revisions</h2>
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
                            <p class="text-text truncate text-xs font-medium">
                                {dep.imageRef ?? `${data.service.image}:${data.service.tag}`}
                                {#if dep.startedAt && dep.finishedAt}
                                    <span class="text-text-subtle font-normal">
                                        · took {Math.max(
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
