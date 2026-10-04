<script lang="ts">
	import { AlertTriangle, SlidersHorizontal, Trash2 } from "@lucide/svelte";
	import { untrack } from "svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import OauthAppFields, {
		type OauthAppFieldValues,
	} from "#lib/components/oauth-app-fields.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	const { data, form } = $props();

	let submitting = $state(false);
	let confirmingDelete = $state(false);
	let deleteForm = $state<HTMLFormElement | undefined>();

	const values = $state<OauthAppFieldValues>(
		untrack(() => ({
			confidential: data.app.confidential,
			enableEndSession: data.app.enableEndSession,
			name: data.app.name,
			requirePkce: data.app.requirePkce,
			skipConsent: data.app.skipConsent,
			tokenAuthMethod: data.app.tokenAuthMethod,
		})),
	);
</script>

<div class="space-y-6">
  <section class="panel rounded-md">
    <PanelHeader
      description="The name on the consent screen, where people are sent back to, and how sign-in behaves."
      icon={SlidersHorizontal}
      title="App settings"
    >
      {#snippet trailing()}
        <SaveButton form="idp-app-settings" pending={submitting} />
      {/snippet}
    </PanelHeader>
    <form
      id="idp-app-settings"
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
          Deleting the app revokes every token it holds. Secrets are managed
          per environment, under Environments.
        </p>
      </div>
    </div>
    <div class="flex flex-wrap gap-2 p-5">
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
  confirmLabel="Delete app"
  confirmPhrase={data.app.name}
  description="Everyone signed in to it through Homerun loses access, and it can't start new sign-ins."
  onConfirm={() => deleteForm?.requestSubmit()}
  title="Delete {data.app.name}?"
  bind:open={confirmingDelete}
/>
