<script lang="ts">
	import {
		ArrowRight,
		KeyRound,
		Mail,
		MailX,
		TriangleAlert,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import AuthShell from "$lib/components/auth-shell.svelte";
	import PasswordField from "$lib/components/password-field.svelte";
	import PasswordStrength from "$lib/components/password-strength.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	onMount(() => title.set("Accept Invite"));

	let name = $state("");
	let password = $state("");
	let confirm = $state("");
	let submitting = $state(false);
	let withCodes = $state(false);
</script>

{#if data.invalid}
  <AuthShell
    eyebrow="Invitation"
    heading="Invite not found"
    subheading="This invite link is invalid, expired, or has already been used. Ask whoever invited you for a new one."
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
    eyebrow="Invitation"
    heading="Set up your account"
    subheading={data.codesAvailable
      ? "Pick a password, or sign in with codes we email you."
      : "Pick a password and you're in."}
  >
    <div
      class="mb-5 flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5"
    >
      <span class="text-text truncate text-xs">{data.email}</span>
      <span class="eyebrow shrink-0">{data.role}</span>
    </div>

    {#if form?.error}
      <p
        class="mb-4 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-500"
      >
        <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
        {form.error}
      </p>
    {/if}

    {#if data.codesAvailable}
      <div class="mb-5 grid grid-cols-2 gap-2" role="radiogroup">
        <Button
          aria-checked={!withCodes}
          disabled={submitting}
          onclick={() => {
            withCodes = false;
          }}
          role="radio"
          variant={withCodes ? "outline" : "default"}
        >
          <KeyRound class="size-4" />
          Set a password
        </Button>
        <Button
          aria-checked={withCodes}
          disabled={submitting}
          onclick={() => {
            withCodes = true;
          }}
          role="radio"
          variant={withCodes ? "default" : "outline"}
        >
          <Mail class="size-4" />
          Emailed codes
        </Button>
      </div>
    {/if}

    <form
      action={withCodes ? "?/acceptWithCodes" : "?/accept"}
      class="space-y-4"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't create your account.",
        loading: "Creating your account",
        onSettled: () => {
          submitting = false;
        },
        onStart: () => {
          submitting = true;
        },
        success: withCodes
          ? "Account created. We'll email you a code each time you sign in."
          : "Account created. Sign in to continue.",
      })}
    >
      <div>
        <label class="text-text mb-1.5 block text-sm font-medium" for="name">
          Full name
        </label>
        <Input
          autocomplete="name"
          class="h-10"
          disabled={submitting}
          id="name"
          name="name"
          placeholder="Jane Smith"
          required
          type="text"
          bind:value={name}
        />
      </div>

      {#if withCodes}
        <p class="text-text-muted text-sm">
          No password to remember: each time you sign in, enter your email and
          we'll send a one-time code to {data.email}.
        </p>
      {:else}
      <div>
        <PasswordField
          autocomplete="new-password"
          disabled={submitting}
          id="password"
          label="Password"
          name="password"
          placeholder="Min. 12 characters"
          required
          bind:value={password}
        />
        <PasswordStrength {password} />
      </div>

      <div>
        <PasswordField
          autocomplete="new-password"
          disabled={submitting}
          id="confirm"
          label="Confirm password"
          name="confirm"
          placeholder="Repeat your password"
          required
          bind:value={confirm}
        />
        {#if confirm && confirm !== password}
          <p class="mt-1.5 text-xs text-red-500">
            Passwords don't match.
          </p>
        {/if}
      </div>
      {/if}

      <Button
        class="mt-2 h-10 w-full"
        disabled={submitting
        || !name
        || (!withCodes && (password.length < 12 || password !== confirm))}
        type="submit"
      >
        {#if submitting}
          <Spinner />
          Creating account…
        {:else}
          Create account
          <ArrowRight class="size-4 opacity-70" />
        {/if}
      </Button>
    </form>
  </AuthShell>
{/if}
