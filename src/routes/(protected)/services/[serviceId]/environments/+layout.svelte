<script lang="ts">
	import {
		Bird,
		Clock,
		Container,
		GitPullRequest,
		Layers,
		SlidersHorizontal,
	} from "@lucide/svelte";
	import SectionNav from "#lib/components/section-nav.svelte";
	import { resolve } from "$app/paths";

	const { children, data } = $props();

	const svc = $derived(data.service);

	const sections = $derived([
		{
			href: resolve("/(protected)/services/[serviceId]/environments", {
				serviceId: svc.id,
			}),
			icon: Layers,
			label: "Environments",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/environments/source", {
				serviceId: svc.id,
			}),
			icon: Container,
			label: "Source",
		},
		{
			href: resolve(
				"/(protected)/services/[serviceId]/environments/variables",
				{ serviceId: svc.id },
			),
			icon: SlidersHorizontal,
			label: "Environment Variables",
		},
		{
			href: resolve(
				"/(protected)/services/[serviceId]/environments/revisions",
				{ serviceId: svc.id },
			),
			icon: Clock,
			label: "Revisions",
		},
		...(svc.buildSource === "git" && !svc.previewParentId
			? [
					{
						href: resolve(
							"/(protected)/services/[serviceId]/environments/previews",
							{ serviceId: svc.id },
						),
						icon: GitPullRequest,
						label: "Previews",
					},
					{
						href: resolve(
							"/(protected)/services/[serviceId]/environments/channels",
							{ serviceId: svc.id },
						),
						icon: Bird,
						label: "Channels",
					},
				]
			: []),
	]);
</script>

<SectionNav label="Environments & Deployments sections" {sections} />

{@render children()}
