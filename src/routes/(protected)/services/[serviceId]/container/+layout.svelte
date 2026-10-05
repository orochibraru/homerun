<script lang="ts">
	import { Cpu, TerminalSquare } from "@lucide/svelte";
	import SectionNav from "#lib/components/section-nav.svelte";
	import { resolve } from "$app/paths";

	const { children, data } = $props();

	const sections = $derived([
		{
			href: resolve("/(protected)/services/[serviceId]/container", {
				serviceId: data.service.id,
			}),
			icon: Cpu,
			label: "Compute",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/container/runtime", {
				serviceId: data.service.id,
			}),
			icon: TerminalSquare,
			label: "Runtime",
		},
	]);
</script>

<SectionNav label="Container sections" {sections} />

{@render children()}
