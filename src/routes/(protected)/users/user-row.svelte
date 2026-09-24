<script lang="ts">
	import { Pencil, Trash2 } from "@lucide/svelte";
	import type { SubmitFunction } from "@sveltejs/kit";
	import { tick } from "svelte";
	import { enhance } from "$app/forms";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { timeAgo } from "$lib/formatting";
	import { ROLE_OPTIONS, roleLabel } from "$lib/permissions";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		isSelf: boolean;
		onRemove: (e: MouseEvent, name: string) => void;
		submitToast: (loading: string, success: string) => SubmitFunction;
		user: {
			email: string;
			id: string;
			lastSignInAt: Date | string | null;
			name: string;
			role?: string | null;
		};
	}

	const { isSelf, onRemove, submitToast, user }: Props = $props();

	let editingEmail = $state(false);
	let roleForm = $state<HTMLFormElement>();
</script>

<div class="panel flex flex-wrap items-center justify-between gap-3 rounded-md p-4">
  <div class="min-w-0">
    <p class="text-text truncate text-sm font-medium">
      {user.name}
      {#if isSelf}
        <span class="text-text-subtle text-xs font-normal">(you)</span>
      {/if}
    </p>
    {#if editingEmail}
      <form
        action="?/setEmail"
        class="mt-1.5 flex items-center gap-2"
        method="POST"
        use:enhance={enhanceToast({
          loading: "Changing email",
          onSuccess: () => {
            editingEmail = false;
          },
          success: "Email changed.",
        })}
      >
        <input name="userId" type="hidden" value={user.id} />
        <Input
          aria-label="New email"
          class="h-8 w-64 text-xs"
          name="email"
          required
          type="email"
          value={user.email}
        />
        <Button size="sm" type="submit">Save</Button>
        <Button
          onclick={() => {
            editingEmail = false;
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
        {user.email}
        <Button
          aria-label="Change email"
          class="size-6"
          onclick={() => {
            editingEmail = true;
          }}
          size="icon-sm"
          title="Change email"
          variant="ghost"
        >
          <Pencil class="size-3" />
        </Button>
      </p>
    {/if}
    <p class="text-text-subtle text-xs">
      {user.lastSignInAt
        ? `Last signed in ${timeAgo(user.lastSignInAt)}`
        : "Never signed in"}
    </p>
  </div>
  <div class="flex items-center gap-2">
    <form
      bind:this={roleForm}
      action="?/setRole"
      method="POST"
      use:enhance={submitToast("Updating role", "Role updated.")}
    >
      <input name="userId" type="hidden" value={user.id} />
      <Select.Root
        name="role"
        onValueChange={async () => {
          await tick();
          roleForm?.requestSubmit();
        }}
        type="single"
        value={user.role ?? "developer"}
      >
        <Select.Trigger class="w-32" aria-label="Role" size="sm">
          {roleLabel(user.role ?? "developer")}
        </Select.Trigger>
        <Select.Content>
          {#each ROLE_OPTIONS as opt (opt.value)}
            <Select.Item label={opt.label} value={opt.value} />
          {/each}
        </Select.Content>
      </Select.Root>
    </form>
    <form
      action="?/removeUser"
      method="POST"
      use:enhance={submitToast("Removing user", "User removed.")}
    >
      <input name="userId" type="hidden" value={user.id} />
      <Button
        aria-label="Remove user"
        class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
        disabled={isSelf}
        onclick={(e) => onRemove(e, user.name)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Trash2 class="size-4" />
      </Button>
    </form>
  </div>
</div>
