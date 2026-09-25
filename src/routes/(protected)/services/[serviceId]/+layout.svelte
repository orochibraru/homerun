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
		ShieldCheck,
		SlidersHorizontal,
		Terminal,
		TerminalSquare,
	} from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import TabNav, { type NavTab } from "$lib/components/tab-nav.svelte";
	import { timeAgo } from "$lib/formatting";
	import { syncServiceStatuses } from "$lib/remote/service-status.remote";
	import { primaryHostname } from "$lib/service-domains";

	const { data, children } = $props();

	const svc = $derived(data.service);
	const synced = $derived(
		syncServiceStatuses(svc.containerId || svc.swarmServiceId ? [svc.id] : []),
	);
	const liveStatus = $derived(
		synced.current?.find((row) => row.id === svc.id)?.status ??
			svc.currentStatus,
	);
	const publicDomains = $derived.by(() => {
		const main = svc.dnsResolvable
			? primaryHostname(svc, data.stackSlug, data.baseDomain)
			: null;
		return main ? [main] : [];
	});

	interface RouteTab extends NavTab {
		exact: boolean;
		href: string;
	}

	const tabs = $derived<RouteTab[]>([
		{
			exact: true,
			href: resolve("/(protected)/services/[serviceId]", { serviceId: svc.id }),
			icon: LayoutGrid,
			iconClass: "text-sky-500",
			id: "overview",
			label: "Overview",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/source", {
				serviceId: svc.id,
			}),
			icon: Container,
			iconClass: "text-amber-500",
			id: "source",
			label: "Source",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/revisions", {
				serviceId: svc.id,
			}),
			icon: Clock,
			iconClass: "text-violet-500",
			id: "revisions",
			label: "Revisions",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/observability", {
				serviceId: svc.id,
			}),
			icon: FileText,
			iconClass: "text-emerald-500",
			id: "observability",
			label: "Observability",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/env", {
				serviceId: svc.id,
			}),
			icon: SlidersHorizontal,
			iconClass: "text-orange-500",
			id: "env",
			label: "Env Vars",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/volumes", {
				serviceId: svc.id,
			}),
			icon: HardDrive,
			iconClass: "text-cyan-500",
			id: "volumes",
			label: "Volumes",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/networking", {
				serviceId: svc.id,
			}),
			icon: Network,
			iconClass: "text-blue-500",
			id: "networking",
			label: "Networking",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/compute", {
				serviceId: svc.id,
			}),
			icon: Cpu,
			iconClass: "text-rose-500",
			id: "compute",
			label: "Compute",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/runtime", {
				serviceId: svc.id,
			}),
			icon: TerminalSquare,
			iconClass: "text-lime-600",
			id: "runtime",
			label: "Runtime",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/security", {
				serviceId: svc.id,
			}),
			icon: ShieldCheck,
			iconClass: "text-green-600",
			id: "security",
			label: "Security",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/terminal", {
				serviceId: svc.id,
			}),
			icon: Terminal,
			iconClass: "text-fuchsia-500",
			id: "terminal",
			label: "Terminal",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/settings", {
				serviceId: svc.id,
			}),
			icon: Settings,
			iconClass: "text-slate-500",
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
    {#if data.lastDeployedAt}
      <span aria-hidden="true">·</span>
      <span
        class="text-text-subtle"
        title={new Date(data.lastDeployedAt).toLocaleString()}
      >
        deployed {timeAgo(data.lastDeployedAt)}
      </span>
    {/if}
  </p>

  <!-- ── Tabs ─────────────────────────────────────────────── -->
  <TabNav active={activeTabId} {tabs} />

  {@render children()}
</div>
