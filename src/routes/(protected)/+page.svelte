<script lang="ts">
	import { onMount, untrack } from "svelte";

	import { ActivityFeedClient } from "#lib/activity-feed.svelte.js";
	import ErrorBoundary from "#lib/components/error-boundary.svelte";
	import DeploymentsCard from "#lib/components/overview/deployments-card.svelte";
	import HostCard from "#lib/components/overview/host-card.svelte";
	import KpiRow from "#lib/components/overview/kpi-row.svelte";
	import NeedsYouCard from "#lib/components/overview/needs-you-card.svelte";
	import QuickDeployTemplates from "#lib/components/overview/quick-deploy-templates.svelte";
	import TrafficCard from "#lib/components/overview/traffic-card.svelte";
	import { title } from "#lib/store/title.js";
	import { Streamed } from "#lib/streamed.svelte.js";

	const { data } = $props();

	const statsData = new Streamed(
		() => `dashboard:stats:${data.user.id}`,
		() => data.stats,
	);
	const uptimeData = new Streamed(
		() => `dashboard:uptime:${data.user.id}`,
		() => data.uptimeDown,
	);
	const monitoringData = new Streamed(
		() => `dashboard:monitoring:${data.user.id}`,
		() => data.monitoring,
	);
	const overCapacityData = new Streamed(
		() => "dashboard:over-capacity",
		() => data.overCapacity,
	);
	const templatesData = new Streamed(
		() => `dashboard:templates:${data.user.id}`,
		() => data.frontPageTemplates,
	);
	const updatesData = new Streamed(
		() => `dashboard:updates:${data.user.id}`,
		() => data.availableUpdates,
	);
	const iconsData = new Streamed(
		() => `dashboard:icons:${data.user.id}`,
		() => data.serviceIcons,
	);
	const feed = untrack(() => data.readsServices)
		? new ActivityFeedClient()
		: null;

	onMount(() => {
		title.set("Dashboard");
	});
</script>

<div class="p-5 md:p-6">
	<h1 class="mb-5 text-2xl font-semibold tracking-[-0.03em]">
		{data.greeting}, {data.user?.name?.split(" ")[0]}
	</h1>

	<KpiRow
		failed={monitoringData.failed}
		monitoring={monitoringData.current}
		stats={statsData.current}
	/>

	<div class="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
		<TrafficCard
			failed={monitoringData.failed}
			monitoring={monitoringData.current}
		/>
		<NeedsYouCard
			alerts={feed ? feed.snapshot?.alerts : []}
			overCapacity={overCapacityData.current}
			permissions={data.permissions}
			readsSettings={data.readsSettings}
			updates={updatesData.current}
			uptimeDown={uptimeData.current}
		/>
	</div>

	<div class="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
		{#if feed}
			<DeploymentsCard
				now={feed.now}
				serviceIcons={iconsData.current ?? {}}
				snapshot={feed.snapshot}
			/>
		{/if}
		<ErrorBoundary title="Host resources didn't load.">
			<HostCard />
		</ErrorBoundary>
	</div>

	{#if templatesData.current?.length}
		<div class="mt-8">
			<QuickDeployTemplates templates={templatesData.current} />
		</div>
	{/if}
</div>
