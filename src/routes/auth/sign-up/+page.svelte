<script lang="ts">
	import { Eye, EyeOff, Loader2, Server, ShieldCheck } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { signUp, useSession } from "$lib/auth-client";
	import AuthBrandingPanel from "$lib/components/auth-branding-panel.svelte";
	import {
		getPasswordStrength,
		getPasswordStrengthMeta,
	} from "$lib/formatting";
	import { title } from "$lib/store/title";

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
	let showPassword = $state(false);
	let showConfirm = $state(false);

	const inputClass =
		"w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text)] placeholder-[var(--color-text-subtle)] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";

	// ── Password strength ──────────────────────────────────────────────
	const passwordStrength = $derived(getPasswordStrength(password));
	const strengthMeta = $derived(getPasswordStrengthMeta(passwordStrength));

	// ── Submit ─────────────────────────────────────────────────────────
	async function handleSignUp(e: SubmitEvent) {
		e.preventDefault();
		if (password.length < 12) {
			toast.error("Password must be at least 12 characters.");
			return;
		}
		if (password !== confirm) {
			toast.error("Passwords do not match.");
			return;
		}
		loading = true;
		try {
			const { error } = await signUp.email({ email, password, name });
			if (error) {
				toast.error(
					error.message ?? "Could not create account. Please try again.",
				);
				return;
			}
			// Always land on confirm so the user knows to check their email
			// (or gets the dev-mode bypass if SMTP isn't configured)
			goto(resolve("/auth/sign-up/confirm"));
		} catch {
			toast.error("An unexpected error occurred. Please try again.");
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex min-h-[calc(100vh-4rem)]">
  <AuthBrandingPanel />

  <!-- ── Right panel ──────────────────────────────────────────────── -->
  <div
    class="flex flex-1 flex-col items-center justify-center bg-[var(--color-bg)] px-6 py-10 sm:px-10"
  >
    <!-- Mobile-only logo -->
    <div class="mb-8 text-center lg:hidden">
      <a
        href={resolve("/")}
        class="inline-flex items-center gap-1.5 text-xl font-bold"
      >
        <Server class="text-accent size-5" />
        <span class="text-[var(--color-text)]">Local</span><span
          class="text-accent">Run</span
        >
      </a>
      <p class="mt-1 text-sm text-[var(--color-text-muted)]">
        Deploy containers to your own server.
      </p>
    </div>

    <div class="w-full max-w-md">
      <!-- Header -->
      <div class="mb-8">
        <h2 class="text-2xl font-bold text-[var(--color-text)]">
          Create your account
        </h2>
        <p class="mt-1 text-sm text-[var(--color-text-muted)]">
          Deploy your first container in minutes.
        </p>
      </div>

      <form onsubmit={handleSignUp} class="space-y-5" novalidate>
        <!-- Full name -->
        <div>
          <label
            for="name"
            class="mb-1.5 block text-sm font-medium text-[var(--color-text)]"
          >
            Full name <span class="text-red-500">*</span>
          </label>
          <input
            id="name"
            type="text"
            bind:value={name}
            placeholder="Jane Smith"
            autocomplete="name"
            required
            disabled={loading}
            class={inputClass}
          />
        </div>

        <!-- Email -->
        <div>
          <label
            for="email"
            class="mb-1.5 block text-sm font-medium text-[var(--color-text)]"
          >
            Email <span class="text-red-500">*</span>
          </label>
          <input
            id="email"
            type="email"
            bind:value={email}
            placeholder="you@example.com"
            autocomplete="email"
            required
            disabled={loading}
            class={inputClass}
          />
        </div>

        <!-- Password -->
        <div>
          <label
            for="password"
            class="mb-1.5 block text-sm font-medium text-[var(--color-text)]"
          >
            Password <span class="text-red-500">*</span>
          </label>
          <div class="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              bind:value={password}
              placeholder="Min. 12 characters"
              autocomplete="new-password"
              required
              disabled={loading}
              class="{inputClass} pr-12"
            />
            <button
              type="button"
              onclick={() => (showPassword = !showPassword)}
              class="absolute top-1/2 right-3.5 -translate-y-1/2 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {#if showPassword}
                <EyeOff class="size-4" />
              {:else}
                <Eye class="size-4" />
              {/if}
            </button>
          </div>

          <!-- Strength meter -->
          {#if password}
            <div class="mt-2.5">
              <div class="flex gap-1">
                {#each [1, 2, 3, 4] as level}
                  <div
                    class="h-1 flex-1 rounded-full transition-all duration-300
										{level <= passwordStrength ? strengthMeta.bar : 'bg-[var(--color-surface-3)]'}"
                  ></div>
                {/each}
              </div>
              <p class="mt-1 text-xs text-[var(--color-text-muted)]">
                Password strength:
                <span class="font-medium {strengthMeta.text}"
                  >{strengthMeta.label}</span
                >
              </p>
            </div>
          {/if}
        </div>

        <!-- Confirm password -->
        <div>
          <label
            for="confirm"
            class="mb-1.5 block text-sm font-medium text-[var(--color-text)]"
          >
            Confirm password <span class="text-red-500">*</span>
          </label>
          <div class="relative">
            <input
              id="confirm"
              type={showConfirm ? "text" : "password"}
              bind:value={confirm}
              placeholder="Repeat your password"
              autocomplete="new-password"
              required
              disabled={loading}
              class="{inputClass} pr-12
							{confirm && confirm !== password
                ? 'border-red-500 focus:ring-red-500'
                : confirm && confirm === password
                  ? 'border-green-500 focus:ring-green-500'
                  : ''}"
            />
            <button
              type="button"
              onclick={() => (showConfirm = !showConfirm)}
              class="absolute top-1/2 right-3.5 -translate-y-1/2 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
              aria-label={showConfirm ? "Hide password" : "Show password"}
            >
              {#if showConfirm}
                <EyeOff class="size-4" />
              {:else}
                <Eye class="size-4" />
              {/if}
            </button>
          </div>
          {#if confirm && confirm !== password}
            <p class="mt-1 text-xs text-red-500">Passwords don't match.</p>
          {:else if confirm && confirm === password}
            <p class="mt-1 flex items-center gap-1 text-xs text-green-500">
              <ShieldCheck class="size-3.5" /> Passwords match
            </p>
          {/if}
        </div>

        <!-- Submit -->
        <button
          type="submit"
          disabled={loading || !name || !email || !password || !confirm}
          class="bg-accent shadow-accent/30 hover:bg-accent-dark mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {#if loading}
            <Loader2 class="size-4 animate-spin" />
            Creating account…
          {:else}
            Create account
            <span class="opacity-70">→</span>
          {/if}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-[var(--color-text-muted)]">
        Already have an account?
        <a
          href={resolve("/auth/sign-in")}
          class="text-accent font-medium hover:underline"
        >
          Sign in
        </a>
      </p>
    </div>
  </div>
</div>
