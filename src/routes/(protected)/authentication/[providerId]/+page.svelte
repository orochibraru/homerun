<script lang="ts">
	import { ArrowLeft, ExternalLink, Trash2 } from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import OauthProviderFields, {
		type ProviderFieldValues,
	} from "$lib/components/oauth-provider-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	let submitting = $state(false);
	let confirmingDelete = $state(false);
	let deleteForm = $state<HTMLFormElement | undefined>();

	const values = $state<ProviderFieldValues>(
		untrack(() => ({
			clientId: data.provider.clientId,
			discoveryUrl: data.provider.discoveryUrl,
			enabled: data.provider.enabled,
			hasSecret: data.provider.hasSecret,
			label: data.provider.label,
			name: data.provider.name,
			pkce: data.provider.pkce,
			scopes: data.provider.scopes,
			signOutOfProvider: data.provider.signOutOfProvider,
			templateHint: "",
			tokenAuthMethod: data.provider.tokenAuthMethod,
		})),
	);

	onMount(() => title.set(data.provider.label));
</script>

<div class="space-y-6 p-6 md:p-8">
  <div>
    <Button href={resolve("/authentication")} size="sm" variant="ghost">
      <ArrowLeft class="size-4" />
      Authentication
    </Button>
    <h1 class="text-text mt-2 text-xl font-semibold">{data.provider.label}</h1>
    <p class="text-text-subtle mt-1 font-mono text-sm">{data.provider.name}</p>
  </div>

  <section class="glass rounded-2xl">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Provider</h2>
      <p class="text-text-muted text-xs">
        Saving rebuilds the auth backend live, no restart needed.
      </p>
    </div>
    <form
      action="?/update"
      class="space-y-5 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the provider.",
        loading: "Saving the provider",
        onSettled: () => {
          submitting = false;
        },
        onStart: () => {
          submitting = true;
        },
        success: "Provider saved.",
      })}
    >
      {#if form?.error}
        <p class="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-500">
          {form.error}
        </p>
      {/if}

      <OauthProviderFields
        callbackBase={data.callbackBase}
        nameLocked
        {values}
      />

      <div class="flex justify-end">
        <Button disabled={submitting} type="submit">Save</Button>
      </div>
    </form>
  </section>

  {#if data.usedBy.length > 0}
    <section class="glass rounded-2xl">
      <div class="border-border border-b px-5 py-4">
        <h2 class="eyebrow">Used by</h2>
        <p class="text-text-muted text-xs">
          Apps that accept this provider on their login wall. Deleting it
          removes that option from each of them.
        </p>
      </div>
      <div class="divide-border divide-y">
        {#each data.usedBy as svc (svc.id)}
          <a
            class="hover:bg-surface-2 flex items-center gap-3 px-5 py-3"
            href="{resolve('/services')}/{svc.id}/networking"
          >
            <span class="text-text flex-1 truncate text-sm">{svc.name}</span>
            <ExternalLink class="text-text-subtle size-3.5" />
          </a>
        {/each}
      </div>
    </section>
  {/if}

  <!-- ═══ Danger zone ═══ -->
  <section class="rounded-2xl border border-red-200 dark:border-red-900/40">
    <div class="border-b border-red-200 px-5 py-4 dark:border-red-900/40">
      <h2 class="eyebrow text-red-600 dark:text-red-400">Danger zone</h2>
      <p class="text-text-muted text-xs">
        Removing this provider signs nobody out, but it stops being offered on
        the sign-in page and is dropped from every app that accepted it.
      </p>
    </div>
    <div class="p-5">
      <Button
        class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
        onclick={() => {
          confirmingDelete = true;
        }}
        variant="outline"
      >
        <Trash2 class="size-4" />
        Remove provider
      </Button>
      <form action="?/delete" bind:this={deleteForm} method="POST"></form>
    </div>
  </section>
</div>

<ConfirmDialog
  bind:open={confirmingDelete}
  confirmLabel="Remove provider"
  confirmPhrase={data.provider.name}
  description={data.usedBy.length > 0
  ? `${data.usedBy.length} app${data.usedBy.length === 1 ? "" : "s"} currently accept this provider and will lose it as a sign-in option.`
  : "It stops being offered on the sign-in page immediately."}
  onConfirm={() => deleteForm?.requestSubmit()}
  title="Remove {data.provider.label}?"
/>
