<script lang="ts">
  import { Eye, EyeOff, Server, ShieldCheck } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { signUp, useSession } from "$lib/auth-client";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import Spinner from "$lib/components/ui/spinner/spinner.svelte";
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

  const confirmClass = $derived.by(() => {
    if (!confirm) {
      return "";
    }
    return confirm === password
      ? "border-green-500 focus:ring-green-500"
      : "border-red-500 focus:ring-red-500";
  });

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
      const { error } = await signUp.email({ email, name, password });
      if (error) {
        toast.error(
          error.message ?? "Could not create account. Please try again."
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
  <!-- ── Right panel ──────────────────────────────────────────────── -->
  <div
    class="flex flex-1 flex-col items-center justify-center bg-bg px-6 py-10 sm:px-10"
  >
    <!-- Mobile-only logo -->
    <div class="mb-8 text-center lg:hidden">
      <a
        class="inline-flex items-center gap-1.5 text-xl font-bold"
        href={resolve("/")}
      >
        <Server class="text-accent size-5" />
        <span class="text-text">Local</span><span class="text-accent">Run</span>
      </a>
      <p class="mt-1 text-sm text-text-muted">
        Deploy containers to your own server.
      </p>
    </div>

    <div class="w-full max-w-md">
      <!-- Header -->
      <div class="mb-8">
        <h2 class="text-2xl font-bold text-text">Create your admin account</h2>
        <p class="mt-1 text-sm text-text-muted">
          This is the first account on this instance, so it becomes the admin.
          Additional accounts are created from the Users page afterward.
        </p>
      </div>

      <form class="space-y-5" novalidate onsubmit={handleSignUp}>
        <!-- Full name -->
        <div>
          <label class="mb-1.5 block text-sm font-medium text-text" for="name">
            Full name <span class="text-red-500">*</span>
          </label>
          <Input
            autocomplete="name"
            disabled={loading}
            id="name"
            placeholder="Jane Smith"
            required
            type="text"
            bind:value={name}
          />
        </div>

        <!-- Email -->
        <div>
          <label class="mb-1.5 block text-sm font-medium text-text" for="email">
            Email <span class="text-red-500">*</span>
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
          <label
            class="mb-1.5 block text-sm font-medium text-text"
            for="password"
          >
            Password <span class="text-red-500">*</span>
          </label>
          <div class="relative">
            <Input
              autocomplete="new-password"
              class="pr-12"
              disabled={loading}
              id="password"
              placeholder="Min. 12 characters"
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
              <p class="mt-1 text-xs text-text-muted">
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
            class="mb-1.5 block text-sm font-medium text-text"
            for="confirm"
          >
            Confirm password <span class="text-red-500">*</span>
          </label>
          <div class="relative">
            <Input
              autocomplete="new-password"
              class="pr-12 {confirmClass}"
              disabled={loading}
              id="confirm"
              placeholder="Repeat your password"
              required
              type={showConfirm ? "text" : "password"}
              bind:value={confirm}
            />
            <Button
              aria-label={showConfirm ? "Hide password" : "Show password"}
              class="absolute top-1/2 right-1.5 -translate-y-1/2"
              onclick={() => {
                showConfirm = !showConfirm;
              }}
              size="icon-sm"
              variant="ghost"
            >
              {#if showConfirm}
                <EyeOff class="size-4" />
              {:else}
                <Eye class="size-4" />
              {/if}
            </Button>
          </div>
          {#if confirm && confirm !== password}
            <p class="mt-1 text-xs text-red-500">Passwords don't match.</p>
          {:else if confirm && confirm === password}
            <p class="mt-1 flex items-center gap-1 text-xs text-green-500">
              <ShieldCheck class="size-3.5" />
              Passwords match
            </p>
          {/if}
        </div>

        <!-- Submit -->
        <Button
          class="mt-2 w-full"
          disabled={loading || !name || !email || !password || !confirm}
          type="submit"
        >
          {#if loading}
            <Spinner />
            Creating account…
          {:else}
            Create account
            <span class="opacity-70">→</span>
          {/if}
        </Button>
      </form>

      <p class="mt-6 text-center text-sm text-text-muted">
        Already have an account?
        <a
          class="text-accent font-medium hover:underline"
          href={resolve("/auth/sign-in")}
        >
          Sign in
        </a>
      </p>
    </div>
  </div>
</div>
