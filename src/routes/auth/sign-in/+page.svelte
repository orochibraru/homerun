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
	import Alert from "$lib/components/alert.svelte";
	import AuthShell from "$lib/components/auth-shell.svelte";
	import CheckBox from "$lib/components/check-box.svelte";
	import PasswordField from "$lib/components/password-field.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { rememberOauthAttempt } from "$lib/oauth-attempt";
	import {
		completeAccountSetup,
		lookupSignIn,
		resendSetupCode,
	} from "$lib/remote/sign-in.remote";
	import type { SignInProvider } from "$lib/services/account-setup.service";
	import { title } from "$lib/store/title";
	import { toastError } from "$lib/toast";

	const { data } = $props();

	let email = $state("");
	let password = $state("");
	let loading = $state(false);

	const session = useSession();

	$effect(() => {
		if (
			!(
				data.redirectTo ||
				data.oauthSignIn ||
				redirecting ||
				$session.isPending
			) &&
			$session.data?.user
		) {
			loading = true;
			goto(resolve("/"));
		}
	});

	const REDIRECT_DELAY_SECONDS = 2;
	let redirecting = $state(false);
	let redirectCountdown = $state(REDIRECT_DELAY_SECONDS);
	const destinationName = $derived(data.appName ?? "Homerun");

	let signInError = $state<string | null>(null);
	const OAUTH_RETURN_TIMEOUT_MS = 15_000;

	async function finishSignIn() {
		signInError = null;
		if (data.oauthSignIn) {
			redirecting = true;
			setTimeout(() => {
				if (redirecting) {
					redirecting = false;
					loading = false;
					signInError = `You're signed in, but ${destinationName} didn't take you back. Try again, or open ${destinationName} and sign in from there.`;
				}
			}, OAUTH_RETURN_TIMEOUT_MS);
			return;
		}
		if (!data.redirectTo) {
			await refreshAll({ includeLoadFunctions: true });
			return;
		}
		const target = data.redirectTo;
		redirecting = true;
		redirectCountdown = REDIRECT_DELAY_SECONDS;
		const timer = setInterval(() => {
			redirectCountdown = Math.max(redirectCountdown - 1, 0);
		}, 1000);
		await new Promise((done) =>
			setTimeout(done, REDIRECT_DELAY_SECONDS * 1000),
		);
		clearInterval(timer);
		window.location.assign(target);
	}

	function signedInToast(message: string) {
		return data.redirectTo || data.oauthSignIn ? {} : { success: message };
	}

	let twoFactorStep = $state(false);
	let twoFactorMode = $state<"backup" | "totp">("totp");
	let twoFactorCode = $state("");
	let trustDevice = $state(false);
	let step = $state<"email" | "password" | "setup" | "sso">("email");
	let stepProviders = $state<SignInProvider[]>([]);
	let setupEmailed = $state(false);
	let setupCode = $state("");
	let newPassword = $state("");
	let confirmPassword = $state("");

	function backToEmail() {
		step = "email";
		password = "";
		setupCode = "";
		newPassword = "";
		confirmPassword = "";
	}

	async function continueCallback(e: SubmitEvent): Promise<string> {
		e.preventDefault();
		loading = true;
		try {
			const next = await lookupSignIn(email);
			loading = false;
			if (next.step === "setup") {
				setupEmailed = next.emailed;
				step = "setup";
				return next.emailed
					? `We emailed a code to ${email}.`
					: "Choose a password for your account.";
			}
			stepProviders = next.providers;
			step = next.step;
			if (next.step === "sso" && next.autoRedirect) {
				const provider = next.providers.find(
					(p) => p.name === next.autoRedirect,
				);
				if (provider) {
					void handleOauthSignIn(provider.name, provider.label);
				}
			}
			return "Continue signing in.";
		} catch (err) {
			loading = false;
			throw err;
		}
	}

	function handleContinue(e: SubmitEvent) {
		return toast.promise(continueCallback(e), {
			error: (err) => toastError(err, "Couldn't check that email."),
			loading: "Checking your account",
			success: (message: string) => message,
		});
	}

	async function setupCallback(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		try {
			if (newPassword !== confirmPassword) {
				throw new Error("The two passwords don't match.");
			}
			await completeAccountSetup({
				code: setupEmailed ? setupCode.trim() : null,
				email,
				password: newPassword,
			});
			const { error } = await signIn.email({ email, password: newPassword });
			if (error) {
				throw new Error(error.message ?? "Couldn't sign you in.");
			}
			newPassword = "";
			confirmPassword = "";
			await finishSignIn();
		} catch (err) {
			loading = false;
			newPassword = "";
			confirmPassword = "";
			throw err;
		}
	}

	function handleSetup(e: SubmitEvent) {
		return toast.promise(setupCallback(e), {
			error: (err) => toastError(err, "Couldn't set up your account."),
			loading: "Setting up your account",
			...signedInToast("Your account is ready"),
		});
	}

	async function resendCallback() {
		loading = true;
		try {
			await resendSetupCode(email);
		} finally {
			loading = false;
		}
	}

	function handleResend() {
		return toast.promise(resendCallback(), {
			error: (err) => toastError(err, "Couldn't send a new code."),
			loading: "Sending a new code",
			success: `We emailed a new code to ${email}.`,
		});
	}

	onMount(() => {
		title.set("Sign In");
		if (data.promptPasskeyOnLoad) {
			void promptPasskeyOnLoad();
			return;
		}
		void startPasskeyAutofill();
	});

	function passkeyFailure(error: { code?: string; message?: string } | null) {
		if (!error || error.code === "AUTH_CANCELLED") {
			return null;
		}
		return error.message || "Couldn't sign you in with a passkey.";
	}

	async function promptPasskeyOnLoad() {
		if (typeof PublicKeyCredential === "undefined") {
			return;
		}
		loading = true;
		try {
			const { error } = await authClient.signIn.passkey();
			const failure = passkeyFailure(error);
			if (error) {
				signInError = failure;
				loading = false;
				return;
			}
			await finishSignIn();
		} catch (err) {
			signInError = toastError(err, "Couldn't sign you in with a passkey.");
			loading = false;
			redirecting = false;
		}
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
		try {
			const { error } = await authClient.signIn.passkey({ autoFill: true });
			if (error) {
				signInError = passkeyFailure(error);
				return;
			}
			loading = true;
			await finishSignIn();
		} catch (err) {
			signInError = toastError(err, "Couldn't sign you in with a passkey.");
			loading = false;
			redirecting = false;
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
			await finishSignIn();
			return "signed-in";
		} catch (e) {
			password = "";
			loading = false;
			throw e;
		}
	}

	function handleSignIn(e: SubmitEvent) {
		return toast.promise(signIncallback(e), {
			error: (e) => toastError(e, "Couldn't sign you in."),
			loading: "Signing in",
			...(data.redirectTo || data.oauthSignIn
				? {}
				: {
						success: (outcome: "signed-in" | "two-factor") =>
							outcome === "two-factor"
								? "Enter your verification code to finish signing in."
								: "Signed in successfully",
					}),
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
			await finishSignIn();
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
			...signedInToast("Signed in successfully"),
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
			await finishSignIn();
		} catch (err) {
			loading = false;
			throw err;
		}
	}

	function handlePasskeySignIn() {
		return toast.promise(passkeySignInCallback(), {
			error: (err) => toastError(err, "Couldn't sign you in with a passkey."),
			loading: "Waiting for your passkey",
			...signedInToast("Signed in successfully"),
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
				callbackURL: data.redirectTo ?? resolve("/"),
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

{#snippet emailSummary()}
    <div class="border-border flex items-center justify-between gap-2 rounded-md border px-3 py-2">
        <span class="text-text truncate text-sm">{email}</span>
        <Button disabled={loading} onclick={backToEmail} size="sm" variant="ghost">
            Change
        </Button>
    </div>
{/snippet}

{#snippet orDivider()}
    <div class="my-6 flex items-center gap-3">
        <span class="bg-border h-px flex-1"></span>
        <span class="eyebrow">or</span>
        <span class="bg-border h-px flex-1"></span>
    </div>
{/snippet}

{#snippet oauthButtons(providers: SignInProvider[])}
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
        <div class="space-y-2">
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
        </div>
    {/if}
{/snippet}

<AuthShell
    eyebrow={data.oauthSignIn
        ? "Sign in with Homerun"
        : data.appName
          ? "Protected app"
          : "Sign in"}
    heading={data.appName ? `Sign in to ${data.appName}` : "Welcome back"}
    subheading={data.oauthSignIn
        ? `Use your Homerun account to sign in to ${data.appName ?? "this app"}.`
        : data.appName
          ? `${data.appName} is behind Homerun's login. Sign in to continue.`
          : "Sign in to manage your services."}
>
    {#if signInError}
        <Alert class="mb-4" title="Sign-in failed">{signInError}</Alert>
    {/if}
    {#if redirecting}
        <div
            aria-live="polite"
            class="flex flex-col items-center gap-3 py-6 text-center"
            role="status"
        >
            <Spinner class="text-accent size-6" />
            <p class="text-text text-sm font-medium">You're signed in</p>
            <p class="text-text-muted text-sm">
                {#if data.oauthSignIn}
                    Taking you back to {destinationName}…
                {:else}
                    Taking you to {destinationName} in {redirectCountdown}
                    {redirectCountdown === 1 ? "second" : "seconds"}…
                {/if}
            </p>
        </div>
    {:else if twoFactorStep}
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
        {#if step === "email"}
            <form class="space-y-4" novalidate onsubmit={handleContinue}>
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
                <Button class="h-10 w-full" disabled={loading || !email} type="submit">
                    {#if loading}
                        <Spinner />
                        Checking…
                    {:else}
                        Continue
                        <ArrowRight class="size-4 opacity-70" />
                    {/if}
                </Button>
            </form>
            {#if data.passkeyAvailable}
                {@render orDivider()}
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
        {:else if step === "password"}
            <form class="space-y-4" novalidate onsubmit={handleSignIn}>
                {@render emailSummary()}
                <PasswordField
                    autocomplete="current-password"
                    disabled={loading}
                    id="password"
                    label="Password"
                    bind:value={password}
                />
                <Button class="h-10 w-full" disabled={loading || !password} type="submit">
                    {#if loading}
                        <Spinner />
                        Signing in…
                    {:else}
                        Sign in
                        <ArrowRight class="size-4 opacity-70" />
                    {/if}
                </Button>
            </form>
            {#if stepProviders.length > 0}
                {@render orDivider()}
                {@render oauthButtons(stepProviders)}
            {/if}
        {:else if step === "sso"}
            <div class="space-y-4">
                {@render emailSummary()}
                <p class="text-text-muted text-sm">
                    This account signs in through single sign-on.
                </p>
                {@render oauthButtons(stepProviders)}
            </div>
        {:else}
            <form class="space-y-4" novalidate onsubmit={handleSetup}>
                {@render emailSummary()}
                <p class="text-text-muted text-sm">
                    {#if setupEmailed}
                        Enter the 6-digit code we emailed you, then choose your
                        password.
                    {:else}
                        Your account is new: choose your password.
                    {/if}
                </p>
                {#if setupEmailed}
                    <div>
                        <label
                            class="text-text mb-1.5 block text-sm font-medium"
                            for="setupCode"
                        >
                            Verification code
                        </label>
                        <Input
                            autocomplete="one-time-code"
                            class="h-10 font-mono tracking-widest"
                            disabled={loading}
                            id="setupCode"
                            inputmode="numeric"
                            placeholder="123456"
                            required
                            bind:value={setupCode}
                        />
                    </div>
                {/if}
                <PasswordField
                    autocomplete="new-password"
                    disabled={loading}
                    id="newPassword"
                    label="New password"
                    bind:value={newPassword}
                />
                <PasswordField
                    autocomplete="new-password"
                    disabled={loading}
                    id="confirmPassword"
                    label="Confirm password"
                    bind:value={confirmPassword}
                />
                <p class="text-text-subtle text-xs">At least 12 characters.</p>
                <Button
                    class="h-10 w-full"
                    disabled={loading ||
                        !newPassword ||
                        !confirmPassword ||
                        (setupEmailed && !setupCode.trim())}
                    type="submit"
                >
                    {#if loading}
                        <Spinner />
                        Setting up…
                    {:else}
                        Set password and sign in
                        <ArrowRight class="size-4 opacity-70" />
                    {/if}
                </Button>
                {#if setupEmailed}
                    <div class="text-center">
                        <button
                            class="text-text-muted hover:text-text text-xs underline-offset-4 hover:underline"
                            disabled={loading}
                            onclick={handleResend}
                            type="button"
                        >
                            Send a new code
                        </button>
                    </div>
                {/if}
            </form>
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
