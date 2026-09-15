<script lang="ts">
	import {
		ArrowRight,
		CircleCheckIcon,
		FlaskConical,
		Mail,
		RefreshCw,
		TriangleAlert,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { authClient } from "$lib/auth-client";
	import AuthShell from "$lib/components/auth-shell.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";
	import { toastError } from "$lib/toast";

	const { data } = $props();

	onMount(() => title.set("Confirm your email"));

	let resending = $state(false);
	let resent = $state(false);
	let checking = $state(false);

	const STEPS = [
		"Open the email from Homerun",
		'Click the "Confirm email" button',
		"You'll be signed in automatically",
	];

	// ── Resend verification email ──────────────────────────────────────
	async function resendEmailCallback() {
		resending = true;
		resent = false;
		try {
			await authClient.sendVerificationEmail({
				callbackURL: resolve("/"),
				email: data.email,
			});
			resent = true;
		} finally {
			resending = false;
		}
	}

	function resendEmail() {
		return toast.promise(resendEmailCallback(), {
			error: (error) =>
				toastError(error, "Could not resend the email. Please try again."),
			loading: "Sending the verification email",
			success: "Verification email sent! Check your inbox.",
		});
	}

	// ── Poll / manual check ────────────────────────────────────────────
	async function checkVerificationCallback() {
		checking = true;
		try {
			// Re-fetch the session; if email is now verified the server
			// will redirect away from this page on the next full load.
			const session = await authClient.getSession();
			if (!session.data?.user?.emailVerified) {
				throw new Error(
					"Not verified yet : check your inbox and click the link.",
				);
			}
			goto(resolve("/"));
		} finally {
			checking = false;
		}
	}

	function checkVerification() {
		return toast.promise(checkVerificationCallback(), {
			error: (error) =>
				toastError(error, "Could not check verification status."),
			loading: "Checking verification status",
			success: "Email verified! Taking you to your dashboard…",
		});
	}

	// ── Dev bypass ─────────────────────────────────────────────────────
	function devBypass() {
		goto(resolve("/"));
	}
</script>

<AuthShell
  eyebrow="Verify"
  heading="Check your inbox"
  subheading="One link stands between you and the dashboard."
>
  <div class="text-center">
    <div
      class="bg-accent/10 ring-accent/5 mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl ring-8"
    >
      <Mail class="text-accent size-7" />
    </div>
    <p class="text-text-muted text-sm leading-relaxed">
      We sent a confirmation link to
      <span class="text-text block font-mono text-xs">{data.email}</span>
    </p>
  </div>

  <ol class="mt-6 space-y-2.5">
    {#each STEPS as step, i (step)}
      <li class="text-text-muted flex items-start gap-3 text-sm">
        <span
          class="bg-accent/10 text-accent mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[0.65rem] font-bold"
        >
          {i + 1}
        </span>
        {step}
      </li>
    {/each}
  </ol>

  <Button class="mt-6 h-10 w-full" disabled={checking} onclick={checkVerification}>
    {#if checking}
      <Spinner />
      Checking…
    {:else}
      <CircleCheckIcon class="size-4" />
      I've confirmed my email
      <ArrowRight class="size-4 opacity-70" />
    {/if}
  </Button>

  <div class="mt-3 text-center">
    {#if resent}
      <p
        class="flex items-center justify-center gap-1.5 text-sm text-green-600"
      >
        <CircleCheckIcon class="size-4" />
        Email sent! Check your spam folder if you don't see it.
      </p>
    {:else}
      <Button
        class="text-text-muted hover:text-text"
        disabled={resending}
        onclick={resendEmail}
        variant="link"
      >
        {#if resending}
          <Spinner />
          Sending…
        {:else}
          <RefreshCw class="size-3.5" />
          Resend confirmation email
        {/if}
      </Button>
    {/if}
  </div>

  {#snippet below()}
    {#if data.isDev}
      <div
        class="overflow-hidden rounded-2xl border border-amber-300/40 bg-amber-50/80 dark:border-amber-500/20 dark:bg-amber-950/20"
      >
        <div
          class="flex items-start gap-3 border-b border-amber-200/60 px-4 py-3 dark:border-amber-800/30"
        >
          <TriangleAlert
            class="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
          />
          <div>
            <p class="text-xs font-semibold text-amber-800 dark:text-amber-300">
              Development mode
            </p>
            <p class="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
              SMTP is not configured, so no email was sent. You can bypass
              verification to continue working locally.
            </p>
          </div>
          <span
            class="ml-auto flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
          >
            <FlaskConical class="size-3" />
            DEV
          </span>
        </div>
        <div class="px-4 py-3">
          <button
            class="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-medium text-amber-800 transition-all duration-200 hover:bg-amber-50 dark:border-amber-700/50 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
            onclick={devBypass}
            type="button"
          >
            <FlaskConical class="size-4" />
            Skip verification and go to dashboard
            <ArrowRight class="size-4" />
          </button>
        </div>
      </div>
    {/if}
  {/snippet}

  {#snippet footer()}
    Wrong email?
    <a class="text-accent hover:underline" href={resolve("/auth/sign-up")}>
      Create a new account
    </a>
    or
    <a class="text-accent hover:underline" href={resolve("/auth/sign-in")}>
      sign in to a different one
    </a>.
  {/snippet}
</AuthShell>
