<script lang="ts">
	import { ArrowRight, TriangleAlert } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { goto, onNavigate, refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { signIn, useSession } from "$lib/auth-client";
	import AuthShell from "$lib/components/auth-shell.svelte";
	import PasswordField from "$lib/components/password-field.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { rememberOauthAttempt } from "$lib/oauth-attempt";
	import { title } from "$lib/store/title";

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
			await refreshAll({ includeLoadFunctions: true });
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

<AuthShell
  eyebrow="Sign in"
  heading="Welcome back"
  subheading="Sign in to manage your services."
>
  <form class="space-y-4" novalidate onsubmit={handleSignIn}>
    <div>
      <label class="text-text mb-1.5 block text-sm font-medium" for="email">
        Email
      </label>
      <Input
        autocomplete="email"
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

  {#if data.oauthProviders.length > 0}
    <div class="my-6 flex items-center gap-3">
      <span class="bg-border h-px flex-1"></span>
      <span class="eyebrow">or</span>
      <span class="bg-border h-px flex-1"></span>
    </div>
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
          instead, or use your email and password here.
        </span>
      </div>
    {:else}
      <div class="space-y-2">
        {#each data.oauthProviders as provider (provider.name)}
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
