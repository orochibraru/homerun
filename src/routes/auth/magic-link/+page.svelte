<script lang="ts">
	import { ArrowRight, MailX } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { resolve } from "$app/paths";
	import { authClient } from "$lib/auth-client";
	import AuthShell from "$lib/components/auth-shell.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";
	import { toastError } from "$lib/toast";
	import TwoFactorForm from "../sign-in/two-factor-form.svelte";

	const { data } = $props();

	let loading = $state(false);
	let twoFactorStep = $state(false);

	onMount(() => title.set("Sign In"));

	function finish() {
		window.location.assign(data.redirectTo ?? resolve("/"));
		return Promise.resolve();
	}

	async function verifyCallback(): Promise<"signed-in" | "two-factor"> {
		loading = true;
		try {
			const { data: result, error } = await authClient.magicLink.verify({
				query: { token: data.token },
			});
			if (error) {
				throw new Error(
					error.message ?? "This sign-in link is invalid or has expired.",
				);
			}
			if (result && "twoFactorRedirect" in result && result.twoFactorRedirect) {
				loading = false;
				twoFactorStep = true;
				return "two-factor";
			}
			await finish();
			return "signed-in";
		} catch (err) {
			loading = false;
			throw err;
		}
	}

	function handleVerify() {
		return toast.promise(verifyCallback(), {
			error: (err) => toastError(err, "Couldn't sign you in."),
			loading: "Signing in",
			success: (outcome: "signed-in" | "two-factor") =>
				outcome === "two-factor"
					? "Enter your verification code to finish signing in."
					: `Signed in, taking you to ${data.appName ?? "Homerun"}`,
		});
	}
</script>

{#if !data.email}
  <AuthShell
    eyebrow="Sign-in link"
    heading="This link doesn't work any more"
    subheading="Sign-in links work once and expire after 10 minutes. Ask for a new one from the sign-in page."
  >
    <div class="flex flex-col items-center gap-4 py-2 text-center">
      <span
        class="flex size-12 items-center justify-center rounded-md bg-amber-500/10 text-amber-500"
      >
        <MailX class="size-6" />
      </span>
      <Button href={resolve("/auth/sign-in")} variant="outline">
        Back to sign in
      </Button>
    </div>
  </AuthShell>
{:else}
  <AuthShell
    eyebrow="Sign-in link"
    heading={data.appName ? `Sign in to ${data.appName}` : "Finish signing in"}
    subheading="You opened a sign-in link sent to {data.email}."
  >
    {#if twoFactorStep}
      <TwoFactorForm
        onBack={() => {
          window.location.assign(resolve("/auth/sign-in"));
        }}
        onVerified={finish}
        bind:loading
      />
    {:else}
      <Button class="h-10 w-full" disabled={loading} onclick={handleVerify}>
        {#if loading}
          <Spinner />
          Signing in…
        {:else}
          Sign in as {data.email}
          <ArrowRight class="size-4 opacity-70" />
        {/if}
      </Button>
    {/if}
  </AuthShell>
{/if}
