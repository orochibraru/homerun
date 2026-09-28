<script lang="ts">
	import { ExternalLink, KeyRound, Plug, Plus, Trash2 } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { inputClass, labelClass } from "$lib/components/form-styles";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();

	let editing = $state<string | null>(null);
	let providerId = $state("");
	let name = $state("");

	const editingConnection = $derived(
		data.connections.find((connection) => connection.id === editing) ?? null,
	);
	const provider = $derived(
		data.providers.find(
			(candidate) =>
				candidate.id === (editingConnection?.provider ?? providerId),
		) ?? null,
	);

	let removing = $state<{ id: string; name: string } | null>(null);
	let confirmingRemove = $state(false);
	let removeForm = $state<HTMLFormElement | undefined>();

	/** Opens the form, empty for a new connection or on an existing one. */
	function open(connectionId: string | null) {
		editing = connectionId ?? "new";
		providerId = "";
		name =
			data.connections.find((connection) => connection.id === connectionId)
				?.name ?? "";
	}
</script>

<div class="space-y-6">
  <section class="panel rounded-md">
    <PanelHeader
      description="Accounts at DNS providers Homerun manages records through. Credentials are stored encrypted and only used to call the provider."
      icon={KeyRound}
      title="DNS providers"
    >
      {#snippet trailing()}
        <Button onclick={() => open(null)} size="sm" variant="outline">
          <Plus class="size-4" />
          Connect a provider
        </Button>
      {/snippet}
    </PanelHeader>

    {#if editing}
      <form
        action="?/saveConnection"
        class="border-border space-y-4 border-b p-5"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't connect the provider.",
          loading: "Saving and testing the connection",
          onSuccess: () => {
            editing = null;
          },
          success: (result) =>
            result && "saved" in result && typeof result.saved === "string" ? result.saved : "Connected.",
        })}
      >
        <input name="connectionId" type="hidden" value={editingConnection?.id ?? ""}>
        {#if !editingConnection}
          <div class="max-w-md">
            <p class={labelClass}>Provider</p>
            <SelectRoot name="provider" type="single" bind:value={providerId}>
              <SelectTrigger aria-label="Provider">{provider?.name ?? "Pick a provider"}</SelectTrigger>
              <SelectContent>
                {#each data.providers as option (option.id)}
                  <SelectItem label={option.name} value={option.id} />
                {/each}
              </SelectContent>
            </SelectRoot>
          </div>
        {/if}
        {#if provider}
          <p class="text-text-muted flex items-center gap-1 text-xs">
            {editingConnection ? `Editing ${editingConnection.name} (${provider.name}). Leave a secret blank to keep it.` : `How to create ${provider.name} credentials:`}
            <a class="text-accent inline-flex items-center gap-0.5 hover:underline" href={provider.docsUrl} rel="noreferrer" target="_blank">
              docs <ExternalLink class="size-3" />
            </a>
          </p>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class={labelClass} for="connection-name">Name</label>
              <input class={inputClass} id="connection-name" name="name" placeholder={provider.name} bind:value={name}>
            </div>
            {#each provider.fields as field (field.key)}
              <div>
                <label class={labelClass} for="field-{field.key}">
                  {field.label}{field.optional ? " (optional)" : ""}
                </label>
                {#if field.secret && field.key.toLowerCase().includes("json")}
                  <textarea
                    class="{inputClass} min-h-24 font-mono text-xs"
                    id="field-{field.key}"
                    name="field_{field.key}"
                    placeholder={editingConnection?.setFields.includes(field.key) ? "Stored: leave blank to keep" : field.placeholder}
                  ></textarea>
                {:else}
                  <input
                    autocomplete="off"
                    class={inputClass}
                    id="field-{field.key}"
                    name="field_{field.key}"
                    placeholder={field.secret && editingConnection?.setFields.includes(field.key) ? "Stored: leave blank to keep" : field.placeholder}
                    type={field.secret ? "password" : "text"}
                  >
                {/if}
                {#if field.help}
                  <p class="text-text-subtle mt-1.5 text-xs">{field.help}</p>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
        <div class="flex justify-end gap-2">
          <Button
            onclick={() => {
              editing = null;
            }}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button disabled={!provider} type="submit">Save and test</Button>
        </div>
      </form>
    {/if}

    {#if data.connections.length === 0}
      <div class="p-5">
        <EmptyState
          icon={Plug}
          subtitle="Connect Cloudflare, Route 53, Hetzner, Namecheap or another provider to manage your domains' records from Homerun."
          title="No DNS provider connected"
        />
      </div>
    {:else}
      <ul class="divide-border divide-y">
        {#each data.connections as connection (connection.id)}
          <li class="flex flex-wrap items-center gap-3 px-5 py-3">
            <span class="min-w-0 flex-1">
              <span class="text-text block truncate text-sm font-medium">{connection.name}</span>
              <span class="text-text-muted block text-xs">{connection.providerName}</span>
            </span>
            <form
              action="?/testConnection"
              method="POST"
              use:enhance={enhanceToast({
                error: "The provider refused the credentials.",
                loading: "Testing the connection",
                success: (result) =>
                  result && "tested" in result && typeof result.tested === "string" ? result.tested : "Connected.",
              })}
            >
              <input name="connectionId" type="hidden" value={connection.id}>
              <Button size="sm" type="submit" variant="outline">Test</Button>
            </form>
            <Button onclick={() => open(connection.id)} size="sm" variant="outline">Edit</Button>
            <Button
              aria-label="Remove {connection.name}"
              onclick={() => {
                removing = { id: connection.id, name: connection.name };
                confirmingRemove = true;
              }}
              size="icon-sm"
              variant="ghost"
            >
              <Trash2 class="size-4" />
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<form
  action="?/deleteConnection"
  class="hidden"
  method="POST"
  bind:this={removeForm}
  use:enhance={enhanceToast({
    error: "Couldn't remove the connection.",
    loading: "Removing the connection",
    success: "Connection removed.",
  })}
>
  <input name="connectionId" type="hidden" value={removing?.id ?? ""}>
</form>

<ConfirmDialog
  confirmLabel="Remove"
  description="Its domains stay, without their records being managed any more. Nothing is deleted at the provider."
  onConfirm={() => removeForm?.requestSubmit()}
  title="Remove {removing?.name ?? 'this connection'}?"
  bind:open={confirmingRemove}
/>
