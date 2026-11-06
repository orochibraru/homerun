<script lang="ts">
	import { page } from "$app/state";
	import { ChevronLeft } from "@lucide/svelte";
	import type { Component, Snippet } from "svelte";

	import ErrorBoundary from "#lib/components/error-boundary.svelte";

	export interface SectionLink {
		href: string;
		icon: Component;
		label: string;
	}

	const {
		children,
		hubLabel = "Sections",
		label,
		sections,
	}: {
		children?: Snippet;
		hubLabel?: string;
		label: string;
		sections: SectionLink[];
	} = $props();

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

	const hubbed = $derived(children !== undefined && sections.length > 1);
	const hubHref = $derived(sections[0]?.href.split(/[?#]/)[0] ?? "");
	const atHub = $derived(
		hubbed && page.url.pathname === hubHref && page.url.search === "",
	);
	const activeSection = $derived(
		sections.find((section) => section.href === activeHref),
	);

	/** The hub card's link: the first section shares the hub's path, so it opens with a query string that tells the two apart. */
	function cardHref(section: SectionLink, index: number): string {
		return index === 0 ? `${hubHref}?view=tab` : section.href;
	}
</script>

<nav
	aria-label={label}
	data-slot="section-nav"
	class="border-border bg-surface-2 mb-5 inline-flex max-w-full overflow-x-auto rounded-lg border p-0.5 {hubbed
		? 'max-md:hidden'
		: ''}"
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

{#if atHub}
	<nav
		class="grid grid-cols-2 gap-2.5 md:hidden"
		aria-label={label}
		data-slot="section-hub"
	>
		{#each sections as section, index (section.href)}
			{@const Icon = section.icon}
			<a
				class="border-border bg-surface active:bg-surface-2 flex min-h-24 flex-col justify-between gap-3 rounded-2xl border p-3.5 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 {sections.length %
					2 ===
					1 && index === sections.length - 1
					? 'col-span-2'
					: ''}"
				href={cardHref(section, index)}
			>
				<span
					class="bg-accent-light text-accent flex size-9 items-center justify-center rounded-xl"
				>
					<Icon class="size-4.5" />
				</span>
				<span class="text-text text-sm leading-snug font-semibold"
					>{section.label}</span
				>
			</a>
		{/each}
	</nav>
{:else if hubbed}
	<div
		class="-mt-1 mb-4 flex items-center gap-2 md:hidden"
		data-slot="section-back"
	>
		<a
			class="text-accent -ml-2 flex min-h-11 items-center gap-0.5 rounded-lg pr-2 pl-1 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
			href={hubHref}
		>
			<ChevronLeft class="size-5" />
			{hubLabel}
		</a>
		{#if activeSection}
			<span class="text-text-subtle" aria-hidden="true">/</span>
			<span class="text-text truncate text-sm font-semibold"
				>{activeSection.label}</span
			>
		{/if}
	</div>
{/if}

{#if children}
	<div class={atHub ? "max-md:hidden" : "contents"}>
		<ErrorBoundary title="This section hit an error while rendering.">
			{@render children()}
		</ErrorBoundary>
	</div>
{/if}
