<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import CheckBox from "$lib/components/check-box.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { saveToast } from "$lib/toast";

	const { data } = $props();
</script>

<div class="space-y-6">
  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Built-in authentication</h2>
      <p class="text-text-muted text-xs">
        Homerun's own email and password accounts, managed on the Users page.
      </p>
    </div>
    <div class="space-y-2 p-5 text-sm">
      <p class="text-text-muted">
        Always available for signing in to the dashboard, and selectable per-app
        as the <span class="text-xs">password</span> method. Accounts
        are created by an admin
        {#if data.smtpEnabled}
          (direct-create or email invite).
        {:else}
          (direct-create : email invites need SMTP configured under Settings →
          Email).
        {/if}
      </p>
      <Button href={resolve("/users")} size="sm" variant="outline">
        Manage users
      </Button>
    </div>
  </section>

  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Preferred sign-in methods</h2>
      <p class="text-text-muted text-xs">
        Picking passkey prompts for one as soon as the sign-in page opens.
        Picking a single sign-on provider sends accounts linked to it straight
        there once they enter their email.
      </p>
    </div>
    <form
      class="space-y-3 p-5"
      action="?/preferredSignIn"
      method="POST"
      use:enhance={saveToast("Preferred sign-in methods")}
    >
      {#each data.signInMethods as option (option.method)}
        <CheckBox
          checked={data.preferredSignInMethods.includes(option.method)}
          helperText={option.helperText}
          id="preferred-{option.method}"
          label={option.label}
          name="preferred:{option.method}"
        />
      {/each}
      <div class="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>

  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Sign-in requirements</h2>
      <p class="text-text-muted text-xs">
        Applies to every account, admins included. Anyone who doesn't meet a
        requirement is sent to a setup page on their next visit and can't use
        the dashboard until they've enrolled. API keys and CLI tokens aren't
        affected.
      </p>
    </div>
    <form
      class="space-y-3 p-5"
      action="?/securityPolicy"
      method="POST"
      use:enhance={saveToast("Sign-in requirements")}
    >
      <CheckBox
        checked={data.securityPolicy.requireTwoFactor}
        helperText="Every account must set up an authenticator app. Signing in with a password then asks for a code."
        id="requireTwoFactor"
        label="Require two-factor authentication"
        name="requireTwoFactor"
      />
      <CheckBox
        checked={data.securityPolicy.requirePasskey}
        helperText="Every account must register at least one passkey."
        id="requirePasskey"
        label="Require a passkey"
        name="requirePasskey"
      />
      <div class="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>
</div>
