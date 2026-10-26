<script lang="ts">
	import { resolve } from "$app/paths";
	import { ShieldCheck, Siren, Users } from "@lucide/svelte";

	import EmptyState from "#lib/components/empty-state.svelte";
	import SectionNav from "#lib/components/section-nav.svelte";
	import { Button } from "#lib/components/ui/button/index.js";

	const { children, data } = $props();

	const sections = [
		{
			href: resolve("/(protected)/monitoring/crowdsec"),
			icon: ShieldCheck,
			label: "Decisions",
		},
		{
			href: resolve("/(protected)/monitoring/crowdsec/alerts"),
			icon: Siren,
			label: "Alerts",
		},
		{
			href: resolve("/(protected)/monitoring/crowdsec/blocklist"),
			icon: Users,
			label: "Community blocklist",
		},
	];
</script>

{#if data.crowdsecConfigured}
	<SectionNav hubLabel="CrowdSec" label="CrowdSec sections" {sections}>
		{@render children()}
	</SectionNav>
{:else}
	<EmptyState
		icon={ShieldCheck}
		subtitle="Connect a CrowdSec Local API under Settings → IP bans to see and manage its decisions here."
		title="CrowdSec isn't set up"
	>
		<Button
			href={resolve("/(protected)/settings/ip-bans")}
			size="sm"
			variant="outline"
		>
			Set it up
		</Button>
	</EmptyState>
{/if}
