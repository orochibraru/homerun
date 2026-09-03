<script lang="ts">
	import { Mail, Plus, Trash2, UserPlus, X } from "@lucide/svelte";
	import type { SubmitFunction } from "@sveltejs/kit";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import {
		inputClass as input,
		labelClass as label,
	} from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { title } from "$lib/store/title";

	const { data, form } = $props();

	onMount(() => title.set("Users"));

	const roleOptions = [
		{ label: "Developer", value: "developer" },
		{ label: "Admin", value: "admin" },
	];

	let showAddForm = $state(false);
	let addMode = $state<"direct" | "invite">("direct");
	let newRole = $state("developer");
	const newRoleLabel = $derived(
		roleOptions.find((r) => r.value === newRole)?.label ?? "Developer",
	);
	let submitting = $state(false);

	function submitToast(successMessage: string): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				submitting = false;
				if (result.type === "success") {
					toast.success(successMessage);
					showAddForm = false;
				} else if (result.type === "failure") {
					toast.error(
						(result.data as { error?: string } | undefined)?.error ??
							"Something went wrong.",
					);
				}
				await update();
			};
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

<div class="p-6 md:p-8">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-2xl font-bold">Users</h1>
      <p class="text-text-muted mt-1 text-sm">
        Admin and developer accounts for this instance. Public sign-up is closed
        once the first account exists : every account after that is created
        here.
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
    <div class="border-border bg-surface mb-6 rounded-2xl border p-5">
      <div class="mb-4 flex gap-2">
        <button
          class="
            flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-all {addMode ===
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
            flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 {addMode ===
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
          use:enhance={async () => {
            submitting = true;
            await submitToast("User created.");
          }}
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
                    <Select.Item
                      disabled={opt.value === "grapes"}
                      label={opt.label}
                      value={opt.value}
                    >
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
          use:enhance={async () => {
            submitting = true;
            await submitToast("Invite sent.");
          }}
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

  <div class="space-y-3">
    {#each data.users as u (u.id)}
      <div class="border-border bg-surface flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4">
        <div class="min-w-0">
          <p class="text-text truncate text-sm font-medium">
            {u.name}
            {#if u.id === data.currentUserId}
              <span class="text-text-subtle text-xs font-normal">(you)</span>
            {/if}
          </p>
          <p class="text-text-muted truncate text-xs">{u.email}</p>
        </div>
        <div class="flex items-center gap-2">
          <form
            action="?/setRole"
            method="POST"
            use:enhance={submitToast("Role updated.")}
          >
            <input name="userId" type="hidden" value={u.id} />
            <select
              class="{input} py-1.5 text-xs"
              name="role"
              onchange={(e) => e.currentTarget.form?.requestSubmit()}
              value={u.role ?? "developer"}
            >
              <option value="developer">Developer</option>
              <option value="admin">Admin</option>
            </select>
          </form>
          <form
            action="?/removeUser"
            method="POST"
            use:enhance={submitToast("User removed.")}
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

  {#if data.invites.length > 0}
    <div class="mt-8">
      <h2 class="text-text mb-3 text-sm font-semibold">Pending invitations</h2>
      <div class="space-y-3">
        {#each data.invites as inv (inv.id)}
          <div class="border-border bg-surface flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed p-4">
            <div class="min-w-0">
              <p class="text-text truncate text-sm font-medium">
                {inv.email}
              </p>
              <p class="text-text-muted text-xs">
                {inv.role}
                : expires {new Date(inv.expiresAt).toLocaleDateString()}
              </p>
            </div>
            <form
              action="?/cancelInvite"
              method="POST"
              use:enhance={submitToast("Invite canceled.")}
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
  description={`Remove "${pendingRemoveName}"? Their services and containers are stopped and deleted : this can't be undone.`}
  onConfirm={() => pendingRemoveForm?.requestSubmit()}
  title="Remove user"
/>
