<script lang="ts">
	import { LockKeyhole, ShieldX } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { signIn, signOut } from "$lib/auth-client";
	import BrandMark from "$lib/components/brand-mark.svelte";
	import PasswordField from "$lib/components/password-field.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { rememberOauthAttempt } from "$lib/oauth-attempt";
	import { title } from "$lib/store/title";
	import { toastError } from "$lib/toast";

	const { data } = $props();

	let email = $state("");
	let password = $state("");
	let loading = $state(false);

	const passwordMethod = $derived(
		data.methods.find((m) => m.kind === "password"),
	);
	const oauthMethods = $derived(data.methods.filter((m) => m.kind === "oauth"));

	onMount(() => title.set(`Sign in to ${data.appName}`));

	async function passwordSignInCallback() {
		loading = true;
		try {
			const { error } = await signIn.email({ email, password });
			if (error) {
				throw new Error(error.message ?? "Invalid credentials.");
			}
			await invalidateAll();
		} catch (err) {
			password = "";
			loading = false;
			throw err;
		}
	}

	function handlePasswordSignIn(event: SubmitEvent) {
		event.preventDefault();
		return toast.promise(passwordSignInCallback(), {
			error: (err) => toastError(err, "Couldn't sign you in."),
			loading: "Signing in",
			success: `Signed in. Sending you to ${data.appName}…`,
		});
	}

	async function oauthSignInCallback(providerId: string) {
		loading = true;
		rememberOauthAttempt(providerId);
		try {
			const { error } = await signIn.social({
				callbackURL: data.returnTo,
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

	function handleOauthSignIn(providerId: string, label: string) {
		return toast.promise(oauthSignInCallback(providerId), {
			error: (err) => toastError(err, `Couldn't sign you in with ${label}.`),
			loading: `Redirecting to ${label}`,
			success: `Redirecting to ${label}…`,
		});
	}

	async function switchAccountCallback() {
		await signOut();
		await invalidateAll();
	}

	function handleSwitchAccount() {
		return toast.promise(switchAccountCallback(), {
			error: (err) => toastError(err, "Couldn't sign you out."),
			loading: "Signing out",
			success: "Signed out.",
		});
	}
</script>

<div class="flex min-h-screen flex-col items-center justify-center px-6 py-12">
  <div class="w-full max-w-md">
    <div class="glass overflow-hidden rounded-2xl">
      <div
        class="flex items-center gap-3 border-b border-border bg-surface-2 px-6 py-5"
      >
        <div
          class="bg-accent/10 text-accent flex size-11 shrink-0 items-center justify-center rounded-xl"
        >
          {#if data.denial}
            <ShieldX class="size-5" />
          {:else}
            <LockKeyhole class="size-5" />
          {/if}
        </div>
        <div class="min-w-0">
          <p class="eyebrow">Protected app</p>
          <h1 class="text-text mt-0.5 truncate text-lg font-semibold">
            {data.appName}
          </h1>
        </div>
      </div>

      <div class="p-6">
        {#if data.denial}
          <p class="text-text-muted mb-4 text-sm">{data.denial}</p>
          <p class="text-text-subtle mb-5 font-mono text-xs">
            Signed in as {data.signedInAs}
          </p>
          <div class="flex flex-wrap gap-2">
            <Button onclick={handleSwitchAccount} variant="outline">
              Sign in as someone else
            </Button>
            <Button href={resolve("/")} variant="ghost">Back to Homerun</Button>
          </div>
        {:else if data.methods.length === 0}
          <p class="text-text-muted text-sm">
            This app is gated, but no sign-in method has been enabled for it
            yet, so nobody can be let through. An admin needs to pick one on the
            service's Networking tab.
          </p>
        {:else}
          <p class="text-text-muted mb-5 text-sm">
            Sign in to continue to this app.
          </p>

          {#if passwordMethod}
            <form class="space-y-4" onsubmit={handlePasswordSignIn}>
              <div>
                <label
                  class="text-text mb-1.5 block text-sm font-medium"
                  for="email"
                >
                  Email
                </label>
                <Input
                  autocomplete="email"
                  class="h-10"
                  id="email"
                  placeholder="you@example.com"
                  required
                  type="email"
                  bind:value={email}
                />
              </div>
              <PasswordField
                id="password"
                label="Password"
                bind:value={password}
              />
              <Button class="h-10 w-full" disabled={loading} type="submit">
                Sign in
              </Button>
            </form>
          {/if}

          {#if passwordMethod && oauthMethods.length > 0}
            <div class="my-5 flex items-center gap-3">
              <span class="bg-border h-px flex-1"></span>
              <span class="eyebrow">or</span>
              <span class="bg-border h-px flex-1"></span>
            </div>
          {/if}

          {#if oauthMethods.length > 0}
            <div class="space-y-2">
              {#each oauthMethods as method (method.id)}
                <Button
                  class="h-10 w-full"
                  disabled={loading}
                  onclick={() =>
                  handleOauthSignIn(method.providerId, method.label)}
                  variant="outline"
                >
                  Continue with {method.label}
                </Button>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </div>

    <div class="mt-6 flex items-center justify-center gap-2 opacity-60">
      <span class="text-text-subtle text-xs">gated by</span>
      <BrandMark />
    </div>
  </div>
</div>
