<script lang="ts">
	import {
		AppWindow,
		ChevronDown,
		Copy,
		FolderOpen,
		Plus,
		Settings as SettingsIcon,
		Users,
	} from "@lucide/svelte";
	import { onMount, type Snippet } from "svelte";
	import { toast } from "svelte-sonner";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import CopyBox from "$lib/components/copy-box.svelte";
	import CopyButton from "$lib/components/copy-button.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import EntityList, {
		type EntityRow,
	} from "$lib/components/entity-list.svelte";
	import { labelClass } from "$lib/components/form-styles";
	import OauthAppCredentials from "$lib/components/oauth-app-credentials.svelte";
	import OauthAppToggle from "$lib/components/oauth-app-toggle.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import { timeAgo } from "$lib/formatting";
	import { title } from "$lib/store/title";
	import { ViewMode } from "$lib/view-mode.svelte";

	const { data } = $props();

	type App = (typeof data.oauthApps)[number];

	onMount(() => title.set("IDP"));

	const view = new ViewMode("idp-apps", "card");
	let showEndpoints = $state(false);

	const byId = $derived(new Map(data.oauthApps.map((app) => [app.id, app])));

	function appHref(id: string): string {
		return resolve("/(protected)/idp/[appId]", { appId: id });
	}

	/** The distinct hosts an app sends people back to, for a one-line summary. */
	function hostsOf(app: App): string {
		const hosts = app.redirectUris.map((uri) => {
			try {
				return new URL(uri).host;
			} catch {
				return uri;
			}
		});
		return [...new Set(hosts)].join(", ");
	}

	/** Copies `value` to the clipboard, then says so. */
	async function copy(value: string, label: string) {
		try {
			await navigator.clipboard.writeText(value);
			toast.success(`Copied the ${label}.`);
		} catch {
			toast.error(`Couldn't copy the ${label}.`);
		}
	}
</script>

<div class="p-5 md:p-6">
  <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">IDP</h1>
      <p class="text-text-muted mt-1 text-sm">
        Homerun is an OpenID Connect provider: apps you host can sign people in
        with their Homerun account, passkeys and two-factor included, instead of
        their own logins.
      </p>
    </div>
    {#if data.issuer}
      <Button href={resolve("/idp/new")} size="sm">
        <Plus class="size-4" />
        Register app
      </Button>
    {/if}
  </div>

  {#if !data.issuer}
    <Alert variant="warning">
      Set the Dashboard URL under Settings → General to turn this on: it's the
      address Homerun signs tokens as.
    </Alert>
  {:else}
    <section class="panel mb-6 rounded-md p-5">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <p class={labelClass}>Issuer</p>
          <CopyBox label="issuer" truncate value={data.issuer} />
        </div>
        <div>
          <p class={labelClass}>Discovery URL</p>
          <CopyBox
            label="discovery URL"
            truncate
            value="{data.issuer}/.well-known/openid-configuration"
          />
        </div>
      </div>
      <button
        class="text-text-muted hover:text-text mt-3 inline-flex items-center gap-1 text-xs"
        aria-expanded={showEndpoints}
        onclick={() => {
          showEndpoints = !showEndpoints;
        }}
        type="button"
      >
        <ChevronDown class="size-3.5 transition-transform {showEndpoints ? 'rotate-180' : ''}" />
        {showEndpoints ? "Hide" : "Show"} every endpoint, for apps without discovery
      </button>
      {#if showEndpoints}
        <div class="border-border mt-4 border-t pt-4">
          <OauthAppCredentials clientId="<the app's client ID>" issuer={data.issuer} />
        </div>
      {/if}
    </section>

    {#if data.oauthApps.length === 0}
      <EmptyState
        icon={AppWindow}
        subtitle="Register an app to get its client ID and secret, then point it at the discovery URL above."
        title="No apps yet"
      >
        <Button href={resolve("/idp/new")}>
          <Plus class="size-4" />
          Register app
        </Button>
      </EmptyState>
    {:else}
      <div class="mb-3 flex items-center justify-between gap-3">
        <p class="text-text-muted text-xs">
          {data.oauthApps.length}
          {data.oauthApps.length === 1 ? "app" : "apps"} ·
          {data.oauthApps.filter((app) => !app.disabled).length} on
        </p>
        <ViewModeToggle {view} />
      </div>

      {#snippet wrapper(item: EntityRow, body: Snippet)}
        {@const app = byId.get(item.id)}
        <ContextMenu.Root>
          <ContextMenu.Trigger class="block h-full">
            {@render body()}
          </ContextMenu.Trigger>
          <ContextMenu.Content class="w-56">
            <ContextMenu.Item onSelect={() => goto(appHref(item.id))}>
              <FolderOpen class="size-4" />
              Open
            </ContextMenu.Item>
            {#if app}
              <ContextMenu.Item onSelect={() => copy(app.clientId, "client ID")}>
                <Copy class="size-4" />
                Copy client ID
              </ContextMenu.Item>
            {/if}
            <ContextMenu.Item
              onSelect={() =>
                goto(resolve("/(protected)/idp/[appId]/users", { appId: item.id }))}
            >
              <Users class="size-4" />
              Authorized users
            </ContextMenu.Item>
            <ContextMenu.Item
              onSelect={() =>
                goto(resolve("/(protected)/idp/[appId]/settings", { appId: item.id }))}
            >
              <SettingsIcon class="size-4" />
              Settings
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Root>
      {/snippet}

      {#snippet media(item: { id: string })}
        {@const app = byId.get(item.id)}
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-lg {app?.disabled
            ? 'bg-surface-3 text-text-subtle'
            : 'bg-accent/10 text-accent'}"
        >
          <AppWindow class="size-4" />
        </span>
      {/snippet}

      {#snippet badge(item: { id: string })}
        {@const app = byId.get(item.id)}
        {#if app}
          <span
            class="shrink-0 rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium {app.disabled
              ? 'bg-surface-3 text-text-subtle'
              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}"
          >
            {app.disabled ? "Off" : "Active"}
          </span>
        {/if}
      {/snippet}

      {#snippet meta(item: { id: string })}
        {@const app = byId.get(item.id)}
        {#if app}
          <span class="text-text-subtle flex items-center gap-1.5 text-xs">
            <Users class="size-3.5" />
            {app.users}
            {app.users === 1 ? "user" : "users"} ·
            {app.lastUsedAt ? `used ${timeAgo(app.lastUsedAt)}` : "never used"} ·
            {app.confidential ? "confidential" : "public"}
          </span>
        {/if}
      {/snippet}

      {#snippet actions(item: { id: string })}
        {@const app = byId.get(item.id)}
        {#if app}
          <span class="text-text-subtle inline-flex items-center gap-1 font-mono text-xs">
            <span class="max-w-40 truncate">{app.clientId}</span>
            <CopyButton label="client ID" value={app.clientId} />
          </span>
          <span class="ml-auto">
            <OauthAppToggle {app} />
          </span>
        {/if}
      {/snippet}

      <EntityList
        {actions}
        {badge}
        items={data.oauthApps.map((app) => ({
          description: hostsOf(app) ? `Signs in on ${hostsOf(app)}` : null,
          href: appHref(app.id),
          id: app.id,
          title: app.name,
        }))}
        {media}
        {meta}
        {view}
        {wrapper}
      />
    {/if}
  {/if}
</div>
