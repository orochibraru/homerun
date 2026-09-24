<script lang="ts">
	import { ArrowRight } from "@lucide/svelte";
	import type { Snippet } from "svelte";
	import { toast } from "svelte-sonner";
	import { signIn } from "$lib/auth-client";
	import PasswordField from "$lib/components/password-field.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import {
		completeAccountSetup,
		resendSetupCode,
	} from "$lib/remote/sign-in.remote";
	import { toastError } from "$lib/toast";

	interface Props {
		email: string;
		emailed: boolean;
		loading: boolean;
		onSignedIn: () => Promise<void>;
		successMessage?: string;
		summary: Snippet;
	}

	let {
		email,
		emailed,
		loading = $bindable(),
		onSignedIn,
		successMessage,
		summary,
	}: Props = $props();

	let setupCode = $state("");
	let newPassword = $state("");
	let confirmPassword = $state("");

	async function setupCallback(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		try {
			if (newPassword !== confirmPassword) {
				throw new Error("The two passwords don't match.");
			}
			await completeAccountSetup({
				code: emailed ? setupCode.trim() : null,
				email,
				password: newPassword,
			});
			const { error } = await signIn.email({ email, password: newPassword });
			if (error) {
				throw new Error(error.message ?? "Couldn't sign you in.");
			}
			newPassword = "";
			confirmPassword = "";
			await onSignedIn();
		} catch (err) {
			loading = false;
			newPassword = "";
			confirmPassword = "";
			throw err;
		}
	}

	function handleSetup(e: SubmitEvent) {
		return toast.promise(setupCallback(e), {
			error: (err) => toastError(err, "Couldn't set up your account."),
			loading: "Setting up your account",
			...(successMessage ? { success: successMessage } : {}),
		});
	}

	async function resendCallback() {
		loading = true;
		try {
			await resendSetupCode(email);
		} finally {
			loading = false;
		}
	}

	function handleResend() {
		return toast.promise(resendCallback(), {
			error: (err) => toastError(err, "Couldn't send a new code."),
			loading: "Sending a new code",
			success: `We emailed a new code to ${email}.`,
		});
	}
</script>

<form class="space-y-4" novalidate onsubmit={handleSetup}>
  {@render summary()}
  <p class="text-text-muted text-sm">
    {#if emailed}
      Enter the 6-digit code we emailed you, then choose your password.
    {:else}
      Your account is new: choose your password.
    {/if}
  </p>
  {#if emailed}
    <div>
      <label class="text-text mb-1.5 block text-sm font-medium" for="setupCode">
        Verification code
      </label>
      <Input
        autocomplete="one-time-code"
        class="h-10 font-mono tracking-widest"
        disabled={loading}
        id="setupCode"
        inputmode="numeric"
        placeholder="123456"
        required
        bind:value={setupCode}
      />
    </div>
  {/if}
  <PasswordField
    autocomplete="new-password"
    disabled={loading}
    id="newPassword"
    label="New password"
    bind:value={newPassword}
  />
  <PasswordField
    autocomplete="new-password"
    disabled={loading}
    id="confirmPassword"
    label="Confirm password"
    bind:value={confirmPassword}
  />
  <p class="text-text-subtle text-xs">At least 12 characters.</p>
  <Button
    class="h-10 w-full"
    disabled={loading ||
      !newPassword ||
      !confirmPassword ||
      (emailed && !setupCode.trim())}
    type="submit"
  >
    {#if loading}
      <Spinner />
      Setting up…
    {:else}
      Set password and sign in
      <ArrowRight class="size-4 opacity-70" />
    {/if}
  </Button>
  {#if emailed}
    <div class="text-center">
      <button
        class="text-text-muted hover:text-text text-xs underline-offset-4 hover:underline"
        disabled={loading}
        onclick={handleResend}
        type="button"
      >
        Send a new code
      </button>
    </div>
  {/if}
</form>
