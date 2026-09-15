<script lang="ts">
	import { LogOut, UserCircle } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { goto, refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { signOut } from "$lib/auth-client";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";

	interface ProfileUser {
		email?: string | null;
		image?: string | null;
		name?: string | null;
	}

	const { user }: { user: ProfileUser | undefined } = $props();

	const userInitial = $derived(user?.name?.[0]?.toUpperCase() ?? "?");

	async function signOutCallback() {
		await signOut();
		await refreshAll();
	}

	function handleSignOut() {
		return toast.promise(signOutCallback, {
			error: (e) => (e instanceof Error ? e.message : "Failed to sign you out"),
			loading: "Signing you out",
			success: "Signed you out successfully",
		});
	}
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <button
        {...props}
        aria-label="Account menu"
        class="hover:bg-surface-2 flex size-8 shrink-0 items-center justify-center rounded-md transition-colors"
        type="button"
      >
        {#if user?.image}
          <img
            alt={user.name ?? ""}
            class="size-6 rounded-full object-cover"
            src={user.image}
          >
        {:else}
          <span class="bg-accent text-bg flex size-6 items-center justify-center rounded-full text-[0.6875rem] font-semibold">
            {userInitial}
          </span>
        {/if}
      </button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="w-56">
    <DropdownMenu.Label class="font-normal">
      <p class="text-text truncate text-sm font-semibold">{user?.name}</p>
      <p class="text-text-muted truncate text-xs">{user?.email}</p>
    </DropdownMenu.Label>
    <DropdownMenu.Separator />
    <DropdownMenu.Item onSelect={() => goto(resolve("/profile"))}>
      <UserCircle class="size-4" />
      Account settings
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Item onSelect={handleSignOut} variant="destructive">
      <LogOut class="size-4" />
      Sign out
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
