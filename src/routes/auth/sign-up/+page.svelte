<script lang="ts">
	import { ArrowRight, ShieldCheck } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { signUp, useSession } from "$lib/auth-client";
	import AuthShell from "$lib/components/auth-shell.svelte";
	import PasswordField from "$lib/components/password-field.svelte";
	import PasswordStrength from "$lib/components/password-strength.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";
	import { toastError } from "$lib/toast";

	const session = useSession();

	// Redirect if already logged in
	$effect(() => {
		if (!$session.isPending && $session.data?.user) {
			goto(resolve("/"));
		}
	});

	onMount(() => title.set("Create Account"));

	let name = $state("");
	let email = $state("");
	let password = $state("");
	let confirm = $state("");
	let loading = $state(false);

	const confirmClass = $derived.by(() => {
		if (!confirm) {
			return "";
		}
		return confirm === password
			? "border-green-500 focus-visible:ring-green-500/30"
			: "border-red-500 focus-visible:ring-red-500/30";
	});

	// ── Submit ─────────────────────────────────────────────────────────
	async function signUpCallback(e: SubmitEvent) {
		e.preventDefault();
		if (password.length < 12) {
			throw new Error("Password must be at least 12 characters.");
		}
		if (password !== confirm) {
			throw new Error("Passwords do not match.");
		}
		loading = true;
		try {
			const { error } = await signUp.email({ email, name, password });
			if (error) {
				throw new Error(
					error.message ?? "Could not create account. Please try again.",
				);
			}
			// Straight to the dashboard, not /auth/sign-up/confirm : this is
			// always the bootstrap-admin sign-up (every later account is
			// admin-direct-create or invite-accept, see hooks.server.ts's
			// SIGN_UP_PATH block), and the (protected) layout guard sends an
			// instance that hasn't finished onboarding to /onboarding, which
			// includes its own Email/SMTP step. Forcing email verification
			// *before* that was a real chicken-and-egg bug in production : an
			// admin with no SMTP configured yet (the normal fresh-install
			// case, since SMTP is one of the things onboarding sets up) had
			// no way to receive the very email that page waits for, and no
			// way off it either, dev's bypass button doesn't exist in prod.
			goto(resolve("/"));
		} catch (error) {
			loading = false;
			throw error;
		}
	}

	function handleSignUp(e: SubmitEvent) {
		return toast.promise(signUpCallback(e), {
			error: (error) => toastError(error, "Couldn't create your account."),
			loading: "Creating your account",
			success: "Account created",
		});
	}
</script>

<AuthShell
  eyebrow="First run"
  heading="Create your admin account"
  subheading="This is the first account on this instance, so it becomes the admin. Later accounts are created from the Users page."
>
  <form class="space-y-4" novalidate onsubmit={handleSignUp}>
    <div>
      <label class="text-text mb-1.5 block text-sm font-medium" for="name">
        Full name
      </label>
      <Input
        autocomplete="name"
        class="h-10"
        disabled={loading}
        id="name"
        placeholder="Jane Smith"
        required
        type="text"
        bind:value={name}
      />
    </div>

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

    <div>
      <PasswordField
        autocomplete="new-password"
        disabled={loading}
        id="password"
        label="Password"
        placeholder="Min. 12 characters"
        required
        bind:value={password}
      />
      <PasswordStrength {password} />
    </div>

    <div>
      <PasswordField
        autocomplete="new-password"
        class={confirmClass}
        disabled={loading}
        id="confirm"
        label="Confirm password"
        placeholder="Repeat your password"
        required
        bind:value={confirm}
      />
      {#if confirm && confirm !== password}
        <p class="mt-1.5 font-mono text-xs text-red-500">
          Passwords don't match.
        </p>
      {:else if confirm && confirm === password}
        <p
          class="mt-1.5 flex items-center gap-1.5 font-mono text-xs text-green-500"
        >
          <ShieldCheck class="size-3.5" />
          Passwords match
        </p>
      {/if}
    </div>

    <Button
      class="mt-2 h-10 w-full"
      disabled={loading || !name || !email || !password || !confirm}
      type="submit"
    >
      {#if loading}
        <Spinner />
        Creating account…
      {:else}
        Create account
        <ArrowRight class="size-4 opacity-70" />
      {/if}
    </Button>
  </form>

  {#snippet footer()}
    Already have an account?
    <a
      class="text-accent font-medium hover:underline"
      href={resolve("/auth/sign-in")}
    >
      Sign in
    </a>
  {/snippet}
</AuthShell>
