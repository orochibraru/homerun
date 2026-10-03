<script lang="ts">
	import { UserRound, Users, UserX } from "@lucide/svelte";
	import { tick } from "svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { formatDate, timeAgo } from "#lib/formatting.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	const { data } = $props();

	let target = $state<{ name: string; userId: string } | null>(null);
	let confirming = $state(false);
	let revokeForm = $state<HTMLFormElement | undefined>();

	/** Opens the confirmation for one person, or for everyone when `grantee` is null. */
	function askRevoke(grantee: { name: string; userId: string } | null) {
		target = grantee;
		confirming = true;
	}

	/** Submits the revoke form once the hidden user id has caught up with the choice. */
	async function confirmRevoke() {
		await tick();
		revokeForm?.requestSubmit();
	}
</script>

<section class="panel rounded-md">
  <PanelHeader
    description="Everyone who has let {data.app.name} use their Homerun account. Revoking signs them out of it: their tokens stop working and the next sign-in asks for consent again."
    icon={Users}
    title="Authorized users"
  >
    {#snippet trailing()}
      {#if data.grantees.length > 1}
        <Button onclick={() => askRevoke(null)} size="sm" variant="outline">
          <UserX class="size-4" />
          Revoke everyone
        </Button>
      {/if}
    {/snippet}
  </PanelHeader>

  {#if data.grantees.length === 0}
    <div class="p-5">
      <EmptyState
        icon={UserRound}
        subtitle="People show up here once they sign in to {data.app.name} with Homerun."
        title="Nobody yet"
      />
    </div>
  {:else}
    <ul class="divide-border divide-y">
      {#each data.grantees as grantee (grantee.userId)}
        <li class="flex flex-wrap items-center gap-3 px-5 py-3">
          <span class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase">
            {grantee.name.slice(0, 1) || "?"}
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-text truncate text-sm font-medium">{grantee.name}</p>
            <p class="text-text-subtle truncate text-xs">{grantee.email}</p>
          </div>
          <div class="hidden min-w-0 flex-wrap gap-1 md:flex">
            {#each grantee.scopes as scope (scope)}
              <span class="bg-surface-2 text-text-muted rounded px-1.5 py-0.5 font-mono text-[0.6875rem]">
                {scope}
              </span>
            {/each}
          </div>
          <span
            class="text-text-subtle w-24 shrink-0 text-right text-xs"
            title={formatDate(grantee.lastAuthorizedAt)}
          >
            {grantee.lastAuthorizedAt ? timeAgo(grantee.lastAuthorizedAt) : "—"}
          </span>
          <Button
            class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
            onclick={() => askRevoke(grantee)}
            size="sm"
            variant="ghost"
          >
            Revoke
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<form
  action="?/revoke"
  class="hidden"
  method="POST"
  bind:this={revokeForm}
  use:enhance={enhanceToast({
    error: "Couldn't revoke access.",
    loading: "Revoking access",
    success: (result) => {
      const count = (result as { revoked?: number } | undefined)?.revoked ?? 0;
      return count === 1 ? "Access revoked." : `Access revoked for ${count} people.`;
    },
  })}
>
  <input name="userId" type="hidden" value={target?.userId ?? ""}>
</form>

<ConfirmDialog
  confirmLabel="Revoke"
  description={target
    ? `${target.name} is signed out of ${data.app.name} and has to consent again to use it.`
    : `Everyone is signed out of ${data.app.name} and has to consent again to use it.`}
  onConfirm={confirmRevoke}
  title={target ? `Revoke ${target.name}'s access?` : "Revoke everyone's access?"}
  bind:open={confirming}
/>
