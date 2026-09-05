<script lang="ts">
	import { GitBranch } from "@lucide/svelte";
	import { untrack } from "svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import {
		hasDockerfile,
		listProviderRepos,
	} from "$lib/remote/git-repos.remote";
	import type { GitRepo } from "$lib/services/git-provider.service";

	interface ConnectedProvider {
		id: string;
		name: string;
		providerUsername: string;
	}

	const {
		labelClass,
		onpick,
		providers,
	}: {
		labelClass: string;
		onpick: (repo: GitRepo) => void;
		providers: ConnectedProvider[];
	} = $props();

	let providerId = $state(untrack(() => providers[0]?.id ?? ""));
	let reposPromise = $state<Promise<GitRepo[]> | null>(null);
	let selectedRepo = $state("");
	let dockerfilePromise = $state<Promise<boolean> | null>(null);

	function loadRepos() {
		selectedRepo = "";
		dockerfilePromise = null;
		reposPromise = providerId ? listProviderRepos(providerId) : null;
	}

	function pickRepo(repos: GitRepo[], fullName: string) {
		selectedRepo = fullName;
		dockerfilePromise = null;
		const repo = repos.find((r) => r.fullName === fullName);
		if (!repo) {
			return;
		}
		onpick(repo);
		dockerfilePromise = hasDockerfile({
			providerId,
			ref: repo.defaultBranch,
			repo: fullName,
		});
	}
</script>

<div class="border-border rounded-xl border p-4">
  <p class={labelClass}>Browse repos</p>
  <div class="flex flex-wrap gap-2">
    {#if providers.length > 1}
      <select bind:value={providerId} class="glass rounded-lg px-3 py-2 text-sm">
        {#each providers as p (p.id)}
          <option value={p.id}>{p.name} ({p.providerUsername})</option>
        {/each}
      </select>
    {/if}
    <Button onclick={loadRepos} type="button" variant="outline">
      <GitBranch class="size-4" />
      List repos
    </Button>
  </div>

  {#if reposPromise}
    {#await reposPromise}
      <p class="text-text-muted mt-3 flex items-center gap-2 text-xs">
        <Spinner />
        Listing repos…
      </p>
    {:then repos}
      {#if repos.length === 0}
        <p class="text-text-muted mt-3 text-xs">
          No repositories on this connection.
        </p>
      {:else}
        <select
          bind:value={selectedRepo}
          class="glass mt-3 w-full rounded-lg px-3 py-2 text-sm"
          onchange={(e) => pickRepo(repos, e.currentTarget.value)}
        >
          <option value="">Select a repo…</option>
          {#each repos as repo (repo.fullName)}
            <option value={repo.fullName}>
              {repo.fullName}{repo.private ? " (private)" : ""}
            </option>
          {/each}
        </select>
      {/if}
    {:catch}
      <p class="mt-3 text-xs text-amber-600">
        Couldn't list repos for that provider.
      </p>
    {/await}
  {/if}

  {#if dockerfilePromise}
    {#await dockerfilePromise then exists}
      <p class="mt-2 text-xs {exists ? 'text-emerald-600' : 'text-amber-600'}">
        {
          exists
          ? "✓ Dockerfile found at the repo root."
          : "⚠ No Dockerfile found at the repo root on this branch : the build will fail unless one exists at the path you set below."
        }
      </p>
    {:catch}
      <p class="text-text-muted mt-2 text-xs">
        Couldn't check for a Dockerfile on this branch.
      </p>
    {/await}
  {/if}
</div>
