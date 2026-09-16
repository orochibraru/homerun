<script lang="ts">
	import {
		RefreshCw,
		ShieldCheck,
		ShieldOff,
		Smartphone,
	} from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { renderSVG } from "uqr";
	import { invalidateAll } from "$app/navigation";
	import { authClient } from "$lib/auth-client";
	import CopyBox from "$lib/components/copy-box.svelte";
	import PasswordField from "$lib/components/password-field.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { totpSecretFromUri } from "$lib/security-policy";
	import { toastError } from "$lib/toast";

	interface Props {
		enabled: boolean;
		hasPassword: boolean;
		onChange?: () => Promise<void> | void;
	}

	const { enabled, hasPassword, onChange = invalidateAll }: Props = $props();

	let password = $state("");
	let code = $state("");
	let busy = $state(false);
	let totpUri = $state<string | null>(null);
	let backupCodes = $state<string[]>([]);
	let verified = $state(false);

	const qrSrc = $derived(
		totpUri
			? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(totpUri, { border: 2 }))}`
			: null,
	);
	const secret = $derived(totpUri ? totpSecretFromUri(totpUri) : null);
	const passwordMissing = $derived(hasPassword && !password);

	async function startCallback() {
		busy = true;
		try {
			const { data, error } = await authClient.twoFactor.enable({
				password,
			});
			if (error || !data || !("totpURI" in data) || !data.totpURI) {
				throw new Error(error?.message ?? "Couldn't start two-factor setup.");
			}
			totpUri = data.totpURI;
			backupCodes = data.backupCodes ?? [];
			password = "";
		} catch (err) {
			password = "";
			throw err;
		} finally {
			busy = false;
		}
	}

	function handleStart() {
		return toast.promise(startCallback(), {
			error: (err) => toastError(err, "Couldn't start two-factor setup."),
			loading: "Generating your authenticator secret",
			success: "Scan the code with your authenticator app.",
		});
	}

	async function verifyCallback(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const { error } = await authClient.twoFactor.verifyTotp({
				code: code.trim(),
			});
			if (error) {
				throw new Error(error.message ?? "That code didn't match.");
			}
			verified = true;
		} finally {
			code = "";
			busy = false;
		}
	}

	function handleVerify(e: SubmitEvent) {
		return toast.promise(verifyCallback(e), {
			error: (err) => toastError(err, "That code didn't match."),
			loading: "Checking your code",
			success: "Two-factor authentication is on.",
		});
	}

	async function finishCallback() {
		totpUri = null;
		backupCodes = [];
		verified = false;
		await onChange();
	}

	function handleFinish() {
		return toast.promise(finishCallback(), {
			error: (err) => toastError(err, "Couldn't refresh the page."),
			loading: "Finishing up",
			success: "Backup codes saved.",
		});
	}

	async function regenerateCallback() {
		busy = true;
		try {
			const { data, error } = await authClient.twoFactor.generateBackupCodes({
				password,
			});
			if (error || !data) {
				throw new Error(error?.message ?? "Couldn't generate backup codes.");
			}
			backupCodes = data.backupCodes;
			verified = true;
		} finally {
			password = "";
			busy = false;
		}
	}

	function handleRegenerate() {
		return toast.promise(regenerateCallback(), {
			error: (err) => toastError(err, "Couldn't generate backup codes."),
			loading: "Generating new backup codes",
			success: "New backup codes generated. The old ones no longer work.",
		});
	}

	async function disableCallback() {
		busy = true;
		try {
			const { error } = await authClient.twoFactor.disable({ password });
			if (error) {
				throw new Error(
					error.message ?? "Couldn't turn off two-factor authentication.",
				);
			}
			await onChange();
		} finally {
			password = "";
			busy = false;
		}
	}

	function handleDisable() {
		return toast.promise(disableCallback(), {
			error: (err) =>
				toastError(err, "Couldn't turn off two-factor authentication."),
			loading: "Turning off two-factor authentication",
			success: "Two-factor authentication is off.",
		});
	}
</script>

<div class="space-y-4">
    {#if verified && backupCodes.length > 0}
        <div class="space-y-3">
            <p class="text-text text-sm font-medium">Save your backup codes</p>
            <p class="text-text-muted text-xs">
                Each code works once, for when your authenticator isn't at hand.
                They won't be shown again.
            </p>
            <div
                class="border-border bg-surface-2 grid grid-cols-2 gap-2 rounded-lg border p-3 font-mono text-xs"
            >
                {#each backupCodes as backupCode (backupCode)}
                    <span class="text-text">{backupCode}</span>
                {/each}
            </div>
            <CopyBox
                label="backup codes"
                truncate
                value={backupCodes.join("\n")}
            />
            <div class="flex justify-end">
                <Button onclick={handleFinish}>
                    <ShieldCheck class="size-4" />
                    I've saved them
                </Button>
            </div>
        </div>
    {:else if totpUri}
        <div class="space-y-4">
            <p class="text-text-muted text-xs">
                Scan this with an authenticator app (1Password, Bitwarden,
                Aegis, Google Authenticator…), then enter the 6-digit code it
                shows.
            </p>
            {#if qrSrc}
                <img
                    alt="Authenticator QR code"
                    class="mx-auto size-44 rounded-md bg-white p-1"
                    src={qrSrc}
                />
            {/if}
            {#if secret}
                <CopyBox label="the setup key" value={secret} />
            {/if}
            <form class="flex items-end gap-2" onsubmit={handleVerify}>
                <div class="flex-1">
                    <label
                        class="text-text mb-1.5 block text-sm font-medium"
                        for="totpCode"
                    >
                        Verification code
                    </label>
                    <Input
                        autocomplete="one-time-code"
                        class="h-10 font-mono tracking-widest"
                        disabled={busy}
                        id="totpCode"
                        inputmode="numeric"
                        maxlength={6}
                        placeholder="123456"
                        bind:value={code}
                    />
                </div>
                <Button
                    class="h-10"
                    disabled={busy || code.trim().length < 6}
                    type="submit"
                >
                    {#if busy}
                        <Spinner />
                    {/if}
                    Verify
                </Button>
            </form>
        </div>
    {:else if enabled}
        <div
            class="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400"
        >
            <ShieldCheck class="size-4" />
            Authenticator app is set up.
        </div>
        {#if hasPassword}
            <PasswordField
                disabled={busy}
                id="twoFactorPassword"
                label="Confirm your password to make changes"
                autocomplete="current-password"
                bind:value={password}
            />
        {/if}
        <div class="flex flex-wrap justify-end gap-2">
            <Button
                disabled={busy || passwordMissing}
                onclick={handleRegenerate}
                variant="outline"
            >
                <RefreshCw class="size-4" />
                New backup codes
            </Button>
            <Button
                disabled={busy || passwordMissing}
                onclick={handleDisable}
                variant="destructive"
            >
                <ShieldOff class="size-4" />
                Turn off
            </Button>
        </div>
    {:else}
        {#if hasPassword}
            <PasswordField
                disabled={busy}
                id="twoFactorPassword"
                label="Confirm your password"
                autocomplete="current-password"
                bind:value={password}
            />
        {/if}
        <div class="flex justify-end">
            <Button disabled={busy || passwordMissing} onclick={handleStart}>
                {#if busy}
                    <Spinner />
                {:else}
                    <Smartphone class="size-4" />
                {/if}
                Set up authenticator app
            </Button>
        </div>
    {/if}
</div>
