<script lang="ts">
	import { resolve } from "$app/paths";
	import CheckBox from "$lib/components/check-box.svelte";
	import CopyBox from "$lib/components/copy-box.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import type { PushWebhookDetails } from "$lib/services/git-webhook.service";
	import type { PreviewSummary } from "$lib/services/preview.service";

	interface Props {
		autoDeployOnPush: boolean;
		gitPollEnabled: boolean;
		gitRef: string;
		labelClass: string;
		previewOf: { id: string; name: string } | null;
		previews: PreviewSummary[];
		previewsEnabled: boolean;
		pushWebhook: PushWebhookDetails | null;
		serviceId: string;
		serviceSlug: string;
	}

	let {
		autoDeployOnPush,
		gitPollEnabled = $bindable(),
		gitRef,
		labelClass,
		previewOf,
		previews,
		previewsEnabled = $bindable(),
		pushWebhook,
		serviceId,
		serviceSlug,
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
      href={resolve("/(protected)/services/[serviceId]/source", {
        serviceId: previewOf.id,
      })}
    >
      {previewOf.name}
    </a>. It follows the pull request and is removed when it closes.
  </p>
{:else}
  <CheckBox
    helperText={`Every pull request opened on the repo gets its own service at ${serviceSlug}-pr-<number>, built from the pull request's head, redeployed on every push to it and removed when it's closed or merged. Needs the webhook.`}
    id="previewsEnabled"
    label="Pull request previews"
    name="previewsEnabled"
    bind:checked={previewsEnabled}
  />
  {#if previews.length > 0}
    <div class="border-border divide-border divide-y rounded-md border">
      {#each previews as preview (preview.id)}
        <div class="flex flex-wrap items-center gap-3 px-4 py-3">
          <div class="min-w-0 flex-1">
            <a
              class="text-text text-sm font-medium hover:underline"
              href={resolve("/(protected)/services/[serviceId]", {
                serviceId: preview.id,
              })}
            >
              #{preview.prNumber} {preview.title ?? preview.name}
            </a>
            <p class="text-text-muted truncate text-xs">
              {preview.branch ?? preview.gitRef}
              {#if preview.hostname}
                · {preview.hostname}
              {/if}
            </p>
          </div>
          <StatusBadge status={preview.status} />
        </div>
      {/each}
    </div>
  {/if}
{/if}
