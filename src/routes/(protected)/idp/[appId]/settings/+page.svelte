<script lang="ts">
	import {
		AlertTriangle,
		KeyRound,
		SlidersHorizontal,
		Trash2,
	} from "@lucide/svelte";
	import { untrack } from "svelte";
	import { enhance } from "$app/forms";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import CopyBox from "$lib/components/copy-box.svelte";
	import OauthAppFields, {
		type OauthAppFieldValues,
	} from "$lib/components/oauth-app-fields.svelte";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
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
</script>

<div class="space-y-6">
  {#if newSecret}
    <section class="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-5">
      <p class="text-text text-sm font-medium">New client secret</p>
      <p class="text-text-muted mt-0.5 mb-3 text-xs">
        Shown once: paste it into {data.app.name} now, Homerun only keeps a hash.
        The old one already stopped working.
      </p>
      <CopyBox label="client secret" value={newSecret} />
    </section>
  {/if}

  <section class="panel rounded-md">
    <PanelHeader
      description="The name on the consent screen, where people are sent back to, and how sign-in behaves."
      icon={SlidersHorizontal}
      title="App settings"
    />
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
      >
      <OauthAppFields typeLocked {values} />

      <div class="flex justify-end">
        <Button disabled={submitting} type="submit">
          {#if submitting}
            <Spinner />
          {/if}
          Save
        </Button>
      </div>
    </form>
  </section>

  <section class="rounded-md border border-red-300/60 dark:border-red-900/50">
    <div class="flex items-center gap-3 border-b border-red-300/40 px-5 py-4 dark:border-red-900/40">
      <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-600">
        <AlertTriangle class="size-4" />
      </span>
      <div>
        <h2 class="text-sm font-semibold text-red-600 dark:text-red-400">
          Danger zone
        </h2>
        <p class="text-text-muted text-xs">
          Rotating the secret breaks the app until it has the new one. Deleting
          it also revokes every token it holds.
        </p>
      </div>
    </div>
    <div class="flex flex-wrap gap-2 p-5">
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
          method="POST"
          bind:this={rotateForm}
          use:enhance={enhanceToast({
            error: "Couldn't rotate the secret.",
            loading: "Rotating the secret",
            success: "New secret issued. Copy it from the top of this page.",
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
        method="POST"
        bind:this={deleteForm}
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
  confirmLabel="Rotate secret"
  description="The current secret stops working immediately, so the app can't sign anyone in until you paste the new one into it."
  onConfirm={() => rotateForm?.requestSubmit()}
  title="Rotate the secret for {data.app.name}?"
  bind:open={confirmingRotate}
/>

<ConfirmDialog
  confirmLabel="Delete app"
  confirmPhrase={data.app.name}
  description="Everyone signed in to it through Homerun loses access, and it can't start new sign-ins."
  onConfirm={() => deleteForm?.requestSubmit()}
  title="Delete {data.app.name}?"
  bind:open={confirmingDelete}
/>
