<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import {
		Activity,
		BarChart3,
		Bug,
		HeartPulse,
		Radio,
		ScrollText,
		ShieldBan,
		Workflow,
	} from "@lucide/svelte";

	import SectionNav from "#lib/components/section-nav.svelte";
	import { visibleItems } from "#lib/ui-mode.js";

	const { children, data } = $props();

	const sections = $derived([
		{
			href: resolve("/(protected)/services/[serviceId]/observability", {
				serviceId: data.service.id,
			}),
			icon: BarChart3,
			id: "service/observability/monitoring",
			label: "Monitoring",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/observability/logs", {
				serviceId: data.service.id,
			}),
			icon: ScrollText,
			id: "service/observability/logs",
			label: "Logs",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/observability/uptime", {
				serviceId: data.service.id,
			}),
			icon: Radio,
			id: "service/observability/uptime",
			label: "Uptime",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/observability/errors", {
				serviceId: data.service.id,
			}),
			icon: Bug,
			id: "service/observability/errors",
			label: "Errors",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/observability/traces", {
				serviceId: data.service.id,
			}),
			icon: Activity,
			id: "service/observability/traces",
			label: "Traces",
		},
		{
			href: resolve(
				"/(protected)/services/[serviceId]/observability/pipelines",
				{ serviceId: data.service.id },
			),
			icon: Workflow,
			id: "service/observability/pipelines",
			label: "Pipelines",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/observability/blocked", {
				serviceId: data.service.id,
			}),
			icon: ShieldBan,
			id: "service/observability/blocked",
			label: "Blocked IPs",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/observability/health", {
				serviceId: data.service.id,
			}),
			icon: HeartPulse,
			id: "service/observability/health",
			label: "Health",
		},
	]);
</script>

<SectionNav
	hubLabel="Observability"
	label="Observability sections"
	sections={visibleItems(data.uiMode, sections, page.url.pathname)}
>
	{@render children()}
</SectionNav>
