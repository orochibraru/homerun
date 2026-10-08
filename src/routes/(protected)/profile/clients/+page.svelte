<script lang="ts">
	import { AppWindow, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	const { data } = $props();

	onMount(() => title.set("Authorized Clients"));

	function formatDate(value: Date | string | null): string {
		return value ? new Date(value).toLocaleString() : "never";
	}

	let appDialogOpen = $state(false);
	let pendingAppName = $state("");
	let pendingAppForm: HTMLFormElement | null = null;

	function requestAppRevoke(e: MouseEvent, name: string) {
		pendingAppForm = (e.currentTarget as HTMLElement).closest("form");
		pendingAppName = name;
		appDialogOpen = true;
	}
</script>

<div class="space-y-6">
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
