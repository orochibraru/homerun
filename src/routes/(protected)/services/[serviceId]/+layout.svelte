<script lang="ts">
	import {
		ArrowLeft,
		Container,
		Cpu,
		FileText,
		HardDrive,
		LayoutGrid,
		Network,
		Settings,
		SlidersHorizontal,
		Terminal,
		TriangleAlert,
	} from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import TabNav, { type NavTab } from "$lib/components/tab-nav.svelte";

	const { data, children } = $props();

	const svc = $derived(data.service);
	const publicHost = $derived(
		data.projectSlug ? `${data.projectSlug}-${svc.slug}` : svc.slug,
	);

	interface RouteTab extends NavTab {
		exact: boolean;
		href: string;
	}

	const tabs = $derived<RouteTab[]>([
		{
			exact: true,
			href: resolve("/(protected)/services/[serviceId]", { serviceId: svc.id }),
			icon: LayoutGrid,
			id: "overview",
			label: "Overview",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/source", {
				serviceId: svc.id,
			}),
			icon: Container,
			id: "source",
			label: "Source",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/logs", {
				serviceId: svc.id,
			}),
			icon: FileText,
			id: "logs",
			label: "Logs",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/env", {
				serviceId: svc.id,
			}),
			icon: SlidersHorizontal,
			id: "env",
			label: "Env Vars",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/volumes", {
				serviceId: svc.id,
			}),
			icon: HardDrive,
			id: "volumes",
			label: "Volumes",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/networking", {
				serviceId: svc.id,
			}),
			icon: Network,
			id: "networking",
			label: "Networking",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/compute", {
				serviceId: svc.id,
			}),
			icon: Cpu,
			id: "compute",
			label: "Compute",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/terminal", {
				serviceId: svc.id,
			}),
			icon: Terminal,
			id: "terminal",
			label: "Terminal",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/errors", {
				serviceId: svc.id,
			}),
			icon: TriangleAlert,
			id: "errors",
			label: "Errors",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/settings", {
				serviceId: svc.id,
			}),
			icon: Settings,
			id: "settings",
			label: "Settings",
		},
	]);

	function isActive(href: string, exact: boolean): boolean {
		if (exact) {
			return page.url.pathname === href;
		}
		return page.url.pathname.startsWith(href);
	}

	const activeTabId = $derived(
		tabs.find((tab) => isActive(tab.href, tab.exact))?.id ?? "",
	);
</script>

<div class="p-6 md:p-8">
  <a
    class="text-text-muted hover:text-text mb-4 inline-flex items-center gap-1.5 text-sm"
    href={resolve("/services")}
  >
    <ArrowLeft class="size-3.5" />
    Services
  </a>

  <!-- ── Hero ─────────────────────────────────────────────── -->
  <div class="mb-6 flex flex-wrap items-center gap-3">
    <h1 class="text-text text-2xl font-bold">{svc.name}</h1>
    <StatusBadge status={svc.currentStatus} />
  </div>
  <p class="text-text-muted -mt-4 mb-6 text-sm">
    {svc.image}:{svc.tag}
    ·
    {#if svc.dnsResolvable}
      <span class="text-accent">{publicHost}.{data.baseDomain}</span>
    {:else}
      <span class="text-text-subtle">not publicly routed</span>
    {/if}
    {#if svc.containerId || svc.swarmServiceId}
      · internal:
      <span class="text-text-subtle font-mono">{svc.slug}:{
          svc.containerPort
        }</span>
    {/if}
  </p>

  <!-- ── Tabs ─────────────────────────────────────────────── -->
  <TabNav active={activeTabId} {tabs} />

  {@render children()}
</div>
