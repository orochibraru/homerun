<script lang="ts">
	import { Bug, Cpu, HeartPulse, Timer, TrendingUp } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import { onMount, tick } from "svelte";

	import Alert from "#lib/components/alert.svelte";
	import AnsiLine from "#lib/components/ansi-line.svelte";
	import ConnectionStrings from "#lib/components/connection-strings.svelte";
	import DeployStepper from "#lib/components/deploy-stepper.svelte";
	import ErrorBoundary from "#lib/components/error-boundary.svelte";
	import KpiTile from "#lib/components/kpi-tile.svelte";
	import ReplicaStats from "#lib/components/replica-stats.svelte";
	import ServiceActivityLanes from "#lib/components/service-activity-lanes.svelte";
	import ServiceActivity from "#lib/components/service-activity.svelte";
	import ServiceGraph from "#lib/components/service-graph.svelte";
	import ServiceLogPreview from "#lib/components/service-log-preview.svelte";
	import ServiceMetricChart from "#lib/components/service-metric-chart.svelte";
	import ServiceSummary from "#lib/components/service-summary.svelte";
	import { useDeployProgress } from "#lib/deploy-progress.svelte.js";
	import type { Change } from "#lib/metrics-format.js";
	import { monitoringChanges } from "#lib/monitoring-changes.js";
	import { MONITORING_RANGES } from "#lib/monitoring-ranges.js";
	import { workloadId } from "#lib/service-state.js";
	import { title } from "#lib/store/title.js";

	const { data } = $props();

	const svc = $derived(data.service);

	onMount(() => title.set(svc.name));

	const progress = useDeployProgress();

	let progressEl = $state<HTMLElement | undefined>();

	$effect(() => {
		const lineCount = progress.progressLines.length;
		if (lineCount > 0 && progressEl) {
			void tick().then(() => {
				progressEl?.scrollTo({ top: progressEl.scrollHeight });
			});
		}
	});

	const monitoring = $derived(data.monitoring);
	const traffic = $derived(monitoring.traffic);
	const changes = $derived(monitoringChanges(monitoring));
	const period = $derived(
		(
			MONITORING_RANGES.find((range) => range.id === monitoring.range)?.label ??
			""
		).toLowerCase(),
	);

	function delta(change: Change | null | undefined) {
		return change
			? {
					good: change.direction !== "worse",
					text: change.text.replace(/^\+/, "↑ ").replace(/^−/, "↓ "),
				}
			: undefined;
	}

	function compact(value: number): { unit: string; value: string } {
		const parts = new Intl.NumberFormat(undefined, {
			maximumFractionDigits: 1,
			notation: value >= 10_000 ? "compact" : "standard",
		}).formatToParts(value);
		return {
			unit: parts
				.filter((part) => part.type === "compact")
				.map((part) => part.value)
				.join(""),
			value: parts
				.filter((part) => part.type !== "compact" && part.type !== "literal")
				.map((part) => part.value)
				.join(""),
		};
	}

	const requests = $derived(compact(traffic.requests));

	const response = $derived(
		traffic.avgResponseMs === null
			? { unit: "", value: "—" }
			: traffic.avgResponseMs >= 1000
				? { unit: "s", value: (traffic.avgResponseMs / 1000).toFixed(2) }
				: { unit: "ms", value: String(Math.round(traffic.avgResponseMs)) },
	);

	const errorRate = $derived(
		traffic.requests
			? {
					unit: "%",
					value: (
						((traffic.status4xx + traffic.status5xx) / traffic.requests) *
						100
					).toFixed(1),
				}
			: { unit: "", value: "—" },
	);

	const availability = $derived.by(() => {
		const { external, internal } = monitoring.availability;
		if (external.checks > 0) {
			return { change: changes.uptimePublic, ...external };
		}
		return internal.checks > 0
			? { change: changes.uptimeNetwork, ...internal }
			: null;
	});

	const health = $derived(
		data.deployments.find(
			(dep) => dep.status === "running" || dep.status === "stopped",
		)?.health ?? null,
	);
</script>

{#if progress.pendingAction === "deploy"}
	<div class="panel mb-4 rounded-[1.125rem]">
		<DeployStepper
			buildSource={svc.buildSource}
			log={progress.progressLines.join("\n")}
			status={progress.progressStatus}
		/>
		<div
			class="log-output h-48 overflow-y-auto rounded-b-[1.125rem]"
			bind:this={progressEl}
		>
			{#if progress.progressLines.length === 0}
				<span class="text-zinc-500">Waiting for the deploy to start…</span>
			{:else}
				{#each progress.progressLines as line, i (i)}
					<AnsiLine {line} />
				{/each}
			{/if}
		</div>
	</div>
{/if}

{#if progress.failedDeploymentId && progress.pendingAction !== "deploy"}
	{@const failedId = progress.failedDeploymentId}
	<Alert class="mb-4" title="The last deploy failed">
		Its revision has the error and the full log.
		{#snippet actions()}
			<Button
				href={progress.revisionHref(failedId)}
				size="sm"
				variant="outline"
			>
				See why
			</Button>
		{/snippet}
	</Alert>
{/if}

<div class="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
	<KpiTile
		delta={delta(changes.requests)}
		icon={TrendingUp}
		label="Requests · {period}"
		tone="hero"
		unit={requests.unit}
		value={requests.value}
	/>
	<KpiTile
		delta={delta(changes.avgResponse)}
		icon={Timer}
		label="Avg response"
		tone="sand"
		unit={response.unit}
		value={response.value}
	/>
	<KpiTile
		delta={delta(changes.errorRate)}
		icon={Bug}
		label="Error rate"
		tone="mauve"
		unit={errorRate.unit}
		value={errorRate.value}
	/>
	{#if availability}
		<KpiTile
			delta={delta(availability.change)}
			icon={HeartPulse}
			label="Uptime · {period}"
			tone="sky"
			unit="%"
			value={((availability.ok / availability.checks) * 100).toFixed(2)}
		/>
	{:else}
		<KpiTile
			delta={delta(changes.avgCpu)}
			icon={Cpu}
			label="Avg CPU · {period}"
			tone="sky"
			unit={monitoring.resources.avgCpuPercent === null ? "" : "%"}
			value={monitoring.resources.avgCpuPercent?.toFixed(1) ?? "—"}
		/>
	{/if}
</div>

<div class="mb-3 grid items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_22.5rem]">
	<ServiceMetricChart {monitoring} zone={data.zone} />
	<ServiceSummary
		{health}
		mountCount={data.mountCount}
		service={svc}
		usage={data.usage}
	/>
</div>

<div class="mb-3">
	<ServiceActivityLanes
		events={data.activity.events}
		{period}
		window={data.activity.window}
	/>
</div>

<div
	class="grid items-stretch gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_22.5rem]"
>
	<ServiceActivity
		deployments={data.deployments}
		running={svc.currentStatus === "running"}
		serviceId={svc.id}
	/>
	<ServiceLogPreview serviceId={svc.id} workloadId={workloadId(svc)} />
	<div class="lg:col-span-2 xl:col-span-1">
		<ServiceGraph
			dependsOn={data.dependsOn}
			name={svc.name}
			serviceId={svc.id}
			usedBy={data.usedBy}
		/>
	</div>
</div>

{#if svc.swarmServiceId}
	<div class="mt-3">
		<ErrorBoundary title="Replica stats didn't load.">
			<ReplicaStats serviceId={svc.id} />
		</ErrorBoundary>
	</div>
{/if}

<div class="mt-3">
	<ConnectionStrings
		service={{
			command: svc.command,
			containerPort: svc.containerPort,
			envVars: svc.envVars ?? {},
			image: svc.image,
			name: svc.name,
			slug: svc.slug,
		}}
	/>
</div>
