<script lang="ts">
	import {
		AlertTriangle,
		Check,
		Eye,
		EyeOff,
		KeyRound,
		Loader2,
		Lock,
		ShieldCheck,
		Trash2,
		UserCircle,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { authClient } from "$lib/auth-client";
	import {
		getPasswordStrength,
		getPasswordStrengthMeta,
	} from "$lib/formatting";
	import { title } from "$lib/store/title";

	// Access layout-injected data via the session / parent
	const session = authClient.useSession();

	// Reactive references to the current user + profile from layout
	const user = $derived($session.data?.user);

	onMount(() => title.set("Settings"));

	// ── Shared input style ─────────────────────────────────────────
	const input =
		"w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";

	// ──────────────────────────────────────────────────────────────
	// Account section (name + avatar — updated via authClient)
	// ──────────────────────────────────────────────────────────────
	let accountName = $state(user?.name ?? "");
	let accountImage = $state(user?.image ?? "");
	let accountLoading = $state(false);

	// Keep fields in sync if the session refreshes
	$effect(() => {
		if (user?.name && !accountLoading) accountName = user.name;
		if (!accountLoading) accountImage = user?.image ?? "";
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
				name: accountName.trim(),
				image: accountImage.trim() || undefined,
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

	// ──────────────────────────────────────────────────────────────
	// Password section
	// ──────────────────────────────────────────────────────────────
	let currentPassword = $state("");
	let newPassword = $state("");
	let confirmPassword = $state("");
	let showCurrent = $state(false);
	let showNew = $state(false);
	let showConfirm = $state(false);
	let passwordLoading = $state(false);

	const passwordStrength = $derived(getPasswordStrength(newPassword));
	const strengthMeta = $derived(getPasswordStrengthMeta(passwordStrength));

	async function changePassword(e: SubmitEvent) {
		e.preventDefault();
		if (newPassword.length < 12) {
			toast.error("New password must be at least 12 characters.");
			return;
		}
		if (newPassword !== confirmPassword) {
			toast.error("Passwords do not match.");
			return;
		}
		passwordLoading = true;
		try {
			const { error } = await authClient.changePassword({
				currentPassword,
				newPassword,
				revokeOtherSessions: true,
			});
			if (error) {
				toast.error(error.message ?? "Could not change password.");
			} else {
				toast.success("Password changed. Other sessions have been signed out.");
				currentPassword = "";
				newPassword = "";
				confirmPassword = "";
			}
		} catch {
			toast.error("An unexpected error occurred.");
		} finally {
			passwordLoading = false;
		}
	}

	// ──────────────────────────────────────────────────────────────
	// Delete account
	// ──────────────────────────────────────────────────────────────
	let showDeleteConfirm = $state(false);
	let deletePassword = $state("");
	let deleteLoading = $state(false);
	let showDeletePassword = $state(false);

	async function deleteAccount(e: SubmitEvent) {
		e.preventDefault();
		deleteLoading = true;
		try {
			const { error } = await authClient.deleteUser({
				password: deletePassword,
				callbackURL: resolve("/"),
			});
			if (error) {
				toast.error(error.message ?? "Could not delete account.");
			} else {
				toast.success("Account deleted.");
				goto(resolve("/"));
			}
		} catch {
			toast.error("An unexpected error occurred.");
		} finally {
			deleteLoading = false;
		}
	}

	// Derived initials for avatar preview
	const initials = $derived(
		(accountName || user?.name || "?")[0]?.toUpperCase() ?? "?",
	);
</script>

<div class="mx-auto max-w-2xl space-y-6 p-6 md:p-8">
    <div>
        <h1 class="text-xl font-bold text-[var(--color-text)]">Settings</h1>
        <p class="mt-0.5 text-sm text-[var(--color-text-muted)]">
            Manage your profile and account preferences.
        </p>
    </div>

    <!-- ═══════════════════════════════════════════════════════════
	     ACCOUNT
	════════════════════════════════════════════════════════════ -->
    <section
        class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
        <div
            class="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-4"
        >
            <div
                class="flex size-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400"
            >
                <UserCircle class="size-4" />
            </div>
            <div>
                <h2 class="text-sm font-semibold text-[var(--color-text)]">
                    Account
                </h2>
                <p class="text-xs text-[var(--color-text-muted)]">
                    Your display name and avatar shown across the platform.
                </p>
            </div>
        </div>

        <form onsubmit={saveAccount} class="space-y-5 p-5">
            <!-- Avatar preview + URL input -->
            <div class="flex items-center gap-4">
                <div class="shrink-0">
                    {#if accountImage}
                        <img
                            src={accountImage}
                            alt={accountName}
                            class="size-16 rounded-2xl object-cover ring-2 ring-[var(--color-border)]"
                        />
                    {:else}
                        <div
                            class="bg-accent flex size-16 items-center justify-center rounded-2xl text-xl font-bold text-white"
                        >
                            {initials}
                        </div>
                    {/if}
                </div>
                <div class="min-w-0 flex-1">
                    <label
                        for="accountImage"
                        class="mb-1.5 block text-sm font-medium text-[var(--color-text)]"
                    >
                        Avatar URL
                    </label>
                    <input
                        id="accountImage"
                        type="url"
                        bind:value={accountImage}
                        placeholder="https://example.com/avatar.jpg"
                        class={input}
                    />
                    <p class="mt-1 text-xs text-[var(--color-text-subtle)]">
                        Paste a direct image link (JPEG, PNG, WebP).
                    </p>
                </div>
            </div>

            <!-- Display name -->
            <div>
                <label
                    for="accountName"
                    class="mb-1.5 block text-sm font-medium text-[var(--color-text)]"
                >
                    Display name <span class="text-red-500">*</span>
                </label>
                <input
                    id="accountName"
                    type="text"
                    bind:value={accountName}
                    placeholder="Your full name"
                    required
                    class={input}
                />
            </div>

            <!-- Email (read-only) -->
            <div>
                <label
                    class="mb-1.5 block text-sm font-medium text-[var(--color-text)]"
                >
                    Email
                </label>
                <div
                    class="flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5"
                >
                    <span class="flex-1 text-sm text-[var(--color-text-muted)]">
                        {user?.email ?? "—"}
                    </span>
                    {#if user?.emailVerified}
                        <span
                            class="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[0.65rem] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        >
                            <ShieldCheck class="size-3" /> Verified
                        </span>
                    {:else}
                        <span
                            class="rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        >
                            Unverified
                        </span>
                    {/if}
                </div>
                <p class="mt-1 text-xs text-[var(--color-text-subtle)]">
                    Email changes are not yet supported.
                </p>
            </div>

            <div class="flex justify-end">
                <button
                    type="submit"
                    disabled={accountLoading}
                    class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {#if accountLoading}
                        <Loader2 class="size-4 animate-spin" />
                        Saving…
                    {:else}
                        <Check class="size-4" />
                        Save account
                    {/if}
                </button>
            </div>
        </form>
    </section>

    <!-- ═══════════════════════════════════════════════════════════
	     PASSWORD
	════════════════════════════════════════════════════════════ -->
    <section
        class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
        <div
            class="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-4"
        >
            <div
                class="flex size-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400"
            >
                <KeyRound class="size-4" />
            </div>
            <div>
                <h2 class="text-sm font-semibold text-[var(--color-text)]">
                    Password
                </h2>
                <p class="text-xs text-[var(--color-text-muted)]">
                    Change your password. All other sessions will be signed out.
                </p>
            </div>
        </div>

        <form onsubmit={changePassword} class="space-y-5 p-5">
            <!-- Current password -->
            <div>
                <label
                    for="currentPassword"
                    class="mb-1.5 block text-sm font-medium text-[var(--color-text)]"
                >
                    Current password
                </label>
                <div class="relative">
                    <input
                        id="currentPassword"
                        type={showCurrent ? "text" : "password"}
                        bind:value={currentPassword}
                        placeholder="••••••••••••"
                        autocomplete="current-password"
                        required
                        class="{input} pr-11"
                    />
                    <button
                        type="button"
                        onclick={() => (showCurrent = !showCurrent)}
                        class="absolute top-1/2 right-3.5 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    >
                        {#if showCurrent}<EyeOff class="size-4" />{:else}<Eye
                                class="size-4"
                            />{/if}
                    </button>
                </div>
            </div>

            <!-- New password -->
            <div>
                <label
                    for="newPassword"
                    class="mb-1.5 block text-sm font-medium text-[var(--color-text)]"
                >
                    New password
                </label>
                <div class="relative">
                    <input
                        id="newPassword"
                        type={showNew ? "text" : "password"}
                        bind:value={newPassword}
                        placeholder="Min. 12 characters"
                        autocomplete="new-password"
                        required
                        class="{input} pr-11"
                    />
                    <button
                        type="button"
                        onclick={() => (showNew = !showNew)}
                        class="absolute top-1/2 right-3.5 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    >
                        {#if showNew}<EyeOff class="size-4" />{:else}<Eye
                                class="size-4"
                            />{/if}
                    </button>
                </div>
                {#if newPassword}
                    <div class="mt-2.5">
                        <div class="flex gap-1">
                            {#each [1, 2, 3, 4] as level}
                                <div
                                    class="h-1 flex-1 rounded-full transition-all duration-300 {level <=
                                    passwordStrength
                                        ? strengthMeta.bar
                                        : 'bg-[var(--color-surface-3)]'}"
                                ></div>
                            {/each}
                        </div>
                        <p class="mt-1 text-xs text-[var(--color-text-muted)]">
                            Strength: <span
                                class="font-medium {strengthMeta.text}"
                                >{strengthMeta.label}</span
                            >
                        </p>
                    </div>
                {/if}
            </div>

            <!-- Confirm new password -->
            <div>
                <label
                    for="confirmPassword"
                    class="mb-1.5 block text-sm font-medium text-[var(--color-text)]"
                >
                    Confirm new password
                </label>
                <div class="relative">
                    <input
                        id="confirmPassword"
                        type={showConfirm ? "text" : "password"}
                        bind:value={confirmPassword}
                        placeholder="Repeat new password"
                        autocomplete="new-password"
                        required
                        class="{input} pr-11 {confirmPassword &&
                        confirmPassword !== newPassword
                            ? 'border-red-500 focus:ring-red-500'
                            : confirmPassword && confirmPassword === newPassword
                              ? 'border-green-500 focus:ring-green-500'
                              : ''}"
                    />
                    <button
                        type="button"
                        onclick={() => (showConfirm = !showConfirm)}
                        class="absolute top-1/2 right-3.5 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    >
                        {#if showConfirm}<EyeOff class="size-4" />{:else}<Eye
                                class="size-4"
                            />{/if}
                    </button>
                </div>
                {#if confirmPassword && confirmPassword !== newPassword}
                    <p class="mt-1 text-xs text-red-500">
                        Passwords don't match.
                    </p>
                {:else if confirmPassword && confirmPassword === newPassword}
                    <p
                        class="mt-1 flex items-center gap-1 text-xs text-green-600"
                    >
                        <ShieldCheck class="size-3.5" /> Passwords match
                    </p>
                {/if}
            </div>

            <div class="flex justify-end">
                <button
                    type="submit"
                    disabled={passwordLoading ||
                        !currentPassword ||
                        !newPassword ||
                        !confirmPassword}
                    class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {#if passwordLoading}
                        <Loader2 class="size-4 animate-spin" />
                        Updating…
                    {:else}
                        <Lock class="size-4" />
                        Update password
                    {/if}
                </button>
            </div>
        </form>
    </section>

    <!-- ═══════════════════════════════════════════════════════════
	     DANGER ZONE
	════════════════════════════════════════════════════════════ -->
    <section
        class="rounded-2xl border border-red-200 bg-[var(--color-surface)] dark:border-red-900/40"
    >
        <div
            class="flex items-center gap-3 border-b border-red-100 px-5 py-4 dark:border-red-900/30"
        >
            <div
                class="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600"
            >
                <AlertTriangle class="size-4" />
            </div>
            <div>
                <h2
                    class="text-sm font-semibold text-red-600 dark:text-red-400"
                >
                    Danger zone
                </h2>
                <p class="text-xs text-[var(--color-text-muted)]">
                    Irreversible actions. Proceed with caution.
                </p>
            </div>
        </div>

        <div class="p-5">
            {#if !showDeleteConfirm}
                <div class="flex items-center justify-between gap-4">
                    <div>
                        <p class="text-sm font-medium text-[var(--color-text)]">
                            Delete account
                        </p>
                        <p
                            class="mt-0.5 text-xs text-[var(--color-text-muted)]"
                        >
                            Permanently removes your account, all your
                            services, and their deployment history. This
                            cannot be undone.
                        </p>
                    </div>
                    <button
                        onclick={() => (showDeleteConfirm = true)}
                        class="shrink-0 rounded-xl border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-500 hover:text-white dark:border-red-700/60"
                    >
                        Delete account
                    </button>
                </div>
            {:else}
                <form onsubmit={deleteAccount} class="space-y-4">
                    <div
                        class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
                    >
                        <p class="font-semibold">Are you absolutely sure?</p>
                        <p class="mt-1">
                            Enter your current password to confirm deletion. All
                            data will be permanently erased.
                        </p>
                    </div>

                    <div class="relative">
                        <input
                            type={showDeletePassword ? "text" : "password"}
                            bind:value={deletePassword}
                            placeholder="Confirm your password"
                            required
                            class="{input} pr-11"
                        />
                        <button
                            type="button"
                            onclick={() =>
                                (showDeletePassword = !showDeletePassword)}
                            class="absolute top-1/2 right-3.5 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        >
                            {#if showDeletePassword}<EyeOff
                                    class="size-4"
                                />{:else}<Eye class="size-4" />{/if}
                        </button>
                    </div>

                    <div class="flex items-center gap-3">
                        <button
                            type="button"
                            onclick={() => {
                                showDeleteConfirm = false;
                                deletePassword = "";
                            }}
                            class="rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-all hover:bg-[var(--color-surface-2)]"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={deleteLoading || !deletePassword}
                            class="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {#if deleteLoading}
                                <Loader2 class="size-4 animate-spin" />
                                Deleting…
                            {:else}
                                <Trash2 class="size-4" />
                                Yes, delete my account
                            {/if}
                        </button>
                    </div>
                </form>
            {/if}
        </div>
    </section>

    <!-- Extra bottom padding so the last card isn't flush with viewport edge -->
    <div class="h-4"></div>
</div>
