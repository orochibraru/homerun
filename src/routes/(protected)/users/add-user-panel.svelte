<script lang="ts">
	import { Mail, UserPlus } from "@lucide/svelte";
	import type { SubmitFunction } from "@sveltejs/kit";
	import { enhance } from "$app/forms";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { ROLE_OPTIONS } from "$lib/permissions";

	interface Props {
		error?: string;
		open: boolean;
		smtpEnabled: boolean;
		submitToast: (loading: string, success: string) => SubmitFunction;
		submitting: boolean;
	}

	const { error, open, smtpEnabled, submitToast, submitting }: Props = $props();

	let addMode = $state<"direct" | "invite">("direct");
	let newRole = $state("developer");
	const newRoleOption = $derived(
		ROLE_OPTIONS.find((r) => r.value === newRole) ?? ROLE_OPTIONS[0],
	);
	const newRoleLabel = $derived(newRoleOption.label);
</script>

{#if open}
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
        disabled={!smtpEnabled}
        onclick={() => {
          addMode = "invite";
        }}
        type="button"
      >
        Send invite
      </button>
    </div>

    {#if addMode === "invite" && !smtpEnabled}
      <p class="text-text-subtle mb-4 text-xs">
        Configure SMTP on Settings to enable email invites.
      </p>
    {/if}

    {#if error}
      <p class="mb-4 text-sm text-red-500">{error}</p>
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
        <p class="text-text-subtle text-xs">
          They choose their own password the first time they sign in with
          this email{smtpEnabled ? ", after confirming a code we email them" : ""}.
        </p>
        <div>
          <div class={label}>Role</div>

          <Select.Root name="role" type="single" bind:value={newRole}>
            <Select.Trigger class="w-45">
              {newRoleLabel}
            </Select.Trigger>
            <Select.Content>
              <Select.Group>
                <Select.Label>Role</Select.Label>
                {#each ROLE_OPTIONS as opt (opt.value)}
                  <Select.Item label={opt.label} value={opt.value}>
                    {opt.label}
                  </Select.Item>
                {/each}
              </Select.Group>
            </Select.Content>
          </Select.Root>
          <p class="text-text-subtle mt-1.5 text-xs">
            {newRoleOption.description}
          </p>
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
                {#each ROLE_OPTIONS as opt (opt.value)}
                  <Select.Item label={opt.label} value={opt.value} />
                {/each}
              </Select.Group>
            </Select.Content>
          </Select.Root>
          <p class="text-text-subtle mt-1.5 text-xs">
            {newRoleOption.description}
          </p>
        </div>
        <div class="flex justify-end">
          <Button disabled={submitting} type="submit">
            <Mail class="size-4" />
            Send invite
          </Button>
        </div>
      </form>
    {/if}
  </div>
{/if}
