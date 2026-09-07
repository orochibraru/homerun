<script lang="ts">
	import { Eye, EyeOff, Server } from "@lucide/svelte";
	import { onDestroy, onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { goto, onNavigate } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { signIn, useSession } from "$lib/auth-client";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { rememberOauthAttempt } from "$lib/oauth-attempt";
	import { title } from "$lib/store/title";

	const { data } = $props();

	let email = $state("");
	let password = $state("");
	let loading = $state(false);
	let showPassword = $state(false);

	const session = useSession();

	// Redirect if already logged in
	$effect(() => {
		if (!$session.isPending && $session.data?.user) {
			loading = true;
			goto(resolve("/"));
		}
	});

	onMount(() => title.set("Sign In"));

	async function signIncallback(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		try {
			const { error } = await signIn.email({ email, password });
			if (error) {
				password = "";
				throw new Error(
					error.message ?? "Invalid credentials. Please try again.",
				);
			}
			goto(resolve("/"));
		} catch (e) {
			password = "";
			loading = false;
			throw e;
		}
	}

	function handleSignIn(e: SubmitEvent) {
		return toast.promise(signIncallback(e), {
			loading: "Signing in",
			success: "Signed in successfully",
			error: (e) => (e instanceof Error ? e.message : "Couldn't sign you in."),
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

<div class="flex min-h-[calc(100vh-4rem)]">
    <div
        class="flex flex-1 flex-col items-center justify-center bg-bg px-6 py-10 sm:px-10"
    >
        <!-- Mobile-only logo -->
        <div class="mb-8 text-center lg:hidden">
            <a
                class="inline-flex items-center gap-1.5 text-xl font-bold"
                href={resolve("/")}
            >
                <Server class="text-accent size-5" />
                <span class="text-text">Local</span><span class="text-accent"
                    >Run</span
                >
            </a>
            <p class="text-text-muted mt-1 text-sm">
                Deploy containers to your own server.
            </p>
        </div>

        <div class="w-full max-w-md">
            <!-- Header -->
            <div class="mb-8">
                <h2 class="text-text text-2xl font-semibold tracking-tight">
                    Welcome back
                </h2>
                <p class="text-text-muted mt-1 text-sm">
                    Sign in to manage your services.
                </p>
            </div>

            <form class="space-y-5" novalidate onsubmit={handleSignIn}>
                <!-- Email -->
                <div>
                    <label
                        class="text-text mb-1.5 block text-sm font-medium"
                        for="email"
                    >
                        Email
                    </label>
                    <Input
                        autocomplete="email"
                        disabled={loading}
                        id="email"
                        placeholder="you@example.com"
                        required
                        type="email"
                        bind:value={email}
                    />
                </div>

                <!-- Password -->
                <div>
                    <div class="mb-1.5 flex items-center justify-between">
                        <label
                            class="text-text text-sm font-medium"
                            for="password"
                        >
                            Password
                        </label>
                    </div>
                    <div class="relative">
                        <Input
                            autocomplete="current-password"
                            class="pr-12"
                            disabled={loading}
                            id="password"
                            placeholder="••••••••••••"
                            required
                            type={showPassword ? "text" : "password"}
                            bind:value={password}
                        />
                        <Button
                            aria-label={showPassword
                                ? "Hide password"
                                : "Show password"}
                            class="absolute top-1/2 right-1.5 -translate-y-1/2"
                            onclick={() => {
                                showPassword = !showPassword;
                            }}
                            size="icon-sm"
                            variant="ghost"
                        >
                            {#if showPassword}
                                <EyeOff class="size-4" />
                            {:else}
                                <Eye class="size-4" />
                            {/if}
                        </Button>
                    </div>
                </div>

                <!-- Submit -->
                <Button
                    class="mt-2 w-full"
                    disabled={loading || !email || !password}
                    type="submit"
                >
                    {#if loading}
                        <Spinner />
                        Signing in…
                    {:else}
                        Sign in
                        <span class="opacity-70">→</span>
                    {/if}
                </Button>
            </form>

            {#if data.oauthProviders.length > 0}
                <div class="my-6 flex items-center gap-3">
                    <span class="bg-border h-px flex-1"></span>
                    <span class="text-text-subtle text-xs uppercase">or</span>
                    <span class="bg-border h-px flex-1"></span>
                </div>
                {#if data.canonicalSignInUrl}
                    <p
                        class="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600"
                    >
                        You've reached this instance on a different address than
                        its configured Origin, and single sign-on has to start
                        there so the provider can hand you back.
                        <a
                            class="font-medium underline"
                            href={data.canonicalSignInUrl}
                        >
                            Sign in on the configured address
                        </a>
                        instead, or use your email and password here.
                    </p>
                {:else}
                    <div class="space-y-2">
                        {#each data.oauthProviders as provider (provider.name)}
                            <Button
                                class="w-full"
                                disabled={loading}
                                onclick={() =>
                                handleOauthSignIn(provider.name, provider.label)}
                                variant="outline"
                            >
                                Continue with {provider.label}
                            </Button>
                        {/each}
                    </div>
                {/if}
            {/if}

            <p class="mt-6 text-center text-sm text-text-muted">
                Don't have an account?
                <a
                    class="text-accent font-medium hover:underline"
                    href={resolve("/auth/sign-up")}
                >
                    Create one free
                </a>
            </p>
        </div>
    </div>
</div>
