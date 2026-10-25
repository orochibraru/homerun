<script lang="ts">
	import { Bug, List, Rocket, SquareKanban } from "@lucide/svelte";
	import SectionNav from "#lib/components/section-nav.svelte";
	import { resolve } from "$app/paths";

	const { children, data } = $props();

	const sections = $derived([
		{
			href: resolve("/(protected)/services/[serviceId]/observability/errors", {
				serviceId: data.service.id,
			}),
			icon: List,
			label: "Issues",
		},
		{
			href: resolve(
				"/(protected)/services/[serviceId]/observability/errors/board",
				{ serviceId: data.service.id },
			),
			icon: SquareKanban,
			label: "Board",
		},
		{
			href: resolve(
				"/(protected)/services/[serviceId]/observability/errors/failed-deployments",
				{ serviceId: data.service.id },
			),
			icon: Rocket,
			label: "Failed deployments",
		},
		{
			href: resolve(
				"/(protected)/services/[serviceId]/observability/errors/app-errors",
				{ serviceId: data.service.id },
			),
			icon: Bug,
			label: "Application errors",
		},
	]);
</script>

<SectionNav hubLabel="Errors" label="Error views" {sections}>
  {@render children()}
</SectionNav>
