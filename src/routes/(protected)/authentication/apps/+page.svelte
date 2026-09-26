<script lang="ts">
	import { AppWindow, ExternalLink, Plus } from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import CopyBox from "$lib/components/copy-box.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { Button } from "$lib/components/ui/button/index.js";

	const { data } = $props();
</script>

<div class="space-y-6">
  <section class="panel rounded-md">
    <div class="border-border flex flex-col items-start gap-3 border-b px-5 py-4 sm:flex-row sm:justify-between sm:gap-4">
      <div>
        <h2 class="eyebrow">Sign in with Homerun</h2>
        <p class="text-text-muted text-xs">
          Homerun is also an OpenID Connect provider: apps you host can use these
          accounts, with the same passkey and two-factor rules, instead of their
          own logins or a separate identity server.
        </p>
      </div>
      {#if data.oidcDiscoveryUrl}
        <Button href={resolve("/authentication/apps/new")} size="sm">
          <Plus class="size-4" />
          Register app
        </Button>
      {/if}
    </div>

    {#if !data.oidcDiscoveryUrl}
      <p class="text-text-muted p-5 text-sm">
        Set the Dashboard URL under Settings → General to turn this on: it's the
        address Homerun signs tokens as.
      </p>
    {:else}
      <div class="border-border border-b px-5 py-4">
        <p class="text-text-muted mb-1.5 text-xs">Discovery URL</p>
        <CopyBox label="discovery URL" value={data.oidcDiscoveryUrl} />
      </div>
      {#if data.oauthApps.length === 0}
        <div class="p-5">
          <EmptyState
            icon={AppWindow}
            subtitle="Register an app to get its client ID and secret."
            title="No apps yet"
          />
        </div>
      {:else}
        <div class="divide-border divide-y">
          {#each data.oauthApps as app (app.id)}
            <a
              class="hover:bg-surface-2 flex items-center gap-3 px-5 py-3"
              href={resolve("/(protected)/authentication/apps/[appId]", { appId: app.id })}
            >
              <div
                class="flex size-8 shrink-0 items-center justify-center rounded-lg {app.disabled
                ? 'bg-surface-3 text-text-subtle'
                : 'bg-accent/10 text-accent'}"
              >
                <AppWindow class="size-4" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-x-2">
                  <span class="text-text text-sm font-semibold">{app.name}</span>
                  <span class="text-text-subtle truncate font-mono text-xs">
                    {app.clientId}
                  </span>
                  {#if app.disabled}
                    <span
                      class="border-border text-text-subtle rounded-md border px-1.5 py-0.5 text-[0.6rem] tracking-wider uppercase"
                    >
                      disabled
                    </span>
                  {/if}
                </div>
                <p class="text-text-subtle mt-0.5 truncate text-xs">
                  {app.redirectUris.join(", ")}
                </p>
              </div>
              <ExternalLink class="text-text-subtle size-3.5 shrink-0" />
            </a>
          {/each}
        </div>
      {/if}
    {/if}
  </section>
</div>
