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
	import { visibleItems } from "#lib/ui-mode.js";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";

	const { children, data } = $props();

	const svc = $derived(data.service);

	const sections = $derived([
		{
			href: resolve("/(protected)/services/[serviceId]/environments", {
				serviceId: svc.id,
			}),
			icon: Layers,
			id: "service/environments/environments",
			label: "Environments",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/environments/source", {
				serviceId: svc.id,
			}),
			icon: Container,
			id: "service/environments/source",
			label: "Source",
		},
		{
			href: resolve(
				"/(protected)/services/[serviceId]/environments/variables",
				{ serviceId: svc.id },
			),
			icon: SlidersHorizontal,
			id: "service/environments/variables",
			label: "Environment Variables",
		},
		{
			href: resolve(
				"/(protected)/services/[serviceId]/environments/revisions",
				{ serviceId: svc.id },
			),
			icon: Clock,
			id: "service/environments/revisions",
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
						id: "service/environments/previews",
						label: "Previews",
					},
					{
						href: resolve(
							"/(protected)/services/[serviceId]/environments/channels",
							{ serviceId: svc.id },
						),
						icon: Bird,
						id: "service/environments/channels",
						label: "Channels",
					},
				]
			: []),
	]);
</script>

<SectionNav
  label="Environments & Deployments sections"
  sections={visibleItems(data.uiMode, sections, page.url.pathname)}
/>

{@render children()}
