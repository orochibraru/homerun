<script lang="ts">
	import { Bird, Check, GitBranch, Rocket, Tag } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import CheckBox from "$lib/components/check-box.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();
	const svc = $derived(data.service);
	const channels = $derived(data.channels);

	onMount(() => title.set(`${svc.name} · Channels`));

	const label = "block mb-1.5 text-sm font-medium text-text";

	const values = $derived(
		(form && "values" in form
			? (form.values as Record<string, string>)
			: undefined) ?? {
			channelBranch: channels.branch ?? svc.gitRef ?? "main",
			channelCanaryDomain: channels.canaryDomain ?? "",
			channelTagPattern: channels.tagPattern,
			channelsEnabled: channels.enabled ? "on" : "",
		},
	);

	let channelsEnabled = $derived(values.channelsEnabled === "on");
	let submitting = $state(false);
	let deploying = $state<string | null>(null);
</script>

{#if svc.previewParentId}
  <EmptyState
    icon={Bird}
    subtitle="Release channels are managed on the service this one belongs to."
    title="This service is a preview or a canary"
  >
    <Button
      href={resolve("/(protected)/services/[serviceId]/channels", {
        serviceId: svc.previewParentId,
      })}
      variant="outline"
    >
      Open the parent's channels
    </Button>
  </EmptyState>
{:else if svc.buildSource !== "git"}
  <EmptyState
    icon={Bird}
    subtitle="Release channels deploy branches and tags of a repository. Switch the source to a git repo first."
    title="Release channels need a service built from git"
  />
{:else}
  <div class="space-y-6">
    <section class="panel rounded-md">
      <PanelHeader
        description="Turn this service into the stable environment of a canary / stable pair: every push to the canary branch deploys a companion canary service, and every pushed tag matching the pattern deploys this service at that tag. Off by default; turning it off deletes the canary."
        icon={Bird}
        title="Release channels"
      />
      <form
        action="?/updateChannels"
        class="space-y-5 p-5"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't save the release channels.",
          loading: "Saving release channels",
          onSettled: () => {
            submitting = false;
          },
          onStart: () => {
            submitting = true;
          },
          success: "Saved.",
        })}
      >
        {#if form && "error" in form && form.error}
          <Alert>{form.error}</Alert>
        {/if}

        <CheckBox
          helperText={`The canary is a service named ${svc.slug}-canary, mirroring this one's build, env vars and resources.`}
          id="channelsEnabled"
          label="Enable release channels"
          name="channelsEnabled"
          bind:checked={channelsEnabled}
        />

        <div class="grid gap-5 transition-opacity md:grid-cols-3 {channelsEnabled ? '' : 'opacity-50'}">
          <div>
            <label class={label} for="channelBranch">Canary branch</label>
            <Input id="channelBranch" name="channelBranch" type="text" value={values.channelBranch} />
            <p class="text-text-subtle mt-1.5 text-xs">Every push to it deploys the canary.</p>
          </div>
          <div>
            <label class={label} for="channelTagPattern">Stable tag pattern</label>
            <Input id="channelTagPattern" name="channelTagPattern" placeholder="v*" type="text" value={values.channelTagPattern} />
            <p class="text-text-subtle mt-1.5 text-xs">
              A glob: <code>*</code> matches anything, <code>?</code> one
              character. A pushed tag that matches deploys this service at it.
            </p>
          </div>
          <div>
            <label class={label} for="channelCanaryDomain">Canary domain</label>
            <Input
              id="channelCanaryDomain"
              name="channelCanaryDomain"
              placeholder="canary.example.com"
              type="text"
              value={values.channelCanaryDomain}
            />
            <p class="text-text-subtle mt-1.5 text-xs">
              Optional. Without one the canary answers at
              {data.defaultCanaryHostname}.
            </p>
          </div>
        </div>

        {#if data.pushWebhook}
          <p class="text-xs {data.pushWebhook.registered ? 'text-emerald-600' : 'text-amber-600'}">
            {#if data.pushWebhook.registered}
              Webhook registered on {data.pushWebhook.providerName ??
                "the provider"}.
            {:else}
              The webhook isn't registered, so pushes and tags only reach
              Homerun if you add it by hand (the canary branch is still polled).
              Its URL and secret are on the
              <a
                class="underline"
                href={resolve("/(protected)/services/[serviceId]/source", {
                  serviceId: svc.id,
                })}
              >
                Source
              </a>
              tab.
            {/if}
          </p>
        {/if}

        <div class="flex justify-end">
          <Button disabled={submitting} type="submit">
            {#if submitting}
              <Spinner />
              Saving…
            {:else}
              <Check class="size-4" />
              Save
            {/if}
          </Button>
        </div>
      </form>
    </section>

    {#if channels.enabled}
      <section class="panel rounded-md">
        <PanelHeader
          description="Deploy either environment by hand, e.g. to rebuild after changing env vars on this service."
          icon={Rocket}
          title="Environments"
        />
        <ul class="divide-border divide-y">
          {#each [{ environment: "stable", icon: Tag, name: svc.name, ref: channels.stableRef, status: svc.currentStatus }, { environment: "canary", icon: GitBranch, name: channels.canary?.name ?? `${svc.name} (canary)`, ref: channels.canary?.gitRef ?? channels.branch, status: channels.canary?.status ?? null }] as env (env.environment)}
            <li class="flex flex-wrap items-center gap-3 px-5 py-3">
              <env.icon class="text-text-subtle size-4 shrink-0" />
              <div class="min-w-0 flex-1">
                <p class="text-text text-sm font-medium capitalize">{env.environment}</p>
                <p class="text-text-muted truncate font-mono text-xs">{env.ref ?? "—"}</p>
              </div>
              {#if env.environment === "canary" && channels.canary}
                <a
                  class="text-text-muted hover:text-accent text-xs"
                  href={resolve("/(protected)/services/[serviceId]", {
                    serviceId: channels.canary.id,
                  })}
                >
                  {channels.canary.hostname ?? channels.canary.slug}
                </a>
              {/if}
              {#if env.status}
                <StatusBadge status={env.status} />
              {/if}
              <form
                action="?/deploy"
                method="POST"
                use:enhance={enhanceToast({
                  error: `Couldn't deploy ${env.environment}.`,
                  loading: `Queueing a ${env.environment} deploy`,
                  onSettled: () => {
                    deploying = null;
                  },
                  onStart: () => {
                    deploying = env.environment;
                  },
                  success: `${env.environment === "canary" ? "Canary" : "Stable"} deploy queued.`,
                })}
              >
                <input name="environment" type="hidden" value={env.environment} />
                <Button disabled={deploying !== null} size="sm" type="submit" variant="outline">
                  {#if deploying === env.environment}
                    <Spinner />
                  {:else}
                    <Rocket class="size-3.5" />
                  {/if}
                  Deploy
                </Button>
              </form>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
{/if}
