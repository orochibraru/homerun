<script lang="ts">
	import {
		AlertTriangle,
		Fingerprint,
		KeyRound,
		Lock,
		ShieldCheck,
		Smartphone,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { authClient } from "$lib/auth-client";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import PasskeyPanel from "$lib/components/passkey-panel.svelte";
	import PasswordField from "$lib/components/password-field.svelte";
	import TwoFactorPanel from "$lib/components/two-factor-panel.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import {
		getPasswordStrength,
		getPasswordStrengthMeta,
	} from "$lib/formatting";
	import { title } from "$lib/store/title";
	import { toastError } from "$lib/toast";
	import ConnectedAccountsSection from "./connected-accounts-section.svelte";
	import DeleteAccountDialog from "./delete-account-dialog.svelte";

	const { data } = $props();

	onMount(() => title.set("Security"));

	let currentPassword = $state("");
	let newPassword = $state("");
	let confirmPassword = $state("");
	let passwordLoading = $state(false);

	const passwordStrength = $derived(getPasswordStrength(newPassword));
	const confirmPasswordClass = $derived.by(() => {
		if (!confirmPassword) {
			return "";
		}
		return confirmPassword === newPassword
			? "border-green-500 focus:ring-green-500"
			: "border-red-500 focus:ring-red-500";
	});
	const strengthMeta = $derived(getPasswordStrengthMeta(passwordStrength));

	async function changePasswordCallback(e: SubmitEvent) {
		e.preventDefault();
		if (newPassword.length < 12) {
			throw new Error("New password must be at least 12 characters.");
		}
		if (newPassword !== confirmPassword) {
			throw new Error("Passwords do not match.");
		}
		passwordLoading = true;
		try {
			const { error } = await authClient.changePassword({
				currentPassword,
				newPassword,
				revokeOtherSessions: true,
			});
			if (error) {
				currentPassword = "";
				throw new Error(error.message ?? "Could not change password.");
			}
			currentPassword = "";
			newPassword = "";
			confirmPassword = "";
		} finally {
			passwordLoading = false;
		}
	}

	function changePassword(e: SubmitEvent) {
		return toast.promise(changePasswordCallback(e), {
			error: (error) => toastError(error, "Could not change password."),
			loading: "Changing your password",
			success: "Password changed. Other sessions have been signed out.",
		});
	}
</script>

<div class="space-y-6">
    {#if data.providers.length > 0}
        <ConnectedAccountsSection
            hasPassword={data.hasPassword}
            providers={data.providers}
        />
    {/if}

    <section class="rounded-md panel">
        <div class="flex items-center gap-3 border-b border-border px-5 py-4">
            <div
                class="flex size-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400"
            >
                <KeyRound class="size-4" />
            </div>
            <div>
                <h2 class="eyebrow">Password</h2>
                <p class="text-xs text-text-muted">
                    Change your password. All other sessions will be signed out.
                </p>
            </div>
        </div>

        <form class="space-y-5 p-5" onsubmit={changePassword}>
            <PasswordField
                autocomplete="current-password"
                id="currentPassword"
                label="Current password"
                required
                bind:value={currentPassword}
            />

            <div>
                <PasswordField
                    autocomplete="new-password"
                    id="newPassword"
                    label="New password"
                    placeholder="Min. 12 characters"
                    required
                    bind:value={newPassword}
                />
                {#if newPassword}
                    <div class="mt-2.5">
                        <div class="flex gap-1">
                            {#each [1, 2, 3, 4] as level (level)}
                                <div
                                    class="
                    h-1 flex-1 rounded-full transition-all duration-300 {level <=
                                    passwordStrength
                                        ? strengthMeta.bar
                                        : 'bg-surface-3'}
                 "
                                ></div>
                            {/each}
                        </div>
                        <p class="mt-1 text-xs text-text-muted">
                            Strength:
                            <span class="font-medium {strengthMeta.text}"
                                >{strengthMeta.label}</span
                            >
                        </p>
                    </div>
                {/if}
            </div>

            <div>
                <PasswordField
                    autocomplete="new-password"
                    class={confirmPasswordClass}
                    id="confirmPassword"
                    label="Confirm new password"
                    placeholder="Repeat new password"
                    required
                    bind:value={confirmPassword}
                />
                {#if confirmPassword && confirmPassword !== newPassword}
                    <p class="mt-1 text-xs text-red-500">
                        Passwords don't match.
                    </p>
                {:else if confirmPassword && confirmPassword === newPassword}
                    <p
                        class="mt-1 flex items-center gap-1 text-xs text-green-600"
                    >
                        <ShieldCheck class="size-3.5" />
                        Passwords match
                    </p>
                {/if}
            </div>

            <div class="flex justify-end">
                <Button
                    disabled={passwordLoading ||
                        !currentPassword ||
                        !newPassword ||
                        !confirmPassword}
                    type="submit"
                >
                    {#if passwordLoading}
                        <Spinner />
                        Updating…
                    {:else}
                        <Lock class="size-4" />
                        Update password
                    {/if}
                </Button>
            </div>
        </form>
    </section>

    <section class="panel rounded-md">
        <div class="border-border flex items-center gap-3 border-b px-5 py-4">
            <div
                class="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            >
                <Smartphone class="size-4" />
            </div>
            <div>
                <h2 class="eyebrow">Two-factor authentication</h2>
                <p class="text-text-muted text-xs">
                    Ask for a code from an authenticator app after your password
                    when signing in.
                </p>
            </div>
        </div>
        <div class="p-5">
            <TwoFactorPanel
                enabled={data.twoFactorEnabled}
                hasPassword={data.hasPassword}
            />
        </div>
    </section>

    <section class="panel rounded-md">
        <PanelHeader
            description="Sign in with Touch ID, Windows Hello, a security key or your password manager instead of typing a password."
            icon={Fingerprint}
            title="Passkeys"
        />
        <div class="p-5">
            <PasskeyPanel passkeys={data.passkeys} />
        </div>
    </section>

    <section
        class="rounded-md border border-red-200 bg-surface dark:border-red-900/40"
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
                <p class="text-xs text-text-muted">
                    Irreversible actions. Proceed with caution.
                </p>
            </div>
        </div>

        <div class="p-5">
            <div class="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <p class="text-text text-sm font-medium">Delete account</p>
                    <p class="text-text-muted mt-0.5 text-xs">
                        Permanently removes your account. Everything you created
                        is handed over to another admin. This cannot be undone.
                    </p>
                </div>
                <DeleteAccountDialog />
            </div>
        </div>
    </section>
</div>
