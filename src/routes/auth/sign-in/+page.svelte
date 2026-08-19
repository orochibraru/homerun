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
      if (!data?.user?.emailVerified && !dev) {
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
    class="flex flex-col flex-1 justify-center items-center py-10 px-6 sm:px-10 bg-[var(--color-bg)]"
  >
    <!-- Mobile-only logo -->
    <div class="mb-8 text-center lg:hidden">
      <a
        href={resolve("/")}
        class="inline-flex gap-1.5 items-center text-xl font-bold"
      >
        <Server class="size-5 text-accent" />
        <span class="text-text">Local</span><span class="text-accent">Run</span
        >
      </a>
      <p class="mt-1 text-sm text-text-muted">
        Deploy containers to your own server.
      </p>
    </div>

    <div class="w-full max-w-md">
      <!-- Header -->
      <div class="mb-8">
        <h2 class="text-2xl font-bold text-text">Welcome back</h2>
        <p class="mt-1 text-sm text-text-muted">
          Sign in to manage your services.
        </p>
      </div>

      <form onsubmit={handleSignIn} class="space-y-5" novalidate>
        <!-- Email -->
        <div>
          <label for="email" class="block mb-1.5 text-sm font-medium text-text">
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
          <div class="flex justify-between items-center mb-1.5">
            <label for="password" class="text-sm font-medium text-text">
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
              class="absolute right-3.5 top-1/2 transition-colors -translate-y-1/2 text-text-muted hover:text-text"
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
          class="flex gap-2 justify-center items-center py-3 px-4 mt-2 w-full text-sm font-semibold text-white rounded-xl shadow-sm transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed bg-accent shadow-accent/30 hover:bg-accent-dark"
        >
          {#if loading}
            <Loader2 class="animate-spin size-4" />
            Signing in…
          {:else}
            Sign in
            <span class="opacity-70">→</span>
          {/if}
        </button>
      </form>

      <p class="mt-6 text-sm text-center text-[var(--color-text-muted)]">
        Don't have an account?
        <a
          href={resolve("/auth/sign-up")}
          class="font-medium hover:underline text-accent"
        >
          Create one free
        </a>
      </p>
    </div>
  </div>
</div>
