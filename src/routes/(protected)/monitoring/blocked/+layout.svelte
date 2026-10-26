<script lang="ts">
	import { resolve } from "$app/paths";
	import { Ban, Trophy } from "@lucide/svelte";

	import BlockedSummary from "#lib/components/blocked-summary.svelte";
	import SectionNav from "#lib/components/section-nav.svelte";

	const { children, data } = $props();

	const sections = [
		{
			href: resolve("/(protected)/monitoring/blocked"),
			icon: Ban,
			label: "Addresses",
		},
		{
			href: resolve("/(protected)/monitoring/blocked/services"),
			icon: Trophy,
			label: "By service",
		},
	];
</script>

<div class="space-y-6">
	{#if !data.published}
		<p
			class="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600"
		>
			Traefik's dynamic config directory isn't set (Settings → Networking), so
			blocked requests aren't counted and bans aren't enforced.
		</p>
	{:else if !data.ipBans.enabled}
		<p class="text-text-muted text-sm">
			Bans are off: blocked paths still answer 403, but nobody gets banned.
			<a
				class="text-accent hover:underline"
				href={resolve("/(protected)/settings/ip-bans")}
			>
				Turn them on
			</a>
		</p>
	{/if}

	<BlockedSummary
		baiting={data.ipBans.meanMode || data.ipBans.disrespectMode}
		bans={data.banCount}
		days={data.statsDays}
		summary={data.summary}
		topService={data.perService[0] ?? null}
	/>

	<div>
		<SectionNav hubLabel="Blocked IPs" label="Blocked IP views" {sections}>
			{@render children()}
		</SectionNav>
	</div>
</div>
