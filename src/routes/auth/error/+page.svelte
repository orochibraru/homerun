<script lang="ts">
	import { KeyRound, ShieldAlert } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { authClient, signIn, signOut } from "$lib/auth-client";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { clearOauthAttempt, lastOauthAttempt } from "$lib/oauth-attempt";
	import { title } from "$lib/store/title";
	import { toastError } from "$lib/toast";

	const { data } = $props();

	const code = $derived(
		(
			page.url.searchParams.get("error") ??
			page.url.searchParams.get("error_description") ??
			"unknown"
		)
			.trim()
			.toLowerCase()
			.replace(/[\s-]+/g, "_"),
	);

	const EXPLANATIONS: Record<string, { body: string; heading: string }> = {
		account_not_linked: {
			body: "An account with this email address already exists here, but it isn't connected to that provider yet. Connecting it while you're signed in is what proves both accounts are yours, which signing in through the provider alone can't.",
			heading: "That provider isn't connected to your account yet",
		},
		email_not_found: {
			body: "That provider didn't return an email address, so there's no way to tell which account you meant. Add an email scope to the provider on the Authentication page, or connect it from your profile while signed in instead.",
			heading: "The provider sent no email address",
		},
		email_not_verified: {
			body: "Your identity provider hasn't verified that email address, so it can't be used to prove who you are here. Verify it with the provider, or connect it from your profile while signed in instead.",
			heading: "That email isn't verified with the provider",
		},
		invalid_callback_request: {
			body: "The provider sent this instance a response it couldn't read. Start the sign-in again from this instance's own sign-in page.",
			heading: "That sign-in response wasn't valid",
		},
		state_mismatch: {
			body: "The sign-in attempt took too long, or it started on a different address than it finished on. Start again from this instance's own sign-in page, and check that the Dashboard URL under Settings → General matches how you actually reach Homerun.",
			heading: "That sign-in attempt expired",
		},
		unable_to_create_user: {
			body: "Sign-up is closed on this instance, so a provider can't create a new account on its own. An admin has to create it from the Users page first, then you can connect the provider to it.",
			heading: "No account here to sign in to",
		},
	};

	const detail = $derived(
		EXPLANATIONS[code] ?? {
			body: "Something went wrong while signing you in. Try again, and if it keeps happening the System Logs page has the details.",
			heading: "Sign-in didn't complete",
		},
	);

	let attempted = $state<string | null>(null);
	let busy = $state(false);

	const linkable = $derived(
		code === "account_not_linked"
			? (data.providers.find((p) => p.name === attempted) ??
					(data.providers.length === 1 ? data.providers[0] : null))
			: null,
	);

	let email = $state("");
	let password = $state("");

	onMount(() => {
		title.set("Sign-in problem");
		attempted = lastOauthAttempt();
	});

	async function startLink(providerId: string) {
		const { error } = await authClient.linkSocial({
			callbackURL: resolve("/profile/security"),
			provider: providerId as never,
		});
		if (error) {
			throw new Error(error.message ?? "Couldn't start the connection.");
		}
		clearOauthAttempt();
	}

	async function linkCallback(providerId: string) {
		busy = true;
		try {
			await startLink(providerId);
		} catch (err) {
			busy = false;
			throw err;
		}
	}

	function handleLink(providerId: string, providerLabel: string) {
		return toast.promise(linkCallback(providerId), {
			error: (err) => toastError(err, `Couldn't connect ${providerLabel}.`),
			loading: `Connecting ${providerLabel}`,
			success: `Redirecting to ${providerLabel}…`,
		});
	}

	async function signInAndLinkCallback(providerId: string) {
		busy = true;
		try {
			const { error } = await signIn.email({ email, password });
			if (error) {
				throw new Error(error.message ?? "Invalid credentials.");
			}
			await startLink(providerId);
		} catch (err) {
			password = "";
			busy = false;
			throw err;
		}
	}

	function handleSignInAndLink(
		event: SubmitEvent,
		providerId: string,
		providerLabel: string,
	) {
		event.preventDefault();
		return toast.promise(signInAndLinkCallback(providerId), {
			error: (err) => toastError(err, `Couldn't connect ${providerLabel}.`),
			loading: `Signing in and connecting ${providerLabel}`,
			success: `Redirecting to ${providerLabel}…`,
		});
	}

	async function signOutCallback() {
		busy = true;
		try {
			await signOut();
			clearOauthAttempt();
			await invalidateAll();
			await goto(resolve("/auth/sign-in"));
		} finally {
			busy = false;
		}
	}

	function handleSignOut() {
		return toast.promise(signOutCallback(), {
			error: (err) => toastError(err, "Couldn't sign you out."),
			loading: "Signing out",
			success: "Signed out.",
		});
	}
</script>

<div class="flex min-h-screen items-center justify-center px-6 py-12">
  <div class="glass w-full max-w-md rounded-2xl p-6">
    <div class="mb-5 flex items-center gap-3">
      <div
        class="flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"
      >
        <ShieldAlert class="size-5" />
      </div>
      <div class="min-w-0">
        <p class="eyebrow">Sign-in</p>
        <h1 class="text-text text-lg font-semibold">{detail.heading}</h1>
      </div>
    </div>

    <p class="text-text-muted mb-5 text-sm">{detail.body}</p>

    {#if code === "account_not_linked"}
      {#if data.signedInAs}
        <p class="text-text-subtle mb-4 font-mono text-xs">
          Signed in as {data.signedInAs}
        </p>
        <div class="flex flex-wrap gap-2">
          {#if linkable}
            <Button disabled={busy} onclick={() => handleLink(linkable.name, linkable.label)}>
              <KeyRound class="size-4" />
              Link {linkable.label} to this account
            </Button>
          {:else}
            {#each data.providers as provider (provider.name)}
              <Button
                disabled={busy}
                onclick={() => handleLink(provider.name, provider.label)}
              >
                <KeyRound class="size-4" />
                Link {provider.label}
              </Button>
            {/each}
          {/if}
          <Button disabled={busy} onclick={handleSignOut} variant="outline">
            Sign out
          </Button>
        </div>
      {:else if linkable}
        <form
          class="space-y-3"
          onsubmit={(event) =>
          handleSignInAndLink(event, linkable.name, linkable.label)}
        >
          <p class="text-text-subtle text-xs">
            Sign in with your existing password and {linkable.label} will be
            connected to that account straight away.
          </p>
          <div>
            <label class="text-text mb-1.5 block text-sm font-medium" for="email">
              Email
            </label>
            <Input
              autocomplete="email"
              id="email"
              required
              type="email"
              bind:value={email}
            />
          </div>
          <div>
            <label class="text-text mb-1.5 block text-sm font-medium" for="password">
              Password
            </label>
            <Input
              autocomplete="current-password"
              id="password"
              required
              type="password"
              bind:value={password}
            />
          </div>
          <Button class="w-full" disabled={busy} type="submit">
            <KeyRound class="size-4" />
            Sign in and connect {linkable.label}
          </Button>
        </form>
      {:else}
        <p class="text-text-subtle mb-4 text-xs">
          Sign in with your email and password first, then connect the provider
          from your profile.
        </p>
        <div class="flex flex-wrap gap-2">
          <Button href={resolve("/auth/sign-in")}>Sign in</Button>
          <Button href={resolve("/")} variant="ghost">
            Go to the dashboard
          </Button>
        </div>
      {/if}
    {:else}
      <div class="flex flex-wrap gap-2">
        <Button href={resolve("/auth/sign-in")}>Back to sign in</Button>
        {#if data.signedInAs}
          <Button disabled={busy} onclick={handleSignOut} variant="outline">
            Sign out
          </Button>
        {:else}
          <Button href={resolve("/")} variant="ghost">
            Go to the dashboard
          </Button>
        {/if}
      </div>
    {/if}

    <p class="text-text-subtle mt-5 font-mono text-xs">code: {code}</p>
  </div>
</div>
