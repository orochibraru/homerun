<script lang="ts">
	import { Lock, Mail } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import PasswordField from "$lib/components/password-field.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		email: string;
		emailEnabled: boolean;
	}

	const { email, emailEnabled }: Props = $props();

	const MIN_LENGTH = 12;

	let codeSent = $state(false);
	let sending = $state(false);
	let saving = $state(false);
	let code = $state("");
	let password = $state("");
	let confirm = $state("");

	const mismatch = $derived(confirm.length > 0 && confirm !== password);
	const ready = $derived(
		code.length === 6 && password.length >= MIN_LENGTH && password === confirm,
	);

	function onCodeInput(e: Event & { currentTarget: HTMLInputElement }) {
		code = e.currentTarget.value.replace(/\D/g, "").slice(0, 6);
		e.currentTarget.value = code;
	}
</script>

{#if !emailEnabled}
  <p class="text-text-muted text-sm">
    Your account signs in without a password. Adding one needs a code sent to
    your email, and email isn't set up on this instance yet: ask your admin.
  </p>
{:else}
  <div class="space-y-4">
    <p class="text-text-muted text-sm">
      Your account signs in without a password. Add one to sign in with it too;
      we'll email a code to <span class="text-text font-medium">{email}</span>
      first to check it's you.
    </p>
    <form
      action="?/sendPasswordCode"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't send a code.",
        loading: "Sending a code",
        onSettled: () => {
          sending = false;
        },
        onStart: () => {
          sending = true;
        },
        onSuccess: () => {
          codeSent = true;
        },
        success: `We emailed a code to ${email}.`,
      })}
    >
      <Button disabled={sending || saving} type="submit" variant="outline">
        {#if sending}
          <Spinner />
        {:else}
          <Mail class="size-4" />
        {/if}
        {codeSent ? "Send a new code" : "Email me a code"}
      </Button>
    </form>

    {#if codeSent}
      <form
        action="?/setPassword"
        class="space-y-4"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't set your password.",
          loading: "Setting your password",
          onFailure: () => {
            code = "";
          },
          onSettled: () => {
            saving = false;
          },
          onStart: () => {
            saving = true;
          },
          success: "Password set. You can sign in with it from now on.",
        })}
      >
        <div>
          <label class="text-text mb-1.5 block text-sm font-medium" for="passwordCode">
            Code from the email
          </label>
          <Input
            autocomplete="one-time-code"
            class="h-10 font-mono tracking-widest"
            disabled={saving}
            id="passwordCode"
            inputmode="numeric"
            name="code"
            oninput={onCodeInput}
            placeholder="123456"
            required
            value={code}
          />
        </div>
        <PasswordField
          autocomplete="new-password"
          disabled={saving}
          id="addPassword"
          label="New password"
          name="password"
          placeholder="Min. {MIN_LENGTH} characters"
          required
          bind:value={password}
        />
        <div>
          <PasswordField
            autocomplete="new-password"
            disabled={saving}
            id="addPasswordConfirm"
            label="Confirm new password"
            placeholder="Repeat new password"
            required
            bind:value={confirm}
          />
          {#if mismatch}
            <p class="mt-1 text-xs text-red-500">Passwords don't match.</p>
          {/if}
        </div>
        <div class="flex justify-end">
          <Button disabled={saving || !ready} type="submit">
            {#if saving}
              <Spinner />
              Saving…
            {:else}
              <Lock class="size-4" />
              Set password
            {/if}
          </Button>
        </div>
      </form>
    {/if}
  </div>
{/if}
