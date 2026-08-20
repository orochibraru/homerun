<script lang="ts">
  import { Eye, EyeOff, Server } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import Spinner from "$lib/components/ui/spinner/spinner.svelte";
  import { title } from "$lib/store/title";

  const { data, form } = $props();

  onMount(() => title.set("Accept Invite"));

  let name = $state("");
  let password = $state("");
  let confirm = $state("");
  let showPassword = $state(false);
  let submitting = $state(false);

  const inputClass =
    "w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text placeholder-[var(--color-text-subtle)] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";
</script>

<div class="flex min-h-[calc(100vh-4rem)]">
  <div
    class="flex flex-1 flex-col items-center justify-center bg-bg px-6 py-10 sm:px-10"
  >
    <div class="mb-8 text-center">
      <a
        class="inline-flex items-center gap-1.5 text-xl font-bold"
        href={resolve("/")}
      >
        <Server class="text-accent size-5" />
        <span class="text-text">Local</span><span class="text-accent">Run</span>
      </a>
    </div>

    <div class="w-full max-w-md">
      {#if data.invalid}
        <div class="text-center">
          <h2 class="text-2xl font-bold text-text">Invite not found</h2>
          <p class="mt-2 text-sm text-text-muted">
            This invite link is invalid, expired, or has already been used. Ask
            whoever invited you for a new one.
          </p>
          <a
            class="text-accent mt-6 inline-block text-sm font-medium hover:underline"
            href={resolve("/auth/sign-in")}
          >
            Back to sign in
          </a>
        </div>
      {:else}
        <div class="mb-8">
          <h2 class="text-2xl font-bold text-text">Set up your account</h2>
          <p class="mt-1 text-sm text-text-muted">
            Invited as <strong>{data.email}</strong> ({data.role}).
          </p>
        </div>

        {#if form?.error}
          <p class="mb-4 text-sm text-red-500">{form.error}</p>
        {/if}

        <form
          action="?/accept"
          class="space-y-5"
          method="POST"
          use:enhance={() => {
            submitting = true;
            return async ({ update }) => {
              submitting = false;
              await update();
            };
          }}
        >
          <div>
            <label
              class="mb-1.5 block text-sm font-medium text-text"
              for="name"
            >
              Full name <span class="text-red-500">*</span>
            </label>
            <input
              autocomplete="name"
              class={inputClass}
              disabled={submitting}
              id="name"
              name="name"
              required
              type="text"
              bind:value={name}
            >
          </div>

          <div>
            <label
              class="mb-1.5 block text-sm font-medium text-text"
              for="password"
            >
              Password <span class="text-red-500">*</span>
            </label>
            <div class="relative">
              <input
                autocomplete="new-password"
                class="{inputClass} pr-12"
                disabled={submitting}
                id="password"
                name="password"
                placeholder="Min. 12 characters"
                required
                type={showPassword ? "text" : "password"}
                bind:value={password}
              >
              <button
                aria-label={showPassword ? "Hide password" : "Show password"}
                class="absolute top-1/2 right-3.5 -translate-y-1/2 text-text-muted transition-colors hover:text-text"
                onclick={() => {
                  showPassword = !showPassword;
                }}
                type="button"
              >
                {#if showPassword}
                  <EyeOff class="size-4" />
                {:else}
                  <Eye class="size-4" />
                {/if}
              </button>
            </div>
          </div>

          <div>
            <label
              class="mb-1.5 block text-sm font-medium text-text"
              for="confirm"
            >
              Confirm password <span class="text-red-500">*</span>
            </label>
            <input
              autocomplete="new-password"
              class={inputClass}
              disabled={submitting}
              id="confirm"
              name="confirm"
              required
              type={showPassword ? "text" : "password"}
              bind:value={confirm}
            >
            {#if confirm && confirm !== password}
              <p class="mt-1 text-xs text-red-500">Passwords don't match.</p>
            {/if}
          </div>

          <button
            class="bg-accent shadow-accent/30 hover:bg-accent-dark mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting ||
              !name ||
              password.length < 12 ||
              password !== confirm}
            type="submit"
          >
            {#if submitting}
              <Spinner />
              Creating account…
            {:else}
              Create account
            {/if}
          </button>
        </form>
      {/if}
    </div>
  </div>
</div>
