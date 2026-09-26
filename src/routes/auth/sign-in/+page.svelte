<script lang="ts">
	import {
		ArrowRight,
		Fingerprint,
		Link,
		Mail,
		TriangleAlert,
	} from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { toast } from "svelte-sonner";
	import { goto, onNavigate, refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { authClient, signIn, useSession } from "$lib/auth-client";
	import { type EmailSignIn, NO_EMAIL_SIGN_IN } from "$lib/auth-providers";
	import Alert from "$lib/components/alert.svelte";
	import AuthShell from "$lib/components/auth-shell.svelte";
	import PasswordField from "$lib/components/password-field.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { rememberOauthAttempt } from "$lib/oauth-attempt";
	import { lookupSignIn } from "$lib/remote/sign-in.remote";
	import type { SignInProvider } from "$lib/services/account-setup.service";
	import { title } from "$lib/store/title";
	import { toastError } from "$lib/toast";
	import EmailSignInForm from "./email-sign-in-form.svelte";
	import SetupForm from "./setup-form.svelte";
	import TwoFactorForm from "./two-factor-form.svelte";

	const { data } = $props();

	let email = $state(untrack(() => data.email) ?? "");
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

	function signedInToast(message: string): { success?: string } {
		return data.redirectTo || data.oauthSignIn ? {} : { success: message };
	}

	let twoFactorStep = $state(false);
	let step = $state<"code" | "email" | "link" | "password" | "setup" | "sso">(
		"email",
	);
	let stepProviders = $state<SignInProvider[]>([]);
	let stepEmail = $state<EmailSignIn>(NO_EMAIL_SIGN_IN);
	const offerLink = $derived(stepEmail.magicLink && !data.oauthSignIn);
	let setupEmailed = $state(false);

	function backToEmail() {
		step = "email";
		password = "";
	}

	async function continueCallback(e: SubmitEvent): Promise<string> {
		e.preventDefault();
		loading = true;
		try {
			const next = await lookupSignIn(email);
			loading = false;
			stepEmail = next.email;
			if (next.step === "email-only") {
				stepProviders = [];
				step = next.email.emailOtp ? "code" : offerLink ? "link" : "password";
				return "Continue signing in.";
			}
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

{#snippet emailButtons()}
    {#if stepEmail.emailOtp || offerLink}
        <div class="space-y-2">
            {#if stepEmail.emailOtp}
                <Button
                    class="h-10 w-full"
                    disabled={loading}
                    onclick={() => {
                        step = "code";
                    }}
                    variant="outline"
                >
                    <Mail class="size-4" />
                    Email me a code
                </Button>
            {/if}
            {#if offerLink}
                <Button
                    class="h-10 w-full"
                    disabled={loading}
                    onclick={() => {
                        step = "link";
                    }}
                    variant="outline"
                >
                    <Link class="size-4" />
                    Email me a sign-in link
                </Button>
            {/if}
        </div>
    {/if}
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
        <TwoFactorForm
            onBack={() => {
                twoFactorStep = false;
            }}
            onVerified={finishSignIn}
            successMessage={signedInToast("Signed in successfully").success}
            bind:loading
        />
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
            {#if stepProviders.length > 0 || stepEmail.emailOtp || offerLink}
                {@render orDivider()}
                <div class="space-y-2">
                    {@render emailButtons()}
                    {#if stepProviders.length > 0}
                        {@render oauthButtons(stepProviders)}
                    {/if}
                </div>
            {/if}
        {:else if step === "sso"}
            <div class="space-y-4">
                {@render emailSummary()}
                <p class="text-text-muted text-sm">
                    This account signs in through single sign-on.
                </p>
                {@render oauthButtons(stepProviders)}
            </div>
            {#if stepEmail.emailOtp || offerLink}
                {@render orDivider()}
                {@render emailButtons()}
            {/if}
        {:else if step === "code" || step === "link"}
            {#key step}
                <EmailSignInForm
                    {email}
                    mode={step}
                    onSignedIn={finishSignIn}
                    onTwoFactor={() => {
                        twoFactorStep = true;
                    }}
                    redirectTo={data.redirectTo}
                    successMessage={signedInToast("Signed in successfully").success}
                    summary={emailSummary}
                    bind:loading
                />
            {/key}
        {:else}
            <SetupForm
                {email}
                emailed={setupEmailed}
                onEmailCode={stepEmail.emailOtp
                    ? () => {
                          step = "code";
                      }
                    : undefined}
                onSignedIn={finishSignIn}
                successMessage={signedInToast("Your account is ready").success}
                summary={emailSummary}
                bind:loading
            />
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
