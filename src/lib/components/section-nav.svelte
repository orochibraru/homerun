<script lang="ts">
	import type { Component } from "svelte";
	import { page } from "$app/state";

	export interface SectionLink {
		href: string;
		icon: Component;
		label: string;
	}

	const { label, sections }: { label: string; sections: SectionLink[] } =
		$props();

	const activeHref = $derived(
		sections
			.map((section) => section.href)
			.filter(
				(href) =>
					page.url.pathname === href ||
					page.url.pathname.startsWith(`${href}/`),
			)
			.sort((a, b) => b.length - a.length)[0],
	);
</script>

<nav
  aria-label={label}
  class="border-border bg-surface-2 mb-5 inline-flex max-w-full overflow-x-auto rounded-lg border p-0.5"
>
  {#each sections as section (section.href)}
    {@const active = section.href === activeHref}
    {@const Icon = section.icon}
    <a
      aria-current={active ? "page" : undefined}
      class="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors {active
        ? 'bg-surface text-text shadow-sm'
        : 'text-text-muted hover:text-text'}"
      href={section.href}
    >
      <Icon class="size-4" />
      {section.label}
    </a>
  {/each}
</nav>
