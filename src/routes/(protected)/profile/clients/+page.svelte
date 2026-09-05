<script lang="ts">
	import { Copy, KeyRound, Plus, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	onMount(() => title.set("Authorized Clients"));

	let newKeyName = $state("");
	let creating = $state(false);
	let revokeDialogOpen = $state(false);
	let pendingRevokeName = $state("");
	let pendingRevokeForm: HTMLFormElement | null = null;

	function formatDate(value: Date | string | null): string {
		if (!value) {
			return "never";
		}
		return new Date(value).toLocaleString();
	}

	function requestRevoke(e: MouseEvent, name: string) {
		pendingRevokeForm = (e.currentTarget as HTMLElement).closest("form");
		pendingRevokeName = name;
		revokeDialogOpen = true;
	}

	async function copyKey(key: string) {
		try {
			await navigator.clipboard.writeText(key);
			toast.success("Copied to clipboard.");
		} catch {
			toast.error("Couldn't copy : select and copy it manually.");
		}
	}
</script>

<div class="space-y-6">
  {#if form?.success && "key" in form && form.key}
    <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
      <p class="font-semibold text-emerald-800 dark:text-emerald-400">
        API key created
      </p>
      <p class="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
        Copy it now : it won't be shown again.
      </p>
      <div class="mt-2 flex items-center gap-2">
        <code
          class="flex-1 overflow-x-auto rounded-lg border border-emerald-200 bg-surface px-3 py-2 font-mono text-xs whitespace-nowrap dark:border-emerald-900/40"
        >{form.key}</code>
        <Button onclick={() => copyKey(form.key as string)} size="icon-sm" variant="outline">
          <Copy class="size-4" />
        </Button>
      </div>
    </div>
  {/if}

  <section class="rounded-2xl glass">
    <div class="flex items-center gap-3 border-b border-border px-5 py-4">
      <div class="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <KeyRound class="size-4" />
      </div>
      <div>
        <h2 class="eyebrow">Authorized Clients</h2>
        <p class="text-xs text-text-muted">
          API keys for the Homerun CLI or your own scripts. Same
          <code>x-api-key</code>
          auth the REST API accepts.
        </p>
      </div>
    </div>

    <div class="border-b border-border p-5">
      <form
        action="?/create"
        class="flex items-end gap-2"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't create the key.",
          loading: "Creating the key",
          onSettled: () => {
            creating = false;
            newKeyName = "";
          },
          onStart: () => {
            creating = true;
          },
          success: "Key created.",
        })}
      >
        <div class="flex-1">
          <label class="mb-1.5 block text-sm font-medium text-text" for="name">
            New key name
          </label>
          <Input
            id="name"
            name="name"
            placeholder="e.g. Homerun CLI"
            type="text"
            bind:value={newKeyName}
          />
        </div>
        <Button disabled={creating} type="submit">
          {#if creating}
            <Spinner />
          {:else}
            <Plus class="size-4" />
          {/if}
          Generate
        </Button>
      </form>
    </div>

    <div class="p-5">
      {#if data.apiKeys.length === 0}
        <EmptyState
          icon={KeyRound}
          subtitle="Generate one above to authenticate the Homerun CLI or a script."
          title="No API keys yet"
        />
      {:else}
        <div class="space-y-2.5">
          {#each data.apiKeys as key (key.id)}
            <div class="flex items-center gap-4 rounded-xl border border-border p-4">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-text">
                  {key.name ?? "Unnamed key"}
                  {#if !key.enabled}
                    <span class="ml-1.5 rounded-full bg-red-100 px-2 py-0.5 text-[0.65rem] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                      Disabled
                    </span>
                  {/if}
                </p>
                <p class="mt-0.5 truncate font-mono text-xs text-text-muted">
                  {key.prefix ?? ""}{key.start ?? "••••••••"}…
                </p>
                <p class="mt-0.5 text-xs text-text-subtle">
                  created {formatDate(key.createdAt)}
                  · last used {formatDate(key.lastRequest)}
                  {#if key.expiresAt}
                    · expires {formatDate(key.expiresAt)}
                  {/if}
                </p>
              </div>
              <form
                action="?/revoke"
                method="POST"
                use:enhance={enhanceToast({
                  error: "Couldn't revoke that key.",
                  loading: "Revoking the key",
                  success: "Key revoked.",
                })}
              >
                <input name="keyId" type="hidden" value={key.id}>
                <Button
                  class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
                  onclick={(e) => requestRevoke(e, key.name ?? "this key")}
                  size="icon-sm"
                  title="Revoke"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 class="size-4" />
                </Button>
              </form>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </section>
</div>

<ConfirmDialog
  bind:open={revokeDialogOpen}
  confirmLabel="Revoke"
  description={`Revoke "${pendingRevokeName}"? Anything using this key will stop working immediately.`}
  onConfirm={() => pendingRevokeForm?.requestSubmit()}
  title="Revoke API key"
/>
