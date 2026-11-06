<script lang="ts">
	import { resolve } from "$app/paths";
	import { CircleCheck, CircleX, Loader2, Power } from "@lucide/svelte";

	import ChartHoverTarget from "#lib/components/chart-hover-target.svelte";
	import RingGauge from "#lib/components/ring-gauge.svelte";
	import { timeAgo } from "#lib/formatting.js";
	import { formatMb } from "#lib/metrics-format.js";
	import type { RevisionHealth } from "#lib/types.js";

	interface Props {
		health: RevisionHealth | null;
		mountCount: number;
		service: {
			containerPort: number;
			cpuLimit: string | null;
			createdAt: Date | string;
			healthcheckDisabled: boolean;
			id: string;
			memoryLimitMb: number | null;
			replicas: number;
		};
		usage: { cpuPercent: number; memUsedMb: number } | null;
	}

	const { health, mountCount, service, usage }: Props = $props();

	const HEALTH = {
		checking: {
			class: "text-blue-600 dark:text-blue-400",
			icon: Loader2,
			label: "Checking",
		},
		failing: {
			class: "text-red-600 dark:text-red-400",
			icon: CircleX,
			label: "Failing",
		},
		off: { class: "text-text-muted", icon: Power, label: "Off" },
		on: { class: "text-text-muted", icon: CircleCheck, label: "On" },
		passing: {
			class: "text-emerald-600 dark:text-emerald-400",
			icon: CircleCheck,
			label: "Passing",
		},
	};

	const healthState = $derived.by(() => {
		if (service.healthcheckDisabled) {
			return HEALTH.off;
		}
		if (health === "healthy") {
			return HEALTH.passing;
		}
		if (health === "watching") {
			return HEALTH.checking;
		}
		if (health === "unhealthy" || health === "rolled_back") {
			return HEALTH.failing;
		}
		return HEALTH.on;
	});

	const limits = $derived(
		[
			service.cpuLimit ? `${service.cpuLimit} CPU` : null,
			service.memoryLimitMb ? formatMb(service.memoryLimitMb) : null,
		]
			.filter(Boolean)
			.join(" · "),
	);
</script>

{#snippet row(label: string)}
	<dt class="text-text-subtle">{label}</dt>
{/snippet}

<section class="panel rounded-[1.125rem] px-5 pt-5 pb-2.5">
	<div class="mb-2.5 flex items-center">
		<h2 class="text-text text-[1.0625rem] font-[650] tracking-tight">
			Details
		</h2>
		<a
			class="text-text-subtle hover:text-text ml-auto text-[0.78rem] font-semibold"
			href={resolve("/(protected)/services/[serviceId]/container", {
				serviceId: service.id,
			})}
		>
			Edit
		</a>
	</div>
	<dl
		class="[&>div]:border-border text-[0.8125rem] [&>div]:flex [&>div]:h-10 [&>div]:items-center [&>div]:justify-between [&>div]:gap-3 [&>div]:border-t [&_dd]:text-right [&_dd]:font-[650]"
	>
		<div>
			{@render row("Replicas")}
			<dd>{service.replicas}</dd>
		</div>
		<div>
			{@render row("CPU · Memory")}
			<dd class="inline-flex items-center gap-2 whitespace-nowrap">
				{#if usage}
					<ChartHoverTarget
						class="inline-flex w-auto items-center gap-2 rounded-md"
						label="CPU {usage.cpuPercent.toFixed(1)}%, memory {formatMb(
							usage.memUsedMb,
						)}"
					>
						{#snippet tip()}
							<p>
								<b class="text-sm font-bold">{usage.cpuPercent.toFixed(1)}%</b>
								CPU{service.cpuLimit ? ` of ${service.cpuLimit} cores` : ""}
							</p>
							<p>
								{formatMb(usage.memUsedMb)}{service.memoryLimitMb
									? ` of ${formatMb(service.memoryLimitMb)}`
									: ""} memory
							</p>
						{/snippet}
						<RingGauge percent={usage.cpuPercent} size={18} stroke={3} />
						{usage.cpuPercent.toFixed(0)}% · {formatMb(usage.memUsedMb)}
					</ChartHoverTarget>
				{:else}
					<span class="text-text-subtle font-medium">no recent sample</span>
				{/if}
			</dd>
		</div>
		<div>
			{@render row("Limits")}
			<dd>
				{#if limits}
					{limits}
				{:else}
					<span class="text-text-subtle font-medium">none set</span>
				{/if}
			</dd>
		</div>
		<div>
			{@render row("Port")}
			<dd class="tabular-nums">{service.containerPort}</dd>
		</div>
		<div>
			{@render row("Health check")}
			<dd>
				<span
					class="border-border-light bg-surface inline-flex h-6 items-center gap-1.5 rounded-full border pr-2.5 pl-2 text-[0.6875rem] font-bold {healthState.class}"
				>
					<healthState.icon
						class="size-3 {healthState === HEALTH.checking
							? 'animate-spin'
							: ''}"
					/>
					{healthState.label}
				</span>
			</dd>
		</div>
		<div>
			{@render row("Volumes")}
			<dd>
				{#if mountCount > 0}
					{mountCount} mounted
				{:else}
					<span class="text-text-subtle font-medium">none</span>
				{/if}
			</dd>
		</div>
		<div>
			{@render row("Created")}
			<dd>{timeAgo(service.createdAt)}</dd>
		</div>
	</dl>
</section>
