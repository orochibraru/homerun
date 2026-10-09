<script lang="ts">
	import {
		Database,
		FileCode2,
		GitCompareArrows,
		KeyRound,
		Settings,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import Alert from "#lib/components/alert.svelte";
	import ErrorBoundary from "#lib/components/error-boundary.svelte";
	import TabNav, { type NavTab } from "#lib/components/tab-nav.svelte";
	import { IAC_TOOL_INFO } from "#lib/iac/tools.js";
	import { title } from "#lib/store/title.js";
	import { currentHref } from "#lib/ui-mode.js";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";

	const { children, data } = $props();

	onMount(() => title.set(`Infrastructure as Code · ${data.project.name}`));

	interface RouteTab extends NavTab {
		href: string;
	}

	const scopeLabel = $derived(
		data.scopes.find((option) => option.value === data.project.scope)?.label ??
			null,
	);

	const tabs = $derived<RouteTab[]>([
		{
			href: resolve("/(protected)/iac/[projectId]", {
				projectId: data.project.id,
			}),
			icon: Database,
			id: "state",
			label: "State",
		},
		{
			href: resolve("/(protected)/iac/[projectId]/generate", {
				projectId: data.project.id,
			}),
			icon: FileCode2,
			id: "generate",
			label: "Generate",
		},
		{
			href: resolve("/(protected)/iac/[projectId]/drift", {
				projectId: data.project.id,
			}),
			icon: GitCompareArrows,
			id: "drift",
			label: "Drift",
		},
		{
			href: resolve("/(protected)/iac/[projectId]/credentials", {
				projectId: data.project.id,
			}),
			icon: KeyRound,
			id: "credentials",
			label: "Credentials",
		},
		{
			href: resolve("/(protected)/iac/[projectId]/settings", {
				projectId: data.project.id,
			}),
			icon: Settings,
			id: "settings",
			label: "Settings",
		},
	]);

	const activeTabId = $derived.by(() => {
		const href = currentHref(
			page.url.pathname,
			tabs.map((tab) => tab.href),
		);
		return tabs.find((tab) => tab.href === href)?.id ?? "state";
	});
</script>

<div class="p-5 md:p-6">
  <div class="mb-6 flex flex-wrap items-center gap-3">
    <div class="bg-accent/10 text-accent flex size-9 items-center justify-center rounded-lg">
      <FileCode2 class="size-5" />
    </div>
    <h1 class="text-text text-lg font-semibold tracking-tight">{data.project.name}</h1>
    <span class="bg-surface-2 text-text-muted rounded-full px-2 py-0.5 text-xs font-medium">
      {IAC_TOOL_INFO[data.project.tool].label}
    </span>
  </div>
  <p class="text-text-muted -mt-4 mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
    <span>{scopeLabel ? `Manages ${scopeLabel}` : "Manages nothing yet"}</span>
    <span aria-hidden="true">·</span>
    <span>
      State in <span class="font-mono">{data.project.bucket}{data.project.prefix ? `/${data.project.prefix}` : ""}</span>{data.store ? ` on ${data.store.name}` : ""}
    </span>
  </p>

  {#if data.bucket.problem}
    <div class="mb-5">
      <Alert variant="warning">{data.bucket.problem}</Alert>
    </div>
  {/if}

  <TabNav active={activeTabId} {tabs}>
    <ErrorBoundary title="This tab hit an error while rendering.">
      {@render children()}
    </ErrorBoundary>
  </TabNav>
</div>
