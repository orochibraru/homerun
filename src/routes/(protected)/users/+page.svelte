<script lang="ts">
	import { Plus, TriangleAlert, X } from "@lucide/svelte";
	import type { SubmitFunction } from "@sveltejs/kit";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "$lib/components/entity-toolbar.svelte";
	import Pagination from "$lib/components/pagination.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { BASE_SORTS } from "$lib/list-sorts";
	import { ROLE_OPTIONS, roleLabel } from "$lib/permissions";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import AddUserPanel from "./add-user-panel.svelte";
	import UserRow from "./user-row.svelte";

	const { data, form } = $props();

	onMount(() => title.set("Users"));

	const filters: FilterGroup[] = [
		{
			key: "role",
			label: "Role",
			options: ROLE_OPTIONS,
		},
	];

	let showAddForm = $state(false);
	let submitting = $state(false);

	function submitToast(loading: string, success: string): SubmitFunction {
		return enhanceToast({
			loading,
			onSettled: () => {
				submitting = false;
			},
			onStart: () => {
				submitting = true;
			},
			onSuccess: () => {
				showAddForm = false;
			},
			success,
		});
	}

	let removeDialogOpen = $state(false);
	let pendingRemoveName = $state("");
	let pendingRemoveForm: HTMLFormElement | null = null;

	function requestRemove(e: MouseEvent, name: string) {
		pendingRemoveForm = (e.currentTarget as HTMLElement).closest("form");
		pendingRemoveName = name;
		removeDialogOpen = true;
	}
</script>

<div class="p-5 md:p-6">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">Users</h1>
      <p class="text-text-muted mt-1 text-sm">
        Admin, developer and read-only accounts for this instance. Public
        sign-up is closed once the first account exists : every account after
        that is created here. A read-only account sees everything but can't
        change anything.
      </p>
    </div>
    <Button
      onclick={() => {
        showAddForm = !showAddForm;
      }}
    >
      <Plus class="size-4" />
      Add user
    </Button>
  </div>

  {#if !data.smtpEnabled}
    <div class="mb-6 flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
      <TriangleAlert class="mt-0.5 size-4 shrink-0" />
      <div>
        <p class="font-semibold">Setting up SMTP is highly recommended.</p>
        <p class="mt-1">
          A new user chooses their own password the first time they sign in.
          With SMTP, Homerun first emails them a code to prove the address is
          theirs. Without it, anyone who knows a new user's email can pick that
          password before they do.
          <a class="font-medium underline" href={resolve("/(protected)/settings/email")}>
            Set up SMTP
          </a>
        </p>
      </div>
    </div>
  {/if}

  <AddUserPanel
    error={form?.error}
    open={showAddForm}
    smtpEnabled={data.smtpEnabled}
    {submitToast}
    {submitting}
  />

  <EntityToolbar
    sorts={BASE_SORTS} {filters} placeholder="Search users by name or email…" />

  {#if data.users.length === 0}
    <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
      <p class="text-text-muted text-sm">No users match your filters.</p>
    </div>
  {:else}
  <div class="space-y-3">
    {#each data.users as u (u.id)}
      <UserRow
        isSelf={u.id === data.currentUserId}
        onRemove={requestRemove}
        {submitToast}
        user={u}
      />
    {/each}
  </div>
  <Pagination
    label="users"
    page={data.page}
    perPage={data.perPage}
    total={data.total}
  />
  {/if}

  {#if data.invites.length > 0}
    <div class="mt-8">
      <h2 class="eyebrow mb-3">Pending invitations</h2>
      <div class="space-y-3">
        {#each data.invites as inv (inv.id)}
          <div class="border-border bg-surface flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-4">
            <div class="min-w-0">
              <p class="text-text truncate text-sm font-medium">
                {inv.email}
              </p>
              <p class="text-text-muted text-xs">
                {roleLabel(inv.role)}
                : expires {new Date(inv.expiresAt).toLocaleDateString()}
              </p>
            </div>
            <form
              action="?/cancelInvite"
              method="POST"
              use:enhance={submitToast("Canceling invite", "Invite canceled.")}
            >
              <input name="id" type="hidden" value={inv.id} />
              <Button
                aria-label="Cancel invite"
                size="icon-sm"
                type="submit"
                variant="ghost"
              >
                <X class="size-4" />
              </Button>
            </form>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<ConfirmDialog
  bind:open={removeDialogOpen}
  confirmLabel="Remove"
  description={`Remove "${pendingRemoveName}"? Everything they created is handed over to you : this can't be undone.`}
  onConfirm={() => pendingRemoveForm?.requestSubmit()}
  title="Remove user"
/>
