<script lang="ts">
	import { AppWindow, KeyRound, Plus, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import CopyBox from "$lib/components/copy-box.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import {
		API_KEY_SCOPE_OPTIONS,
		type ApiKeyScope,
		READ_ONLY_ROLE,
	} from "$lib/permissions";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	onMount(() => title.set("Authorized Clients"));

	let newKeyName = $state("");
	const roleIsReadOnly = $derived(data.user?.role === READ_ONLY_ROLE);
	let newKeyScope = $state<ApiKeyScope>("full");
	const newKeyScopeOption = $derived(
		API_KEY_SCOPE_OPTIONS.find(
			(option) => option.value === (roleIsReadOnly ? "read" : newKeyScope),
		) ?? API_KEY_SCOPE_OPTIONS[0],
	);
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

	let appDialogOpen = $state(false);
	let pendingAppName = $state("");
	let pendingAppForm: HTMLFormElement | null = null;

	function requestAppRevoke(e: MouseEvent, name: string) {
		pendingAppForm = (e.currentTarget as HTMLElement).closest("form");
		pendingAppName = name;
		appDialogOpen = true;
	}

	function requestRevoke(e: MouseEvent, name: string) {
		pendingRevokeForm = (e.currentTarget as HTMLElement).closest("form");
		pendingRevokeName = name;
		revokeDialogOpen = true;
	}
</script>

<div class="space-y-6">
  {#if form?.success && "key" in form && form.key}
    <div class="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
      <p class="font-semibold text-emerald-800 dark:text-emerald-400">
        API key created
      </p>
      <p class="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
        Copy it now : it won't be shown again.
      </p>
      <CopyBox
        class="mt-2 border-emerald-200 bg-surface dark:border-emerald-900/40"
        label="the API key"
        value={form.key}
      />
    </div>
  {/if}

  <section class="rounded-md panel">
    <div class="flex items-center gap-3 border-b border-border px-5 py-4">
      <div class="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <KeyRound class="size-4" />
      </div>
      <div>
        <h2 class="eyebrow">Authorized Clients</h2>
        <p class="text-xs text-text-muted">
          API keys for the Homerun CLI or your own scripts. Same
          <code>x-api-key</code>
          auth the REST API accepts. A read-only key can call every
          <code>GET</code> endpoint and is refused with a 403 on anything that
          writes.
        </p>
      </div>
    </div>

    <div class="border-b border-border p-5">
      <form
        action="?/create"
        class="flex flex-wrap items-end gap-2"
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
        <div class="min-w-48 flex-1">
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
        <div>
          <div class="mb-1.5 block text-sm font-medium text-text">Access</div>
          <Select.Root
            disabled={roleIsReadOnly}
            name="scope"
            type="single"
            bind:value={newKeyScope}
          >
            <Select.Trigger aria-label="Access" class="w-40">
              {newKeyScopeOption.label}
            </Select.Trigger>
            <Select.Content>
              {#each API_KEY_SCOPE_OPTIONS as option (option.value)}
                <Select.Item label={option.label} value={option.value}>
                  <div>
                    <p>{option.label}</p>
                    <p class="text-xs text-text-muted">{option.description}</p>
                  </div>
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
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
            <div class="flex items-center gap-4 rounded-md border border-border p-4">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-text">
                  {key.name ?? "Unnamed key"}
                  {#if key.scope === "read"}
                    <span class="ml-1.5 rounded-full border border-border px-2 py-0.5 text-[0.65rem] font-semibold text-text-muted">
                      Read-only
                    </span>
                  {/if}
                  {#if !key.enabled}
                    <span class="ml-1.5 rounded-full bg-red-100 px-2 py-0.5 text-[0.65rem] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                      Disabled
                    </span>
                  {/if}
                </p>
                <p class="mt-0.5 truncate text-xs text-text-muted">
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

  <section class="rounded-md panel">
    <div class="flex items-center gap-3 border-b border-border px-5 py-4">
      <div class="flex size-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <AppWindow class="size-4" />
      </div>
      <div>
        <h2 class="eyebrow">Apps using your Homerun account</h2>
        <p class="text-xs text-text-muted">
          Apps you signed in to with "Sign in with Homerun". Revoking one signs
          it out of your account: its tokens stop working, and it asks for your
          consent again next time.
        </p>
      </div>
    </div>
    <div class="p-5">
      {#if data.authorizedApps.length === 0}
        <EmptyState
          icon={AppWindow}
          subtitle="Apps you sign in to with your Homerun account show up here."
          title="No apps yet"
        />
      {:else}
        <div class="space-y-2.5">
          {#each data.authorizedApps as app (app.clientId)}
            <div class="flex items-center gap-4 rounded-md border border-border p-4">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-text">{app.name}</p>
                {#if app.scopes.length > 0}
                  <p class="mt-0.5 truncate text-xs text-text-muted">
                    {app.scopes.join(", ")}
                  </p>
                {/if}
                <p class="mt-0.5 text-xs text-text-subtle">
                  last authorized {formatDate(app.lastAuthorizedAt)}
                </p>
              </div>
              <form
                action="?/revokeApp"
                method="POST"
                use:enhance={enhanceToast({
                  error: "Couldn't revoke that app.",
                  loading: "Revoking the app",
                  success: "App revoked.",
                })}
              >
                <input name="clientId" type="hidden" value={app.clientId}>
                <Button
                  class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
                  onclick={(e) => requestAppRevoke(e, app.name)}
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
  bind:open={appDialogOpen}
  confirmLabel="Revoke"
  description={`Revoke "${pendingAppName}"? It's signed out of your account right away and has to ask for your consent again.`}
  onConfirm={() => pendingAppForm?.requestSubmit()}
  title="Revoke app access"
/>

<ConfirmDialog
  bind:open={revokeDialogOpen}
  confirmLabel="Revoke"
  description={`Revoke "${pendingRevokeName}"? Anything using this key will stop working immediately.`}
  onConfirm={() => pendingRevokeForm?.requestSubmit()}
  title="Revoke API key"
/>
