<script lang="ts">
	import { GitBranch, Link2, Plus, Trash2, Unlink } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import {
		inputClass as input,
		labelClass as label,
	} from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import { title } from "$lib/store/title";

	const { data, form } = $props();

	onMount(() => title.set("Git Providers"));

	const kindOptions: [string, string][] = [
		["github", "GitHub"],
		["gitlab", "GitLab"],
		["gitea", "Gitea (self-hosted)"],
		["bitbucket", "Bitbucket"],
	];

	let showAddForm = $state(false);
	let kind = $state("github");
	const kindLabel = $derived(
		kindOptions.find(([val]) => val === kind)?.[1] ?? "GitHub",
	);
	const requiresBaseUrl = $derived(kind === "gitea");
	let submitting = $state(false);

	let deleteDialogOpen = $state(false);
	let pendingDeleteName = $state("");
	let pendingDeleteForm: HTMLFormElement | null = null;

	function requestDelete(e: MouseEvent, name: string) {
		pendingDeleteForm = (e.currentTarget as HTMLElement).closest("form");
		pendingDeleteName = name;
		deleteDialogOpen = true;
	}

	function callbackUrlFor(providerId: string): string {
		if (typeof window === "undefined") {
			return "";
		}
		return `${window.location.origin}/api/v1/git-providers/${providerId}/callback`;
	}
</script>

<div class="p-6 md:p-8">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-2xl font-bold">Git Providers</h1>
      <p class="text-text-muted mt-1 text-sm">
        Connect a git hosting account (GitHub, GitLab, self-hosted Gitea,
        Bitbucket) so a git-based service's Source tab can browse your repos
        instead of pasting a raw URL : no personal access token needed.
      </p>
    </div>
    {#if data.isAdmin}
      <Button
        onclick={() => {
          showAddForm = !showAddForm;
        }}
      >
        <Plus class="size-4" />
        Add provider
      </Button>
    {/if}
  </div>

  {#if data.isAdmin && showAddForm}
    <div class="border-border bg-surface mb-6 rounded-2xl border p-5">
      <p class="text-text-subtle mb-4 text-xs">
        Register an OAuth App on the provider's own site first (its
        developer/application settings), then paste the client ID/secret
        here. The callback URL to give it is shown once you've added the
        provider below.
      </p>
      {#if form?.error}
        <p class="mb-4 text-sm text-red-500">{form.error}</p>
      {/if}
      <form
        action="?/addProvider"
        class="space-y-4"
        method="POST"
        use:enhance={() => {
          submitting = true;
          return async ({ result, update }) => {
            submitting = false;
            if (result.type === "success") {
              showAddForm = false;
              toast.success("Provider added.");
            } else if (result.type === "failure") {
              toast.error("Check the form for errors.");
            }
            await update();
          };
        }}
      >
        <div>
          <p class={label}>Provider</p>
          <SelectRoot name="kind" type="single" bind:value={kind}>
            <SelectTrigger class="w-full">
              {kindLabel}
            </SelectTrigger>
            <SelectContent>
              {#each kindOptions as [val, lbl] (val)}
                <SelectItem label={lbl} value={val} />
              {/each}
            </SelectContent>
          </SelectRoot>
        </div>
        <div>
          <label class={label} for="name">Name</label>
          <input
            class={input}
            id="name"
            name="name"
            placeholder="e.g. Company GitHub"
            required
            type="text"
          />
        </div>
        {#if requiresBaseUrl}
          <div>
            <label class={label} for="baseUrl">
              Base URL <span class="text-red-500">*</span>
            </label>
            <input
              class={input}
              id="baseUrl"
              name="baseUrl"
              placeholder="https://gitea.example.com"
              required
              type="text"
            />
          </div>
        {/if}
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class={label} for="clientId">Client ID</label>
            <input class={input} id="clientId" name="clientId" required type="text">
          </div>
          <div>
            <label class={label} for="clientSecret">Client secret</label>
            <input
              class={input}
              id="clientSecret"
              name="clientSecret"
              required
              type="password"
            >
          </div>
        </div>
        <div class="flex justify-end">
          <Button disabled={submitting} type="submit">Add provider</Button>
        </div>
      </form>
    </div>
  {/if}

  {#if data.providers.length === 0}
    <EmptyState
      icon={GitBranch}
      subtitle="Add one above to browse repos when creating a git-based service."
      title="No git providers configured"
    />
  {:else}
    <div class="space-y-3">
      {#each data.providers as provider (provider.id)}
        {@const connected = data.connectedProviderIds.includes(provider.id)}
        <div class="border-border bg-surface rounded-2xl border p-5">
          <div class="flex items-center gap-4">
            <div
              class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl"
            >
              <GitBranch class="size-5" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-text truncate text-sm font-semibold">
                {provider.name}
                <span class="text-text-subtle ml-1 text-xs font-normal"
                  >({provider.kind}{provider.baseUrl
                    ? ` · ${provider.baseUrl}`
                    : ""})</span
                >
              </p>
              <p class="text-text-muted mt-0.5 truncate text-xs">
                {#if connected}
                  <span class="text-emerald-600">Connected</span> : this account
                  can browse repos on this provider.
                {:else}
                  Not connected yet.
                {/if}
              </p>
            </div>
            {#if connected}
              <form
                action="?/disconnect"
                method="POST"
                use:enhance={() =>
                  async ({ result, update }) => {
                    if (result.type === "success") {
                      toast.success("Disconnected.");
                    }
                    await update();
                  }}
              >
                <input name="providerId" type="hidden" value={provider.id}>
                <Button size="icon-sm" title="Disconnect" type="submit" variant="ghost">
                  <Unlink class="size-4" />
                </Button>
              </form>
            {:else}
              <Button
                href={`/api/v1/git-providers/${provider.id}/connect`}
                size="icon-sm"
                title="Connect"
                variant="ghost"
              >
                <Link2 class="size-4" />
              </Button>
            {/if}
            {#if data.isAdmin}
              <form action="?/deleteProvider" method="POST">
                <input name="id" type="hidden" value={provider.id}>
                <Button
                  class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
                  onclick={(e) => requestDelete(e, provider.name)}
                  size="icon-sm"
                  title="Delete"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 class="size-4" />
                </Button>
              </form>
            {/if}
          </div>
          {#if data.isAdmin && !connected}
            <p class="border-border text-text-subtle mt-3 border-t pt-3 font-mono text-xs">
              Callback URL for this provider's OAuth App: {callbackUrlFor(
                provider.id,
              )}
            </p>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete"
  description={`Delete "${pendingDeleteName}"? Anyone connected to it loses that connection.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete git provider"
/>
