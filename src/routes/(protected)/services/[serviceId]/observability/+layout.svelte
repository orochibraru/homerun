<script lang="ts">
	import { BarChart3, Bug, HeartPulse, ListChecks } from "@lucide/svelte";
	import SectionNav from "#lib/components/section-nav.svelte";
	import { resolve } from "$app/paths";

	const { children, data } = $props();

	const sections = $derived([
		{
			href: resolve("/(protected)/services/[serviceId]/observability", {
				serviceId: data.service.id,
			}),
			icon: BarChart3,
			label: "Monitoring",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/observability/events", {
				serviceId: data.service.id,
			}),
			icon: ListChecks,
			label: "Events",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/observability/errors", {
				serviceId: data.service.id,
			}),
			icon: Bug,
			label: "Errors",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/observability/health", {
				serviceId: data.service.id,
			}),
			icon: HeartPulse,
			label: "Health",
		},
	]);
</script>

<SectionNav label="Observability sections" {sections} />

{@render children()}
