<script lang="ts">
	import { Ticket, Trash2 } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import Alert from "$lib/components/alert.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import CopyBox from "$lib/components/copy-box.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { timeAgo } from "$lib/formatting";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	let username = $state("");
	let confirmOpen = $state(false);
	let confirmTitle = $state("");
	let confirmForm: HTMLFormElement | null = null;

	function requestConfirm(event: MouseEvent, title: string) {
		confirmForm = (event.currentTarget as HTMLElement).closest("form");
		confirmTitle = title;
		confirmOpen = true;
	}
</script>

{#if !data.status.authEnabled}
  <Alert class="mb-6" title="Auth is off, so these tokens aren't in effect.">
    Anyone who can reach the registry can pull from it, and push to it if it's
    published. Turn auth on under Settings to make tokens the only way in.
  </Alert>
{/if}

{#if form?.created}
  <div
    class="border-accent/40 bg-surface-1 mb-6 rounded-lg border p-4"
  >
    <h2 class="text-text text-sm font-medium">
      {form.created.username} is ready
    </h2>
    <p class="text-text-muted mt-1 mb-3 text-sm">
      This is the only time the secret is shown. Log in with it:
    </p>
    <CopyBox
      value={`docker login ${data.loginEndpoint} -u ${form.created.username} -p ${form.created.secret}`}
    />
  </div>
{/if}

<section class="border-border bg-surface-1 mb-6 rounded-lg border p-4">
  <h2 class="text-text mb-1 text-sm font-medium">New token</h2>
  <p class="text-text-muted mb-3 text-sm">
    A token can pull and push. The registry's htpasswd auth has no concept of
    read-only, so scope it by handing out one token per user or CI job and
    revoking the one you're done with.
  </p>
  <form
    action="?/create"
    class="flex flex-wrap items-center gap-2"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't create that token.",
      loading: "Creating the token",
      onSuccess: () => {
        username = "";
      },
      success: "Token created.",
    })}
  >
    <Input
      autocomplete="off"
      bind:value={username}
      class="max-w-xs"
      name="username"
      placeholder="ci-pipeline"
      required
    />
    <Button type="submit">Create token</Button>
  </form>
</section>

{#if data.tokens.length === 0}
  <EmptyState
    icon={Ticket}
    subtitle="Create one above to push or pull from this registry."
    title="No tokens yet"
  />
{:else}
  <ul class="border-border bg-surface-1 divide-border divide-y rounded-lg border">
    {#each data.tokens as token (token.id)}
      <li class="flex items-center justify-between gap-3 px-4 py-3">
        <div class="min-w-0">
          <p class="text-text font-mono text-sm">{token.username}</p>
          <p class="text-text-muted mt-0.5 text-xs">
            Created {timeAgo(token.createdAt)}
          </p>
        </div>
        <form
          action="?/revoke"
          method="POST"
          use:enhance={enhanceToast({
            error: "Couldn't revoke that token.",
            loading: `Revoking ${token.username}`,
            success: "Token revoked.",
          })}
        >
          <input name="id" type="hidden" value={token.id} />
          <Button
            onclick={(event: MouseEvent) =>
              requestConfirm(event, `Revoke ${token.username}?`)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 class="size-3.5" />
            Revoke
          </Button>
        </form>
      </li>
    {/each}
  </ul>
{/if}

<ConfirmDialog
  bind:open={confirmOpen}
  confirmLabel="Revoke"
  description="Anything logged in with this token stops being able to pull or push as soon as the registry reloads, which happens straight away."
  onConfirm={() => confirmForm?.requestSubmit()}
  title={confirmTitle}
/>
