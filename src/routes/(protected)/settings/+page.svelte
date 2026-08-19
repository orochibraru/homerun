<script lang="ts">
    import {
        AlertTriangle,
        Check,
        Eye,
        EyeOff,
        Globe,
        KeyRound,
        Loader2,
        Lock,
        MapPin,
        ShieldCheck,
        Trash2,
        UserCircle,
    } from "@lucide/svelte";
    import { onMount } from "svelte";
    import { toast } from "svelte-sonner";
    import { enhance } from "$app/forms";
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { authClient } from "$lib/auth-client";
    import { title } from "$lib/store/title";
    import type { ActionData } from "./$types";

    // profile is available via the dashboard layout's load result
    const { form, data } = $props<{
        form: ActionData;
        data: import("../$types").LayoutData;
    }>();

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
                toast.success(
                    "Password changed. Other sessions have been signed out.",
                );
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

    // Username pattern — stored as a constant to avoid Svelte's {}-parsing in attributes
    const USERNAME_PATTERN = "[a-z0-9_-]{3,32}";

    // Derived initials for avatar preview
    const initials = $derived(
        (accountName || user?.name || "?")[0]?.toUpperCase() ?? "?",
    );
</script>

<div class="p-6 mx-auto space-y-6 max-w-2xl md:p-8">
    <div>
        <h1 class="text-xl font-bold text-[var(--color-text)]">Settings</h1>
        <p class="mt-0.5 text-sm text-[var(--color-text-muted)]">
            Manage your profile and account preferences.
        </p>
    </div>

    <!-- ═══════════════════════════════════════════════════════════
	     PUBLIC PROFILE
	════════════════════════════════════════════════════════════ -->
    <section
        class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
        <div
            class="flex gap-3 items-center py-4 px-5 border-b border-[var(--color-border)]"
        >
            <div
                class="flex justify-center items-center rounded-lg size-8 bg-accent/10 text-accent"
            >
                <Globe class="size-4" />
            </div>
            <div>
                <h2 class="text-sm font-semibold text-[var(--color-text)]">
                    Public Profile
                </h2>
                <p class="text-xs text-[var(--color-text-muted)]">
                    What other builders see when they visit your page.
                </p>
            </div>
        </div>

        <form
            method="POST"
            action="?/updateProfile"
            use:enhance={() => {
                return ({ update }) => update({ reset: false });
            }}
            class="p-5 space-y-5"
        >
            <!-- Username -->
            <div>
                <label
                    for="username"
                    class="block mb-1.5 text-sm font-medium text-[var(--color-text)]"
                >
                    Username <span class="text-red-500">*</span>
                </label>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="relative">
                    <span
                        class="absolute left-3.5 top-1/2 text-sm -translate-y-1/2 pointer-events-none text-[var(--color-text-muted)]"
                    >
                        @
                    </span>
                    <input
                        id="username"
                        name="username"
                        type="text"
                        placeholder="yourname"
                        required
                        class="{input} pl-8"
                        pattern={USERNAME_PATTERN}
                        title="3–32 lowercase letters, numbers, underscores, or hyphens"
                    />
                </div>
                <p class="mt-1 text-xs text-[var(--color-text-subtle)]">
                    Used in your public profile URL: /profile/<span
                        class="text-accent">yourname</span
                    >
                </p>
                {#if form?.profileError}
                    <p class="mt-1.5 text-sm text-red-500">
                        {form.profileError}
                    </p>
                {/if}
                {#if form?.profileSuccess}
                    <p
                        class="flex gap-1 items-center mt-1.5 text-sm text-green-600"
                    >
                        <Check class="size-3.5" /> Profile saved.
                    </p>
                {/if}
            </div>

            <!-- Bio -->
            <div>
                <label
                    for="bio"
                    class="block mb-1.5 text-sm font-medium text-[var(--color-text)]"
                >
                    Bio
                </label>
                <textarea
                    id="bio"
                    name="bio"
                    rows="3"
                    placeholder="A few words about you and your build…"
                    maxlength="300"
                    class="{input} resize-none"
                ></textarea>
                <p
                    class="mt-1 text-xs text-right text-[var(--color-text-subtle)]"
                >
                    Max 300 characters
                </p>
            </div>

            <!-- Location -->
            <div>
                <label
                    for="location"
                    class="flex gap-1.5 items-center mb-1.5 text-sm font-medium text-[var(--color-text)]"
                >
                    <MapPin class="size-3.5 text-[var(--color-text-muted)]" />
                    Location
                </label>
                <input
                    id="location"
                    name="location"
                    type="text"
                    placeholder="City, Country"
                    maxlength="100"
                    class={input}
                />
            </div>

            <!-- Public toggle -->
            <div
                class="flex justify-between items-center p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]"
            >
                <div>
                    <p class="text-sm font-medium text-[var(--color-text)]">
                        Public profile
                    </p>
                    <p class="mt-0.5 text-xs text-[var(--color-text-muted)]">
                        Anyone can find and view your profile and public builds.
                    </p>
                </div>
                <!-- Hidden radio pair as CSS-only toggle -->
                <label class="inline-flex relative items-center cursor-pointer">
                    <input
                        type="checkbox"
                        name="isPublic"
                        value="true"
                        class="sr-only peer"
                    />
                    <div
                        class="w-11 h-6 rounded-full transition-all peer bg-[var(--color-surface-3)] peer-checked:bg-accent after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-5"
                    ></div>
                </label>
            </div>

            <div class="flex justify-end">
                <button
                    type="submit"
                    class="flex gap-2 items-center py-2.5 px-5 text-sm font-semibold text-white rounded-xl shadow-sm transition-all bg-accent shadow-accent/30 hover:bg-accent-dark"
                >
                    <Check class="size-4" />
                    Save profile
                </button>
            </div>
        </form>
    </section>

    <!-- ═══════════════════════════════════════════════════════════
	     ACCOUNT
	════════════════════════════════════════════════════════════ -->
    <section
        class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
        <div
            class="flex gap-3 items-center py-4 px-5 border-b border-[var(--color-border)]"
        >
            <div
                class="flex justify-center items-center text-blue-600 rounded-lg dark:text-blue-400 size-8 bg-blue-500/10"
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

        <form onsubmit={saveAccount} class="p-5 space-y-5">
            <!-- Avatar preview + URL input -->
            <div class="flex gap-4 items-center">
                <div class="shrink-0">
                    {#if accountImage}
                        <img
                            src={accountImage}
                            alt={accountName}
                            class="object-cover rounded-2xl ring-2 size-16 ring-[var(--color-border)]"
                        />
                    {:else}
                        <div
                            class="flex justify-center items-center text-xl font-bold text-white rounded-2xl size-16 bg-accent"
                        >
                            {initials}
                        </div>
                    {/if}
                </div>
                <div class="flex-1 min-w-0">
                    <label
                        for="accountImage"
                        class="block mb-1.5 text-sm font-medium text-[var(--color-text)]"
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
                    class="block mb-1.5 text-sm font-medium text-[var(--color-text)]"
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
                    class="block mb-1.5 text-sm font-medium text-[var(--color-text)]"
                >
                    Email
                </label>
                <div
                    class="flex gap-2 items-center py-2.5 px-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                >
                    <span class="flex-1 text-sm text-[var(--color-text-muted)]">
                        {user?.email ?? "—"}
                    </span>
                    {#if user?.emailVerified}
                        <span
                            class="flex gap-1 items-center py-0.5 px-2 font-semibold text-green-700 bg-green-100 rounded-full dark:text-green-400 text-[0.65rem] dark:bg-green-900/30"
                        >
                            <ShieldCheck class="size-3" /> Verified
                        </span>
                    {:else}
                        <span
                            class="py-0.5 px-2 font-semibold text-amber-700 bg-amber-100 rounded-full dark:text-amber-400 text-[0.65rem] dark:bg-amber-900/30"
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
                    class="flex gap-2 items-center py-2.5 px-5 text-sm font-semibold text-white rounded-xl shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed bg-accent shadow-accent/30 hover:bg-accent-dark"
                >
                    {#if accountLoading}
                        <Loader2 class="animate-spin size-4" />
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
            class="flex gap-3 items-center py-4 px-5 border-b border-[var(--color-border)]"
        >
            <div
                class="flex justify-center items-center text-violet-600 rounded-lg dark:text-violet-400 size-8 bg-violet-500/10"
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

        <form onsubmit={changePassword} class="p-5 space-y-5">
            <!-- Current password -->
            <div>
                <label
                    for="currentPassword"
                    class="block mb-1.5 text-sm font-medium text-[var(--color-text)]"
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
                        class="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
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
                    class="block mb-1.5 text-sm font-medium text-[var(--color-text)]"
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
                        class="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
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
                    class="block mb-1.5 text-sm font-medium text-[var(--color-text)]"
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
                        class="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
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
                        class="flex gap-1 items-center mt-1 text-xs text-green-600"
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
                    class="flex gap-2 items-center py-2.5 px-5 text-sm font-semibold text-white rounded-xl shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed bg-accent shadow-accent/30 hover:bg-accent-dark"
                >
                    {#if passwordLoading}
                        <Loader2 class="animate-spin size-4" />
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
            class="flex gap-3 items-center py-4 px-5 border-b border-red-100 dark:border-red-900/30"
        >
            <div
                class="flex justify-center items-center text-red-600 rounded-lg size-8 bg-red-500/10"
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
                <div class="flex gap-4 justify-between items-center">
                    <div>
                        <p class="text-sm font-medium text-[var(--color-text)]">
                            Delete account
                        </p>
                        <p
                            class="mt-0.5 text-xs text-[var(--color-text-muted)]"
                        >
                            Permanently removes your account, all your cars,
                            mods, and profile data. This cannot be undone.
                        </p>
                    </div>
                    <button
                        onclick={() => (showDeleteConfirm = true)}
                        class="py-2 px-4 text-sm font-medium text-red-600 rounded-xl border border-red-300 transition-all hover:text-white hover:bg-red-500 shrink-0 dark:border-red-700/60"
                    >
                        Delete account
                    </button>
                </div>
            {:else}
                <form onsubmit={deleteAccount} class="space-y-4">
                    <div
                        class="p-4 text-sm text-red-700 bg-red-50 rounded-xl border border-red-200 dark:text-red-400 dark:border-red-900/40 dark:bg-red-950/20"
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
                            class="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        >
                            {#if showDeletePassword}<EyeOff
                                    class="size-4"
                                />{:else}<Eye class="size-4" />{/if}
                        </button>
                    </div>

                    <div class="flex gap-3 items-center">
                        <button
                            type="button"
                            onclick={() => {
                                showDeleteConfirm = false;
                                deletePassword = "";
                            }}
                            class="py-2 px-4 text-sm font-medium rounded-xl border transition-all border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={deleteLoading || !deletePassword}
                            class="flex gap-2 items-center py-2 px-4 text-sm font-semibold text-white bg-red-600 rounded-xl transition-all hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {#if deleteLoading}
                                <Loader2 class="animate-spin size-4" />
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
