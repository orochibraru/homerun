<script lang="ts">
	import { Eye, EyeOff, Loader2, Server } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { dev } from "$app/environment";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { signIn, useSession } from "$lib/auth-client";
	import AuthBrandingPanel from "$lib/components/auth-branding-panel.svelte";
	import { title } from "$lib/store/title";

	const session = useSession();

	// Redirect if already logged in
	$effect(() => {
		if (!$session.isPending && $session.data?.user) {
			goto(resolve("/"));
		}
	});

	onMount(() => title.set("Sign In"));

	let email = $state("");
	let password = $state("");
	let loading = $state(false);
	let showPassword = $state(false);

	const inputClass =
		"w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text)] placeholder-[var(--color-text-subtle)] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";

	async function handleSignIn(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		try {
			const { data, error } = await signIn.email({ email, password });
			if (error) {
				toast.error(error.message ?? "Invalid credentials. Please try again.");
				return;
			}
			// In production, block unverified accounts from accessing the dashboard
			if (!(data?.user?.emailVerified || dev)) {
				goto(resolve("/auth/sign-up/confirm"));
				return;
			}
			goto(resolve("/"));
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
        <span class="text-text">Local</span><span class="text-accent">Run</span
        >
      </a>
      <p class="text-text-muted mt-1 text-sm">
        Deploy containers to your own server.
      </p>
    </div>

    <div class="w-full max-w-md">
      <!-- Header -->
      <div class="mb-8">
        <h2 class="text-text text-2xl font-bold">Welcome back</h2>
        <p class="text-text-muted mt-1 text-sm">
          Sign in to manage your services.
        </p>
      </div>

      <form onsubmit={handleSignIn} class="space-y-5" novalidate>
        <!-- Email -->
        <div>
          <label for="email" class="text-text mb-1.5 block text-sm font-medium">
            Email
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
          <div class="mb-1.5 flex items-center justify-between">
            <label for="password" class="text-text text-sm font-medium">
              Password
            </label>
          </div>
          <div class="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              bind:value={password}
              placeholder="••••••••••••"
              autocomplete="current-password"
              required
              disabled={loading}
              class="{inputClass} pr-12"
            />
            <button
              type="button"
              onclick={() => (showPassword = !showPassword)}
              class="text-text-muted hover:text-text absolute top-1/2 right-3.5 -translate-y-1/2 transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {#if showPassword}
                <EyeOff class="size-4" />
              {:else}
                <Eye class="size-4" />
              {/if}
            </button>
          </div>
        </div>

        <!-- Submit -->
        <button
          type="submit"
          disabled={loading || !email || !password}
          class="bg-accent shadow-accent/30 hover:bg-accent-dark mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {#if loading}
            <Loader2 class="size-4 animate-spin" />
            Signing in…
          {:else}
            Sign in
            <span class="opacity-70">→</span>
          {/if}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-[var(--color-text-muted)]">
        Don't have an account?
        <a
          href={resolve("/auth/sign-up")}
          class="text-accent font-medium hover:underline"
        >
          Create one free
        </a>
      </p>
    </div>
  </div>
</div>
