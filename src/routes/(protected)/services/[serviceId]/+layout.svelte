<script lang="ts">
	import {
		ArrowLeft,
		Clock,
		Container,
		Cpu,
		ExternalLink,
		FileText,
		HardDrive,
		LayoutGrid,
		Network,
		Settings,
		SlidersHorizontal,
		Terminal,
	} from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import TabNav, { type NavTab } from "$lib/components/tab-nav.svelte";
	import { syncServiceStatuses } from "$lib/remote/service-status.remote";

	const { data, children } = $props();

	const svc = $derived(data.service);
	const synced = $derived(
		syncServiceStatuses(svc.containerId || svc.swarmServiceId ? [svc.id] : []),
	);
	const liveStatus = $derived(
		synced.current?.find((row) => row.id === svc.id)?.status ??
			svc.currentStatus,
	);
	const publicHost = $derived(
		data.stackSlug ? `${data.stackSlug}-${svc.slug}` : svc.slug,
	);
	const publicDomains = $derived(
		svc.dnsResolvable
			? [
					`${publicHost}.${data.baseDomain}`,
					...(svc.customDomain ? [svc.customDomain] : []),
				]
			: [],
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
			href: resolve("/(protected)/services/[serviceId]/revisions", {
				serviceId: svc.id,
			}),
			icon: Clock,
			id: "revisions",
			label: "Revisions",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/observability", {
				serviceId: svc.id,
			}),
			icon: FileText,
			id: "observability",
			label: "Observability",
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

<div class="p-5 md:p-6">
  <a
    class="text-text-muted hover:text-text mb-4 inline-flex items-center gap-1.5 text-sm"
    href={resolve("/services")}
  >
    <ArrowLeft class="size-3.5" />
    Services
  </a>

  <!-- ── Hero ─────────────────────────────────────────────── -->
  <div class="mb-6 flex flex-wrap items-center gap-3">
    <h1 class="text-text text-lg font-semibold tracking-tight">{svc.name}</h1>
    <StatusBadge status={liveStatus} />
  </div>
  <p class="text-text-muted -mt-4 mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
    <span>{svc.image}:{svc.tag}</span>
    {#if publicDomains.length > 0}
      {#each publicDomains as domain (domain)}
        <span aria-hidden="true">·</span>
        <a
          class="text-accent inline-flex items-center gap-1 hover:underline"
          href="{data.publicScheme}://{domain}"
          rel="noopener noreferrer"
          target="_blank"
        >
          {domain}
          <ExternalLink class="size-3" />
        </a>
      {/each}
    {:else}
      <span aria-hidden="true">·</span>
      <span class="text-text-subtle">not publicly routed</span>
    {/if}
    {#if svc.containerId || svc.swarmServiceId}
      <span aria-hidden="true">·</span>
      <span class="text-text-subtle">
        internal: {svc.slug}:{svc.containerPort}
      </span>
    {/if}
  </p>

  <!-- ── Tabs ─────────────────────────────────────────────── -->
  <TabNav active={activeTabId} {tabs} />

  {@render children()}
</div>
