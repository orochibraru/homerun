<script lang="ts">
	import {
		ArrowLeft,
		ArrowRight,
		Fingerprint,
		TriangleAlert,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { goto, onNavigate, refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { authClient, signIn, useSession } from "$lib/auth-client";
	import AuthShell from "$lib/components/auth-shell.svelte";
	import CheckBox from "$lib/components/check-box.svelte";
	import PasswordField from "$lib/components/password-field.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { rememberOauthAttempt } from "$lib/oauth-attempt";
	import { PASSKEY_SIGN_IN, PASSWORD_SIGN_IN } from "$lib/sign-in-methods";
	import { title } from "$lib/store/title";
	import { toastError } from "$lib/toast";

	const { data } = $props();

	let email = $state("");
	let password = $state("");
	let loading = $state(false);

	const session = useSession();

	// Redirect if already logged in
	$effect(() => {
		if (!$session.isPending && $session.data?.user) {
			loading = true;
			goto(resolve("/"));
		}
	});

	let twoFactorStep = $state(false);
	let twoFactorMode = $state<"backup" | "totp">("totp");
	let twoFactorCode = $state("");
	let trustDevice = $state(false);
	let showOtherMethods = $state(false);

	onMount(() => {
		title.set("Sign In");
		if (data.promptPasskeyOnLoad) {
			void promptPasskeyOnLoad();
			return;
		}
		void startPasskeyAutofill();
	});

	async function promptPasskeyOnLoad() {
		if (typeof PublicKeyCredential === "undefined") {
			return;
		}
		loading = true;
		const result = await authClient.signIn.passkey().catch(() => null);
		if (!result || result.error) {
			loading = false;
			return;
		}
		await refreshAll({ includeLoadFunctions: true });
	}

	async function startPasskeyAutofill() {
		if (!data.passkeyAvailable || typeof PublicKeyCredential === "undefined") {
			return;
		}
		const available =
			await PublicKeyCredential.isConditionalMediationAvailable?.().catch(
				() => false,
			);
		if (!available) {
			return;
		}
		const { error } = await authClient.signIn.passkey({ autoFill: true });
		if (!error) {
			loading = true;
			await refreshAll({ includeLoadFunctions: true });
		}
	}

	async function signIncallback(
		e: SubmitEvent,
	): Promise<"signed-in" | "two-factor"> {
		e.preventDefault();
		loading = true;
		try {
			const { data: result, error } = await signIn.email({
				email,
				password,
			});
			if (error) {
				throw new Error(
					error.message ?? "Invalid credentials. Please try again.",
				);
			}
			password = "";
			if (result && "twoFactorRedirect" in result && result.twoFactorRedirect) {
				loading = false;
				twoFactorCode = "";
				twoFactorMode = "totp";
				twoFactorStep = true;
				return "two-factor";
			}
			await refreshAll({ includeLoadFunctions: true });
			return "signed-in";
		} catch (e) {
			password = "";
			loading = false;
			throw e;
		}
	}

	function handleSignIn(e: SubmitEvent) {
		return toast.promise(signIncallback(e), {
			loading: "Signing in",
			success: (outcome) =>
				outcome === "two-factor"
					? "Enter your verification code to finish signing in."
					: "Signed in successfully",
			error: (e) => toastError(e, "Couldn't sign you in."),
		});
	}

	async function verifyTwoFactorCallback(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		try {
			const code = twoFactorCode.trim();
			const { error } =
				twoFactorMode === "totp"
					? await authClient.twoFactor.verifyTotp({
							code,
							trustDevice,
						})
					: await authClient.twoFactor.verifyBackupCode({
							code,
							trustDevice,
						});
			if (error) {
				throw new Error(error.message ?? "That code didn't match.");
			}
			await refreshAll({ includeLoadFunctions: true });
		} catch (err) {
			twoFactorCode = "";
			loading = false;
			throw err;
		}
	}

	function handleVerifyTwoFactor(e: SubmitEvent) {
		return toast.promise(verifyTwoFactorCallback(e), {
			error: (err) => toastError(err, "That code didn't match."),
			loading: "Checking your code",
			success: "Signed in successfully",
		});
	}

	async function passkeySignInCallback() {
		loading = true;
		try {
			const { error } = await authClient.signIn.passkey();
			if (error) {
				throw new Error(
					error.message ?? "Couldn't sign you in with a passkey.",
				);
			}
			await refreshAll({ includeLoadFunctions: true });
		} catch (err) {
			loading = false;
			throw err;
		}
	}

	function handlePasskeySignIn() {
		return toast.promise(passkeySignInCallback(), {
			error: (err) => toastError(err, "Couldn't sign you in with a passkey."),
			loading: "Waiting for your passkey",
			success: "Signed in successfully",
		});
	}

	onNavigate(() => {
		loading = false;
	});

	async function oauthSignInCallback(providerId: string) {
		loading = true;
		rememberOauthAttempt(providerId);
		try {
			const { error } = await signIn.social({
				callbackURL: resolve("/"),
				provider: providerId as never,
			});
			if (error) {
				throw new Error(error.message ?? "Couldn't start that sign-in.");
			}
		} catch (err) {
			loading = false;
			throw err;
		}
	}

	function handleOauthSignIn(providerId: string, providerLabel: string) {
		return toast.promise(oauthSignInCallback(providerId), {
			error: (err) =>
				err instanceof Error
					? err.message
					: `Couldn't sign you in with ${providerLabel}.`,
			loading: `Redirecting to ${providerLabel}`,
			success: `Redirecting to ${providerLabel}…`,
		});
	}
</script>

{#snippet passwordForm()}
    <form class="space-y-4" novalidate onsubmit={handleSignIn}>
        <div>
            <label class="text-text mb-1.5 block text-sm font-medium" for="email">
                Email
            </label>
            <Input
                autocomplete="email webauthn"
                class="h-10"
                disabled={loading}
                id="email"
                placeholder="you@example.com"
                required
                type="email"
                bind:value={email}
            />
        </div>

        <PasswordField
            disabled={loading}
            id="password"
            autocomplete="current-password"
            label="Password"
            bind:value={password}
        />

        <Button
            class="mt-2 h-10 w-full"
            disabled={loading || !email || !password}
            type="submit"
        >
            {#if loading}
                <Spinner />
                Signing in…
            {:else}
                Sign in
                <ArrowRight class="size-4 opacity-70" />
            {/if}
        </Button>
    </form>
{/snippet}

{#snippet oauthButtons(providers: typeof data.oauthProviders)}
    {#if data.canonicalSignInUrl}
        <div
            class="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400"
        >
            <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
            <span>
                You've reached this instance on a different address than its
                configured Origin, and single sign-on has to start there so the
                provider can hand you back.
                <a class="font-medium underline" href={data.canonicalSignInUrl}>
                    Sign in on the configured address
                </a>
                instead.
            </span>
        </div>
    {:else}
        {#each providers as provider (provider.name)}
            <Button
                class="h-10 w-full"
                disabled={loading}
                onclick={() => handleOauthSignIn(provider.name, provider.label)}
                variant="outline"
            >
                Continue with {provider.label}
            </Button>
        {/each}
    {/if}
{/snippet}

{#snippet methodList(methods: string[])}
    {@const providers = data.oauthProviders.filter((p) =>
        methods.includes(p.method),
    )}
    {@const hasPassword = methods.includes(PASSWORD_SIGN_IN)}
    {@const hasPasskey = methods.includes(PASSKEY_SIGN_IN)}
    {#if hasPassword}
        {@render passwordForm()}
    {/if}
    {#if hasPassword && (hasPasskey || providers.length > 0)}
        <div class="my-6 flex items-center gap-3">
            <span class="bg-border h-px flex-1"></span>
            <span class="eyebrow">or</span>
            <span class="bg-border h-px flex-1"></span>
        </div>
    {/if}
    {#if hasPasskey || providers.length > 0}
        <div class="space-y-2">
            {#if hasPasskey}
                <Button
                    class="h-10 w-full"
                    disabled={loading}
                    onclick={handlePasskeySignIn}
                    variant="outline"
                >
                    <Fingerprint class="size-4" />
                    Continue with a passkey
                </Button>
            {/if}
            {#if providers.length > 0}
                {@render oauthButtons(providers)}
            {/if}
        </div>
    {/if}
{/snippet}

<AuthShell
    eyebrow="Sign in"
    heading="Welcome back"
    subheading="Sign in to manage your services."
>
    {#if twoFactorStep}
        <form class="space-y-4" novalidate onsubmit={handleVerifyTwoFactor}>
            <p class="text-text-muted text-sm">
                {#if twoFactorMode === "totp"}
                    Enter the 6-digit code from your authenticator app.
                {:else}
                    Enter one of the backup codes you saved when setting up
                    two-factor authentication.
                {/if}
            </p>
            <div>
                <label
                    class="text-text mb-1.5 block text-sm font-medium"
                    for="twoFactorCode"
                >
                    {twoFactorMode === "totp"
                        ? "Verification code"
                        : "Backup code"}
                </label>
                <Input
                    autocomplete="one-time-code"
                    class="h-10 font-mono tracking-widest"
                    disabled={loading}
                    id="twoFactorCode"
                    inputmode={twoFactorMode === "totp" ? "numeric" : "text"}
                    placeholder={twoFactorMode === "totp"
                        ? "123456"
                        : "xxxxx-xxxxx"}
                    required
                    bind:value={twoFactorCode}
                />
            </div>
            <CheckBox
                helperText="Skip the code on this browser for the next 30 days."
                id="trustDevice"
                label="Trust this device"
                name="trustDevice"
                bind:checked={trustDevice}
            />
            <Button
                class="h-10 w-full"
                disabled={loading || !twoFactorCode.trim()}
                type="submit"
            >
                {#if loading}
                    <Spinner />
                    Verifying…
                {:else}
                    Verify
                    <ArrowRight class="size-4 opacity-70" />
                {/if}
            </Button>
            <div class="flex items-center justify-between gap-2">
                <Button
                    disabled={loading}
                    onclick={() => {
                        twoFactorStep = false;
                        twoFactorCode = "";
                    }}
                    size="sm"
                    variant="ghost"
                >
                    <ArrowLeft class="size-4" />
                    Back
                </Button>
                <Button
                    disabled={loading}
                    onclick={() => {
                        twoFactorMode =
                            twoFactorMode === "totp" ? "backup" : "totp";
                        twoFactorCode = "";
                    }}
                    size="sm"
                    variant="ghost"
                >
                    {twoFactorMode === "totp"
                        ? "Use a backup code"
                        : "Use authenticator app"}
                </Button>
            </div>
        </form>
    {:else}
        {@render methodList(data.primaryMethods)}
        {#if data.otherMethods.length > 0}
            {#if showOtherMethods}
                <div class="my-6 flex items-center gap-3">
                    <span class="bg-border h-px flex-1"></span>
                    <span class="eyebrow">or</span>
                    <span class="bg-border h-px flex-1"></span>
                </div>
                {@render methodList(data.otherMethods)}
            {:else}
                <div class="mt-4 text-center">
                    <button
                        class="text-text-muted hover:text-text text-xs underline-offset-4 hover:underline"
                        disabled={loading}
                        onclick={() => {
                            showOtherMethods = true;
                        }}
                        type="button"
                    >
                        Other sign-in methods
                    </button>
                </div>
            {/if}
        {/if}
    {/if}

    {#snippet footer()}
        Don't have an account?
        <a
            class="text-accent font-medium hover:underline"
            href={resolve("/auth/sign-up")}
        >
            Create one
        </a>
    {/snippet}
</AuthShell>
