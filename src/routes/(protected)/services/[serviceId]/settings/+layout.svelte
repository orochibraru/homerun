<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { Repeat, Settings, TriangleAlert } from "@lucide/svelte";

	import SectionNav from "#lib/components/section-nav.svelte";
	import { visibleItems } from "#lib/ui-mode.js";

	const { children, data } = $props();

	const sections = $derived([
		{
			href: resolve("/(protected)/services/[serviceId]/settings", {
				serviceId: data.service.id,
			}),
			icon: Settings,
			id: "service/settings/general",
			label: "General",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/settings/automation", {
				serviceId: data.service.id,
			}),
			icon: Repeat,
			id: "service/settings/automation",
			label: "Automation",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/settings/danger", {
				serviceId: data.service.id,
			}),
			icon: TriangleAlert,
			id: "service/settings/danger",
			label: "Danger zone",
		},
	]);
</script>

<SectionNav
	hubLabel="Settings"
	label="Settings sections"
	sections={visibleItems(data.uiMode, sections, page.url.pathname)}
>
	{@render children()}
</SectionNav>
