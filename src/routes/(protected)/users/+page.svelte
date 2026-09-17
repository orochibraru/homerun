<script lang="ts">
	import { Mail, Pencil, Plus, Trash2, UserPlus, X } from "@lucide/svelte";
	import type { SubmitFunction } from "@sveltejs/kit";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "$lib/components/entity-toolbar.svelte";
	import {
		inputClass as input,
		labelClass as label,
	} from "$lib/components/form-styles";
	import Pagination from "$lib/components/pagination.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { ROLE_OPTIONS, roleLabel } from "$lib/permissions";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	onMount(() => title.set("Users"));

	const roleOptions = ROLE_OPTIONS;

	const filters: FilterGroup[] = [
		{
			key: "role",
			label: "Role",
			options: ROLE_OPTIONS,
		},
	];

	let showAddForm = $state(false);
	let addMode = $state<"direct" | "invite">("direct");
	let newRole = $state("developer");
	const newRoleLabel = $derived(
		roleOptions.find((r) => r.value === newRole)?.label ?? "Developer",
	);
	let submitting = $state(false);
	let editingEmailFor = $state<string | null>(null);

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

  {#if showAddForm}
    <div class="panel mb-6 rounded-md p-5">
      <div class="mb-4 flex gap-2">
        <button
          class="
            flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-all {addMode ===
            'direct'
            ? 'border-accent bg-accent-light text-accent'
            : 'border-border text-text-muted hover:bg-surface-2'}
         "
          onclick={() => {
            addMode = "direct";
          }}
          type="button"
        >
          Direct create
        </button>
        <button
          class="
            flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 {addMode ===
            'invite'
            ? 'border-accent bg-accent-light text-accent'
            : 'border-border text-text-muted hover:bg-surface-2'}
         "
          disabled={!data.smtpEnabled}
          onclick={() => {
            addMode = "invite";
          }}
          type="button"
        >
          Send invite
        </button>
      </div>

      {#if addMode === "invite" && !data.smtpEnabled}
        <p class="text-text-subtle mb-4 text-xs">
          Configure SMTP on Settings to enable email invites.
        </p>
      {/if}

      {#if form?.error}
        <p class="mb-4 text-sm text-red-500">{form.error}</p>
      {/if}

      {#if addMode === "direct"}
        <form
          action="?/createDirect"
          class="space-y-4"
          method="POST"
          use:enhance={submitToast("Creating user", "User created.")}
        >
          <div>
            <label class={label} for="name">Name</label>
            <Input id="name" name="name" required type="text" />
          </div>
          <div>
            <label class={label} for="email">Email</label>
            <Input id="email" name="email" required type="email" />
          </div>
          <div>
            <label class={label} for="password">Temporary password</label>
            <Input
              id="password"
              minlength={12}
              name="password"
              required
              type="text"
            />
            <p class="text-text-subtle mt-1.5 text-xs">
              At least 12 characters : share this with them out of band.
            </p>
          </div>
          <div>
            <div class={label}>Role</div>

            <Select.Root name="role" type="single" bind:value={newRole}>
              <Select.Trigger class="w-45">
                {newRoleLabel}
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  <Select.Label>Role</Select.Label>
                  {#each roleOptions as opt (opt.value)}
                    <Select.Item label={opt.label} value={opt.value}>
                      {opt.label}
                    </Select.Item>
                  {/each}
                </Select.Group>
              </Select.Content>
            </Select.Root>
          </div>
          <div class="flex justify-end">
            <Button disabled={submitting} type="submit">
              <UserPlus class="size-4" />
              Create user
            </Button>
          </div>
        </form>
      {:else}
        <form
          action="?/invite"
          class="space-y-4"
          method="POST"
          use:enhance={submitToast("Sending invite", "Invite sent.")}
        >
          <div>
            <label class={label} for="inviteName">Name</label>
            <Input id="inviteName" name="name" required type="text" />
          </div>
          <div>
            <label class={label} for="inviteEmail">Email</label>
            <Input id="inviteEmail" name="email" required type="email" />
          </div>
          <div>
            <div class={label}>Role</div>
            <Select.Root name="role" type="single" bind:value={newRole}>
              <Select.Trigger class="w-full" id="inviteRole">
                {newRoleLabel}
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  <Select.Label>Role</Select.Label>
                  {#each roleOptions as opt (opt.value)}
                    <Select.Item label={opt.label} value={opt.value} />
                  {/each}
                </Select.Group>
              </Select.Content>
            </Select.Root>
          </div>
          <div class="flex justify-end">
            <Button disabled={submitting}>
              <Mail class="size-4" />
              Send invite
            </Button>
          </div>
        </form>
      {/if}
    </div>
  {/if}

  <EntityToolbar {filters} placeholder="Search users by name or email…" />

  {#if data.users.length === 0}
    <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
      <p class="text-text-muted text-sm">No users match your filters.</p>
    </div>
  {:else}
  <div class="space-y-3">
    {#each data.users as u (u.id)}
      <div class="panel flex flex-wrap items-center justify-between gap-3 rounded-md p-4">
        <div class="min-w-0">
          <p class="text-text truncate text-sm font-medium">
            {u.name}
            {#if u.id === data.currentUserId}
              <span class="text-text-subtle text-xs font-normal">(you)</span>
            {/if}
          </p>
          {#if editingEmailFor === u.id}
            <form
              action="?/setEmail"
              class="mt-1.5 flex items-center gap-2"
              method="POST"
              use:enhance={enhanceToast({
                loading: "Changing email",
                onSuccess: () => {
                  editingEmailFor = null;
                },
                success: "Email changed.",
              })}
            >
              <input name="userId" type="hidden" value={u.id} />
              <Input
                aria-label="New email"
                class="h-8 w-64 text-xs"
                name="email"
                required
                type="email"
                value={u.email}
              />
              <Button size="sm" type="submit">Save</Button>
              <Button
                onclick={() => {
                  editingEmailFor = null;
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            </form>
          {:else}
            <p class="text-text-muted flex items-center gap-1 truncate text-xs">
              {u.email}
              <Button
                aria-label="Change email"
                class="size-6"
                onclick={() => {
                  editingEmailFor = u.id;
                }}
                size="icon-sm"
                title="Change email"
                variant="ghost"
              >
                <Pencil class="size-3" />
              </Button>
            </p>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <form
            action="?/setRole"
            method="POST"
            use:enhance={submitToast("Updating role", "Role updated.")}
          >
            <input name="userId" type="hidden" value={u.id} />
            <select
              class="{input} py-1.5 text-xs"
              name="role"
              onchange={(e) => e.currentTarget.form?.requestSubmit()}
              value={u.role ?? "developer"}
            >
              {#each roleOptions as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </form>
          <form
            action="?/removeUser"
            method="POST"
            use:enhance={submitToast("Removing user", "User removed.")}
          >
            <input name="userId" type="hidden" value={u.id} />
            <Button
              aria-label="Remove user"
              class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
              disabled={u.id === data.currentUserId}
              onclick={(e) => requestRemove(e, u.name)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Trash2 class="size-4" />
            </Button>
          </form>
        </div>
      </div>
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
