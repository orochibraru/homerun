<script lang="ts">
	import { resolve } from "$app/paths";
	import CheckBox from "$lib/components/check-box.svelte";
	import CopyBox from "$lib/components/copy-box.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import type { PushWebhookDetails } from "$lib/services/git-webhook.service";

	interface Props {
		autoDeployOnPush: boolean;
		gitPollEnabled: boolean;
		gitRef: string;
		labelClass: string;
		previewOf: { id: string; name: string } | null;
		pushWebhook: PushWebhookDetails | null;
		serviceId: string;
	}

	let {
		autoDeployOnPush,
		gitPollEnabled = $bindable(),
		gitRef,
		labelClass,
		previewOf,
		pushWebhook,
		serviceId,
	}: Props = $props();

	const reconnectHref = $derived(
		pushWebhook?.reconnect
			? `/api/v1/git-providers/${pushWebhook.reconnect.providerId}/connect?${new URLSearchParams({ returnTo: `/services/${serviceId}/source` })}`
			: null,
	);
</script>

{#if pushWebhook}
  <div class="border-border space-y-3 rounded-md border p-4">
    {#if pushWebhook.registered}
      <p class="text-sm text-emerald-600">
        Webhook registered on {pushWebhook.providerName ?? "the provider"}.
        Pushes to {gitRef} deploy this service.
      </p>
    {:else}
      {#if pushWebhook.error}
        <p class="text-xs text-amber-600">{pushWebhook.error}</p>
      {/if}
      {#if pushWebhook.reconnect && reconnectHref}
        <div class="flex flex-wrap items-center gap-3">
          <p class="text-text-muted flex-1 text-xs">
            The connection to {pushWebhook.reconnect.providerName}
            doesn't allow adding webhooks. Reconnect it to grant webhook
            access, and Homerun registers the webhook right after.
          </p>
          <Button data-sveltekit-reload href={reconnectHref} size="sm">
            Reconnect {pushWebhook.reconnect.providerName}
          </Button>
        </div>
      {/if}
      {#if pushWebhook.polling}
        <p class="text-text-muted text-xs">
          Until the webhook is in place, Homerun checks {gitRef} for new
          commits every two minutes and deploys when it moves.
        </p>
      {/if}
      <p class="text-text-muted text-xs">
        Add a webhook in the repository's settings with this URL and
        secret, sending push events as JSON. GitLab calls the secret a
        "secret token".
      </p>
      {#if pushWebhook.url}
        <div>
          <p class={labelClass}>Payload URL</p>
          <CopyBox label="webhook URL" value={pushWebhook.url} />
        </div>
      {/if}
      <div>
        <p class={labelClass}>Secret</p>
        <CopyBox label="webhook secret" value={pushWebhook.secret} />
      </div>
    {/if}
  </div>
{/if}
{#if autoDeployOnPush}
  <CheckBox
    helperText="Also check the branch for new commits every two minutes, for a dashboard the provider can't reach. Homerun already does this whenever it couldn't register the webhook."
    id="gitPollEnabled"
    label="Poll the branch for pushes"
    name="gitPollEnabled"
    bind:checked={gitPollEnabled}
  />
{/if}
{#if previewOf}
  <p class="text-text-muted text-xs">
    This service is a pull request preview of
    <a
      class="text-accent underline"
      href={resolve("/(protected)/services/[serviceId]/previews", {
        serviceId: previewOf.id,
      })}
    >
      {previewOf.name}
    </a>. It follows the pull request and is removed when it closes.
  </p>
{:else}
  <p class="text-text-muted text-xs">
    Pull request previews are on the
    <a
      class="text-accent underline"
      href={resolve("/(protected)/services/[serviceId]/previews", {
        serviceId,
      })}
    >
      Previews
    </a>
    tab.
  </p>
{/if}
