<script lang="ts">
	import {
		CheckCircle2,
		Fingerprint,
		LogOut,
		Smartphone,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { refreshAll } from "$app/navigation";
	import { signOut } from "$lib/auth-client";
	import AuthShell from "$lib/components/auth-shell.svelte";
	import PasskeyPanel from "$lib/components/passkey-panel.svelte";
	import TwoFactorPanel from "$lib/components/two-factor-panel.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";
	import { toastError } from "$lib/toast";

	const { data } = $props();

	onMount(() => title.set("Secure your account"));

	const needsTwoFactor = $derived(data.unmet.includes("twoFactor"));
	const needsPasskey = $derived(data.unmet.includes("passkey"));

	async function signOutCallback() {
		const { error } = await signOut();
		if (error) {
			throw new Error(error.message ?? "Couldn't sign you out.");
		}
		await refreshAll();
	}

	function handleSignOut() {
		return toast.promise(signOutCallback(), {
			error: (err) => toastError(err, "Couldn't sign you out."),
			loading: "Signing you out",
			success: "Signed out.",
		});
	}
</script>

<AuthShell
  eyebrow="Account security"
  heading="Secure your account"
  subheading="An admin requires extra sign-in protection on this instance. Finish the steps below to continue to the dashboard."
>
  <div class="space-y-6">
    <p class="text-text-muted text-xs">
      Signed in as <span class="text-text font-medium">{data.email}</span>
    </p>

    {#if data.policy.requireTwoFactor}
      <section class="space-y-3">
        <h2 class="text-text flex items-center gap-2 text-sm font-semibold">
          {#if needsTwoFactor}
            <Smartphone class="size-4" />
          {:else}
            <CheckCircle2 class="size-4 text-emerald-500" />
          {/if}
          Two-factor authentication
        </h2>
        {#if needsTwoFactor}
          <TwoFactorPanel enabled={false} hasPassword={data.hasPassword} />
        {:else}
          <p class="text-text-muted text-xs">Authenticator app is set up.</p>
        {/if}
      </section>
    {/if}

    {#if data.policy.requirePasskey}
      <section class="space-y-3">
        <h2 class="text-text flex items-center gap-2 text-sm font-semibold">
          {#if needsPasskey}
            <Fingerprint class="size-4" />
          {:else}
            <CheckCircle2 class="size-4 text-emerald-500" />
          {/if}
          Passkey
        </h2>
        <PasskeyPanel passkeys={data.passkeys} />
      </section>
    {/if}
  </div>

  {#snippet footer()}
    <Button onclick={handleSignOut} size="sm" variant="ghost">
      <LogOut class="size-4" />
      Sign out
    </Button>
  {/snippet}
</AuthShell>
