<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import {
		LogOut,
		SlidersHorizontal,
		Sparkles,
		UserCircle,
	} from "@lucide/svelte";
	import * as DropdownMenu from "@orochibraru/ui/dropdown-menu";

	import { handleSignOut, handleSwitchMode } from "#lib/account-actions.js";
	import { headerControlClass } from "#lib/components/header-styles.js";
	import { UI_MODE_LABELS, type UiMode } from "#lib/ui-mode.js";

	interface ProfileUser {
		email?: string | null;
		image?: string | null;
		name?: string | null;
	}

	const { uiMode, user }: { uiMode: UiMode; user: ProfileUser | undefined } =
		$props();

	const otherMode = $derived<UiMode>(
		uiMode === "simple" ? "advanced" : "simple",
	);

	const userInitial = $derived(user?.name?.[0]?.toUpperCase() ?? "?");
</script>

{#snippet avatar()}
	{#if user?.image}
		<img
			alt={user.name ?? ""}
			class="ring-border size-8 rounded-full object-cover ring-1 sm:size-5 sm:ring-0"
			src={user.image}
		/>
	{:else}
		<span
			class="bg-accent text-bg flex size-8 items-center justify-center rounded-full text-sm font-semibold sm:size-5 sm:text-[0.625rem]"
		>
			{userInitial}
		</span>
	{/if}
{/snippet}

<a
	aria-label="Account"
	class="{headerControlClass} w-10 md:hidden"
	href={resolve("profile")}
>
	{@render avatar()}
</a>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				aria-label="Account menu"
				class="{headerControlClass} w-10 max-md:hidden sm:w-8"
				type="button"
			>
				{@render avatar()}
			</button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-56">
		<DropdownMenu.Label class="font-normal">
			<p class="text-text truncate text-sm font-semibold">{user?.name}</p>
			<p class="text-text-muted truncate text-xs">{user?.email}</p>
		</DropdownMenu.Label>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={() => goto(resolve("profile"))}
			><UserCircle class="size-4" />Account settings</DropdownMenu.Item
		>
		<DropdownMenu.Item onSelect={() => handleSwitchMode(otherMode)}>
			{#if otherMode === "simple"}
				<Sparkles class="size-4" />
			{:else}
				<SlidersHorizontal class="size-4" />
			{/if}
			Switch to {UI_MODE_LABELS[otherMode].toLowerCase()} mode
		</DropdownMenu.Item>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={handleSignOut} variant="destructive">
			<LogOut class="size-4" />
			Sign out
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
