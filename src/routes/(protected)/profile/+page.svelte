<script lang="ts">
	import { Check, ShieldCheck, UserCircle } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { authClient } from "$lib/auth-client";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";
	import { toastError } from "$lib/toast";

	const { data } = $props();

	// Access layout-injected data via the session / parent
	const session = authClient.useSession();

	// Reactive references to the current user + profile from layout
	const user = $derived($session.data?.user);

	onMount(() => title.set("Personal Information"));

	let accountName = $derived(user?.name ?? "");
	let accountImage = $derived(user?.image ?? "");
	let accountEmail = $derived(user?.email ?? "");
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

	const emailLocked = $derived(!!user?.emailVerified && !data.smtpEnabled);

	async function saveAccountCallback(e: SubmitEvent) {
		e.preventDefault();
		if (!accountName.trim()) {
			throw new Error("Display name cannot be empty.");
		}
		const newEmail = accountEmail.trim().toLowerCase();
		if (!newEmail) {
			throw new Error("Email cannot be empty.");
		}
		const emailChanged = newEmail !== user?.email;
		if (emailChanged && emailLocked) {
			throw new Error(
				"Changing a verified email needs SMTP configured in Settings → Email.",
			);
		}
		accountLoading = true;
		try {
			const { error } = await authClient.updateUser({
				image: accountImage.trim() || undefined,
				name: accountName.trim(),
			});
			if (error) {
				throw new Error(error.message ?? "Could not update account.");
			}
			if (!emailChanged) {
				return "Account updated.";
			}
			const { error: emailError } = await authClient.changeEmail({
				callbackURL: "/profile",
				newEmail,
			});
			if (emailError) {
				throw new Error(
					emailError.message ?? "Could not change the email address.",
				);
			}
			if (!user?.emailVerified) {
				return "Account updated.";
			}
			const pendingFrom = user.email;
			accountEmail = pendingFrom;
			return `Account updated. Confirm the change from the link sent to ${pendingFrom}.`;
		} finally {
			accountLoading = false;
		}
	}

	function saveAccount(e: SubmitEvent) {
		return toast.promise(saveAccountCallback(e), {
			error: (error) => toastError(error, "Could not update account."),
			loading: "Saving your account",
			success: (message) => message,
		});
	}

	// Derived initials for avatar preview
	const initials = $derived(
		(accountName || user?.name || "?")[0]?.toUpperCase() ?? "?",
	);
</script>

<section class="rounded-2xl glass">
  <div class="flex items-center gap-3 border-b border-border px-5 py-4">
    <div class="flex size-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
      <UserCircle class="size-4" />
    </div>
    <div>
      <h2 class="eyebrow">Account</h2>
      <p class="text-xs text-text-muted">
        Your display name and avatar shown across the platform, and the
        email you sign in with.
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
            class="size-16 rounded-2xl object-cover ring-2 ring-border"
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

    <!-- Email -->
    <div>
      <div class="mb-1.5 flex items-center gap-2">
        <label class="block text-sm font-medium text-text" for="accountEmail">
          Email <span class="text-red-500">*</span>
        </label>
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
      <Input
        disabled={emailLocked}
        id="accountEmail"
        placeholder="you@example.com"
        required
        type="email"
        bind:value={accountEmail}
      />
      <p class="mt-1 text-xs text-text-subtle">
        {#if emailLocked}
          Changing a verified email needs a confirmation link, so it stays
          locked until SMTP is configured in Settings → Email.
        {:else if user?.emailVerified}
          You'll get a confirmation link at {user.email}; the new address
          takes effect once you follow it.
        {:else}
          This is also the address you sign in with. It changes as soon as you
          save.
        {/if}
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
