<script lang="ts">
  import {
    ArrowLeft,
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

  const { data, children } = $props();

  const svc = $derived(data.service);
  const publicHost = $derived(
    data.projectSlug ? `${data.projectSlug}-${svc.slug}` : svc.slug
  );

  const tabs = $derived([
    {
      exact: true,
      href: resolve("/(protected)/services/[serviceId]", { serviceId: svc.id }),
      icon: LayoutGrid,
      label: "Overview",
    },
    {
      exact: false,
      href: resolve("/(protected)/services/[serviceId]/logs", {
        serviceId: svc.id,
      }),
      icon: FileText,
      label: "Logs",
    },
    {
      exact: false,
      href: resolve("/(protected)/services/[serviceId]/env", {
        serviceId: svc.id,
      }),
      icon: SlidersHorizontal,
      label: "Env Vars",
    },
    {
      exact: false,
      href: resolve("/(protected)/services/[serviceId]/volumes", {
        serviceId: svc.id,
      }),
      icon: HardDrive,
      label: "Volumes",
    },
    {
      exact: false,
      href: resolve("/(protected)/services/[serviceId]/networking", {
        serviceId: svc.id,
      }),
      icon: Network,
      label: "Networking",
    },
    {
      exact: false,
      href: resolve("/(protected)/services/[serviceId]/terminal", {
        serviceId: svc.id,
      }),
      icon: Terminal,
      label: "Terminal",
    },
    {
      exact: false,
      href: resolve("/(protected)/services/[serviceId]/errors", {
        serviceId: svc.id,
      }),
      icon: TriangleAlert,
      label: "Errors",
    },
    {
      exact: false,
      href: resolve("/(protected)/services/[serviceId]/settings", {
        serviceId: svc.id,
      }),
      icon: Settings,
      label: "Settings",
    },
  ]);

  function isActive(href: string, exact: boolean): boolean {
    if (exact) {
      return page.url.pathname === href;
    }
    return page.url.pathname.startsWith(href);
  }
</script>

<div class="p-6 md:p-8">
  <a
    class="mb-4 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
    href={resolve("/services")}
  >
    <ArrowLeft class="size-3.5" />
    Services
  </a>

  <!-- ── Hero ─────────────────────────────────────────────── -->
  <div class="mb-6 flex flex-wrap items-center gap-3">
    <h1 class="text-2xl font-bold text-text">{svc.name}</h1>
    <StatusBadge status={svc.currentStatus} />
  </div>
  <p class="-mt-4 mb-6 text-sm text-text-muted">
    {svc.image}:{svc.tag}
    ·
    {#if svc.dnsResolvable}
      <span class="text-accent">{publicHost}.{data.baseDomain}</span>
    {:else}
      <span class="text-text-subtle">not publicly routed</span>
    {/if}
    {#if svc.containerId}
      · internal:
      <span class="font-mono text-text-subtle"
        >{svc.slug}:{svc.containerPort}</span
      >
    {/if}
  </p>

  <!-- ── Tabs ─────────────────────────────────────────────── -->
  <div class="mb-6 flex gap-1 border-b border-border">
    {#each tabs as tab}
      {@const active = isActive(tab.href, tab.exact)}
      {@const TabIcon = tab.icon}
      <a
        class="flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-all duration-200
					{active
          ? 'border-accent text-accent'
          : 'border-transparent text-text-muted hover:text-text'}"
        href={tab.href}
      >
        <TabIcon class="size-4" />
        {tab.label}
      </a>
    {/each}
  </div>

  {@render children()}
</div>
