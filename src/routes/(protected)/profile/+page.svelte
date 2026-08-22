<script lang="ts">
	import { Check, ShieldCheck, UserCircle } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { authClient } from "$lib/auth-client";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";

	// Access layout-injected data via the session / parent
	const session = authClient.useSession();

	// Reactive references to the current user + profile from layout
	const user = $derived($session.data?.user);

	onMount(() => title.set("Personal Information"));

	let accountName = $derived(user?.name ?? "");
	let accountImage = $derived(user?.image ?? "");
	let accountLoading = $state(false);

	// Keep fields in sync if the session refreshes
	$effect(() => {
		if (user?.name && !accountLoading) {
			accountName = user.name;
		}
		if (!accountLoading) {
			accountImage = user?.image ?? "";
		}
	});

	async function saveAccount(e: SubmitEvent) {
		e.preventDefault();
		if (!accountName.trim()) {
			toast.error("Display name cannot be empty.");
			return;
		}
		accountLoading = true;
		try {
			const { error } = await authClient.updateUser({
				image: accountImage.trim() || undefined,
				name: accountName.trim(),
			});
			if (error) {
				toast.error(error.message ?? "Could not update account.");
			} else {
				toast.success("Account updated.");
			}
		} catch {
			toast.error("An unexpected error occurred.");
		} finally {
			accountLoading = false;
		}
	}

	// Derived initials for avatar preview
	const initials = $derived(
		(accountName || user?.name || "?")[0]?.toUpperCase() ?? "?",
	);
</script>

<section class="rounded-2xl border border-border bg-surface">
  <div class="flex items-center gap-3 border-b border-border px-5 py-4">
    <div class="flex size-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
      <UserCircle class="size-4" />
    </div>
    <div>
      <h2 class="text-sm font-semibold text-text">Account</h2>
      <p class="text-xs text-text-muted">
        Your display name and avatar shown across the platform.
      </p>
    </div>
  </div>

  <form class="space-y-5 p-5" onsubmit={saveAccount}>
    <!-- Avatar preview + URL input -->
    <div class="flex items-center gap-4">
      <div class="shrink-0">
        {#if accountImage}
          <img
            alt={accountName}
            class="size-16 rounded-2xl object-cover ring-2 ring-[var(--color-border)]"
            src={accountImage}
          >
        {:else}
          <div class="bg-accent flex size-16 items-center justify-center rounded-2xl text-xl font-bold text-white">
            {initials}
          </div>
        {/if}
      </div>
      <div class="min-w-0 flex-1">
        <label class="mb-1.5 block text-sm font-medium text-text" for="accountImage">
          Avatar URL
        </label>
        <Input
          id="accountImage"
          placeholder="https://example.com/avatar.jpg"
          type="url"
          bind:value={accountImage}
        />
        <p class="mt-1 text-xs text-text-subtle">
          Paste a direct image link (JPEG, PNG, WebP).
        </p>
      </div>
    </div>

    <!-- Display name -->
    <div>
      <label class="mb-1.5 block text-sm font-medium text-text" for="accountName">
        Display name <span class="text-red-500">*</span>
      </label>
      <Input
        id="accountName"
        placeholder="Your full name"
        required
        type="text"
        bind:value={accountName}
      />
    </div>

    <!-- Email (read-only) -->
    <div>
      <label class="mb-1.5 block text-sm font-medium text-text" for="email">
        Email
      </label>
      <div class="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2.5">
        <span class="flex-1 text-sm text-text-muted">
          {user?.email ?? "—"}
        </span>
        {#if user?.emailVerified}
          <span
            class="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[0.65rem] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400"
          >
            <ShieldCheck class="size-3" />
            Verified
          </span>
        {:else}
          <span
            class="rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
          >
            Unverified
          </span>
        {/if}
      </div>
      <p class="mt-1 text-xs text-text-subtle">
        Email changes are not yet supported.
      </p>
    </div>

    <div class="flex justify-end">
      <Button disabled={accountLoading} type="submit">
        {#if accountLoading}
          <Spinner />
          Saving…
        {:else}
          <Check class="size-4" />
          Save account
        {/if}
      </Button>
    </div>
  </form>
</section>
