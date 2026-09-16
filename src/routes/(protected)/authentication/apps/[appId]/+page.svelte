<script lang="ts">
	import { ArrowLeft, KeyRound, Power, Trash2 } from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import OauthAppCredentials from "$lib/components/oauth-app-credentials.svelte";
	import OauthAppFields, {
		type OauthAppFieldValues,
	} from "$lib/components/oauth-app-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	let submitting = $state(false);
	let confirmingDelete = $state(false);
	let confirmingRotate = $state(false);
	let deleteForm = $state<HTMLFormElement | undefined>();
	let rotateForm = $state<HTMLFormElement | undefined>();

	const values = $state<OauthAppFieldValues>(
		untrack(() => ({
			confidential: data.app.confidential,
			enableEndSession: data.app.enableEndSession,
			name: data.app.name,
			redirectUris: data.app.redirectUris.join("\n"),
			requirePkce: data.app.requirePkce,
			skipConsent: data.app.skipConsent,
		})),
	);

	const newSecret = $derived(
		form && "clientSecret" in form ? form.clientSecret : null,
	);

	onMount(() => title.set(data.app.name));
</script>

<div class="space-y-6 p-6 md:p-8">
  <div>
    <Button href={resolve("/authentication")} size="sm" variant="ghost">
      <ArrowLeft class="size-4" />
      Authentication
    </Button>
    <div class="mt-2 flex flex-wrap items-center gap-2">
      <h1 class="text-text text-xl font-semibold">{data.app.name}</h1>
      {#if data.app.disabled}
        <span
          class="border-border text-text-subtle rounded-md border px-1.5 py-0.5 text-[0.6rem] tracking-wider uppercase"
        >
          disabled
        </span>
      {/if}
    </div>
    <p class="text-text-subtle mt-1 text-sm">
      {data.app.confidential ? "Confidential" : "Public"} app ·
      {data.app.requirePkce ? "PKCE required" : "PKCE optional"}
    </p>
  </div>

  {#if data.issuer}
    <section class="panel rounded-md">
      <div class="border-border border-b px-5 py-4">
        <h2 class="eyebrow">Connection details</h2>
        <p class="text-text-muted text-xs">
          What to paste into the app's OpenID Connect settings.
          {#if data.app.confidential}
            The client secret was shown once when the app was registered: rotate
            it below if it's lost.
          {/if}
        </p>
      </div>
      <div class="p-5">
        <OauthAppCredentials
          clientId={data.app.clientId}
          clientSecret={newSecret}
          issuer={data.issuer}
        />
      </div>
    </section>
  {:else}
    <Alert variant="warning">
      The Dashboard URL isn't set under Settings → General, so Homerun isn't
      acting as a provider right now and this app can't sign anyone in.
    </Alert>
  {/if}

  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Settings</h2>
    </div>
    <form
      action="?/update"
      class="space-y-5 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the app.",
        loading: "Saving the app",
        onSettled: () => {
          submitting = false;
        },
        onStart: () => {
          submitting = true;
        },
        success: "App saved.",
      })}
    >
      {#if form && "error" in form && form.error}
        <p class="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-500">
          {form.error}
        </p>
      {/if}

      <input
        name="clientType"
        type="hidden"
        value={data.app.confidential ? "confidential" : "public"}
      />
      <OauthAppFields typeLocked {values} />

      <div class="flex justify-end">
        <Button disabled={submitting} type="submit">Save</Button>
      </div>
    </form>
  </section>

  <section class="rounded-md border border-red-200 dark:border-red-900/40">
    <div class="border-b border-red-200 px-5 py-4 dark:border-red-900/40">
      <h2 class="eyebrow text-red-600 dark:text-red-400">Danger zone</h2>
      <p class="text-text-muted text-xs">
        Turning the app off stops new sign-ins through it. Rotating the secret
        breaks the app until it has the new one. Deleting it also revokes every
        token it holds.
      </p>
    </div>
    <div class="flex flex-wrap gap-2 p-5">
      <form
        action="?/toggle"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't change the app.",
          loading: data.app.disabled ? "Turning the app on" : "Turning the app off",
          success: (result) =>
            result?.disabled ? "App turned off." : "App turned on.",
        })}
      >
        <Button type="submit" variant="outline">
          <Power class="size-4" />
          {data.app.disabled ? "Turn on" : "Turn off"}
        </Button>
      </form>
      {#if data.app.confidential}
        <Button
          onclick={() => {
            confirmingRotate = true;
          }}
          variant="outline"
        >
          <KeyRound class="size-4" />
          Rotate secret
        </Button>
        <form
          action="?/rotate"
          bind:this={rotateForm}
          method="POST"
          use:enhance={enhanceToast({
            error: "Couldn't rotate the secret.",
            loading: "Rotating the secret",
            success: "New secret issued. Copy it from Connection details.",
          })}
        ></form>
      {/if}
      <Button
        class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
        onclick={() => {
          confirmingDelete = true;
        }}
        variant="outline"
      >
        <Trash2 class="size-4" />
        Delete app
      </Button>
      <form
        action="?/delete"
        bind:this={deleteForm}
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't delete the app.",
          loading: "Deleting the app",
          success: "App deleted.",
        })}
      ></form>
    </div>
  </section>
</div>

<ConfirmDialog
  bind:open={confirmingRotate}
  confirmLabel="Rotate secret"
  description="The current secret stops working immediately, so the app can't sign anyone in until you paste the new one into it."
  onConfirm={() => rotateForm?.requestSubmit()}
  title="Rotate the secret for {data.app.name}?"
/>

<ConfirmDialog
  bind:open={confirmingDelete}
  confirmLabel="Delete app"
  confirmPhrase={data.app.name}
  description="Everyone signed in to it through Homerun loses access, and it can't start new sign-ins."
  onConfirm={() => deleteForm?.requestSubmit()}
  title="Delete {data.app.name}?"
/>
