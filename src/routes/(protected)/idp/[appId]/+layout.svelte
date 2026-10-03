<script lang="ts">
	import {
		AppWindow,
		Layers,
		LayoutDashboard,
		Settings,
		Users,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import CopyButton from "#lib/components/copy-button.svelte";
	import OauthAppToggle from "#lib/components/oauth-app-toggle.svelte";
	import TabNav, { type NavTab } from "#lib/components/tab-nav.svelte";
	import { timeAgo } from "#lib/formatting.js";
	import { title } from "#lib/store/title.js";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";

	const { data, children } = $props();
	const app = $derived(data.app);

	onMount(() => title.set(app.name));

	const tabs = $derived<(NavTab & { href: string })[]>([
		{
			href: resolve("/(protected)/idp/[appId]", { appId: app.id }),
			icon: LayoutDashboard,
			id: "overview",
			label: "Overview",
		},
		{
			href: resolve("/(protected)/idp/[appId]/environments", {
				appId: app.id,
			}),
			icon: Layers,
			id: "environments",
			label: `Environments (${data.environmentCount})`,
		},
		{
			href: resolve("/(protected)/idp/[appId]/users", { appId: app.id }),
			icon: Users,
			id: "users",
			label: `Users (${data.activity.users})`,
		},
		{
			href: resolve("/(protected)/idp/[appId]/settings", { appId: app.id }),
			icon: Settings,
			id: "settings",
			label: "Settings",
		},
	]);

	const activeTabId = $derived(
		tabs.findLast((tab) => page.url.pathname.startsWith(tab.href))?.id ?? "",
	);
</script>

<div class="p-5 md:p-6">
  <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
    <div class="flex min-w-0 items-center gap-3">
      <span
        class="flex size-10 shrink-0 items-center justify-center rounded-lg {app.disabled
          ? 'bg-surface-3 text-text-subtle'
          : 'bg-accent/10 text-accent'}"
      >
        <AppWindow class="size-5" />
      </span>
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-text truncate text-lg font-semibold tracking-tight">
            {app.name}
          </h1>
          <span
            class="rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium {app.disabled
              ? 'bg-surface-3 text-text-subtle'
              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}"
          >
            {app.disabled ? "Off" : "Active"}
          </span>
        </div>
        <p class="text-text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span>{app.confidential ? "Confidential" : "Public"} client</span>
          <span aria-hidden="true">·</span>
          <span class="inline-flex items-center gap-0.5 font-mono">
            {app.clientId}
            <CopyButton class="p-0.5" label="client ID" value={app.clientId} />
          </span>
          <span aria-hidden="true">·</span>
          {#if data.activity.lastUsedAt}
            <span title={new Date(data.activity.lastUsedAt).toLocaleString()}>
              last used {timeAgo(data.activity.lastUsedAt)}
            </span>
          {:else}
            <span class="text-text-subtle">never used</span>
          {/if}
        </p>
      </div>
    </div>
    <OauthAppToggle {app} showLabel />
  </div>

  <TabNav active={activeTabId} {tabs} />

  {@render children()}
</div>
