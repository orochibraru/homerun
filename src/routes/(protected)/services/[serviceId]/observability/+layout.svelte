<script lang="ts">
	import { BarChart3, ListChecks } from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";

	const { children, data } = $props();

	const sections = $derived([
		{
			href: resolve("/(protected)/services/[serviceId]/observability", {
				serviceId: data.service.id,
			}),
			icon: BarChart3,
			label: "Analytics",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/observability/events", {
				serviceId: data.service.id,
			}),
			icon: ListChecks,
			label: "Events",
		},
	]);
</script>

<nav
  aria-label="Observability sections"
  class="border-border bg-surface-2 mb-5 inline-flex rounded-lg border p-0.5"
>
  {#each sections as section (section.href)}
    {@const active = page.url.pathname === section.href}
    {@const Icon = section.icon}
    <a
      aria-current={active ? "page" : undefined}
      class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors {active
        ? 'bg-surface text-text shadow-sm'
        : 'text-text-muted hover:text-text'}"
      href={section.href}
    >
      <Icon class="size-4" />
      {section.label}
    </a>
  {/each}
</nav>

{@render children()}
