<script lang="ts">
	import { GitBranch, Link2, Plus, Trash2, Unlink } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import EntityList from "$lib/components/entity-list.svelte";
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
	import { enhanceToast } from "$lib/toast";
	import { ViewMode } from "$lib/view-mode.svelte";

	const { data, form } = $props();

	onMount(() => title.set("Git Providers"));

	const view = new ViewMode("git-providers");

	const rows = $derived(
		data.providers.map((provider) => ({
			connected: data.connectedProviderIds.includes(provider.id),
			description:
				data.isAdmin && !data.connectedProviderIds.includes(provider.id)
					? `Callback URL for this provider's OAuth App: ${callbackUrlFor(provider.id)}`
					: null,
			id: provider.id,
			name: provider.name,
			subtitle: `${provider.kind}${provider.baseUrl ? ` · ${provider.baseUrl}` : ""}`,
			title: provider.name,
		})),
	);
	type ProviderRow = (typeof rows)[number];

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

{#snippet media(_provider: ProviderRow)}
  <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-md">
    <GitBranch class="size-5" />
  </div>
{/snippet}

{#snippet badge(provider: ProviderRow)}
  {#if provider.connected}
    <span class="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-600 dark:text-emerald-400">
      Connected
    </span>
  {/if}
{/snippet}

{#snippet actions(provider: ProviderRow)}
  {#if provider.connected}
    <form
      action="?/disconnect"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't disconnect.",
        loading: "Disconnecting",
        success: "Disconnected.",
      })}
    >
      <input name="providerId" type="hidden" value={provider.id}>
      <Button size="sm" type="submit" variant="outline">
        <Unlink class="size-4" />
        Disconnect
      </Button>
    </form>
  {:else}
    <Button href={`/api/v1/git-providers/${provider.id}/connect`} size="sm">
      <Link2 class="size-4" />
      Connect
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
{/snippet}

<div class="p-5 md:p-6">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">Git Providers</h1>
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
    <div class="panel mb-6 rounded-md p-5">
      <p class="text-text-subtle mb-4 text-xs">
        Register an OAuth App on the provider's own site first (its
        developer/application settings), then paste the client ID/secret here.
        The callback URL to give it is shown once you've added the provider
        below.
      </p>
      {#if form?.error}
        <p class="mb-4 text-sm text-red-500">{form.error}</p>
      {/if}
      <form
        action="?/addProvider"
        class="space-y-4"
        method="POST"
        use:enhance={enhanceToast({
          error: "Check the form for errors.",
          loading: "Adding the provider",
          onSettled: () => {
            submitting = false;
          },
          onStart: () => {
            submitting = true;
          },
          onSuccess: () => {
            showAddForm = false;
          },
          success: "Provider added.",
        })}
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
            <input
              class={input}
              id="clientId"
              name="clientId"
              required
              type="text"
            >
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
    <EntityList {actions} {badge} items={rows} {media} {view} />
  {/if}
</div>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete"
  description={`Delete "${pendingDeleteName}"? Anyone connected to it loses that connection.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete git provider"
/>
