<script lang="ts">
	import { Eye, EyeOff, Server } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { dev } from "$app/environment";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { signIn, useSession } from "$lib/auth-client";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";

	let email = $state("");
	let password = $state("");
	let loading = $state(false);
	let showPassword = $state(false);

	const session = useSession();

	// Redirect if already logged in
	$effect(() => {
		if (!$session.isPending && $session.data?.user) {
			loading = true;
			goto(resolve("/"));
		}
	});

	onMount(() => title.set("Sign In"));

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
			loading = false;
		}
	}
</script>

<div class="flex min-h-[calc(100vh-4rem)]">
  <!-- ── Right panel ──────────────────────────────────────────────── -->
  <div class="flex flex-1 flex-col items-center justify-center bg-bg px-6 py-10 sm:px-10">
    <!-- Mobile-only logo -->
    <div class="mb-8 text-center lg:hidden">
      <a
        class="inline-flex items-center gap-1.5 text-xl font-bold"
        href={resolve("/")}
      >
        <Server class="text-accent size-5" />
        <span class="text-text">Local</span><span class="text-accent">Run</span>
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

      <form class="space-y-5" novalidate onsubmit={handleSignIn}>
        <!-- Email -->
        <div>
          <label class="text-text mb-1.5 block text-sm font-medium" for="email">
            Email
          </label>
          <Input
            autocomplete="email"
            disabled={loading}
            id="email"
            placeholder="you@example.com"
            required
            type="email"
            bind:value={email}
          />
        </div>

        <!-- Password -->
        <div>
          <div class="mb-1.5 flex items-center justify-between">
            <label class="text-text text-sm font-medium" for="password">
              Password
            </label>
          </div>
          <div class="relative">
            <Input
              autocomplete="current-password"
              class="pr-12"
              disabled={loading}
              id="password"
              placeholder="••••••••••••"
              required
              type={showPassword ? "text" : "password"}
              bind:value={password}
            />
            <Button
              aria-label={showPassword ? "Hide password" : "Show password"}
              class="absolute top-1/2 right-1.5 -translate-y-1/2"
              onclick={() => {
                showPassword = !showPassword;
              }}
              size="icon-sm"
              variant="ghost"
            >
              {#if showPassword}
                <EyeOff class="size-4" />
              {:else}
                <Eye class="size-4" />
              {/if}
            </Button>
          </div>
        </div>

        <!-- Submit -->
        <Button
          class="mt-2 w-full"
          disabled={loading || !email || !password}
          type="submit"
        >
          {#if loading}
            <Spinner />
            Signing in…
          {:else}
            Sign in
            <span class="opacity-70">→</span>
          {/if}
        </Button>
      </form>

      <p class="mt-6 text-center text-sm text-text-muted">
        Don't have an account?
        <a
          class="text-accent font-medium hover:underline"
          href={resolve("/auth/sign-up")}
        >
          Create one free
        </a>
      </p>
    </div>
  </div>
</div>
