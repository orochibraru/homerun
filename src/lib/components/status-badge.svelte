<script lang="ts">
	import { HeartCrack, HeartPulse, Loader2 } from "@lucide/svelte";

	import { SERVICE_STATUS_CONFIG } from "#lib/constants.js";
	import type { ContainerStatus, RevisionHealth } from "#lib/types.js";

	interface Props {
		/** The running revision's health: refines a `running` badge into healthy, checking or unhealthy. */
		health?: RevisionHealth | null;
		status: ContainerStatus;
	}

	const { health = null, status }: Props = $props();

	const HEALTH: Record<
		RevisionHealth,
		{ class: string; icon: typeof HeartPulse; label: string }
	> = {
		healthy: {
			class: "text-emerald-600 dark:text-emerald-400",
			icon: HeartPulse,
			label: "Healthy",
		},
		rolled_back: {
			class: "text-red-600 dark:text-red-400",
			icon: HeartCrack,
			label: "Unhealthy",
		},
		unhealthy: {
			class: "text-red-600 dark:text-red-400",
			icon: HeartCrack,
			label: "Unhealthy",
		},
		watching: {
			class: "text-blue-600 dark:text-blue-400",
			icon: Loader2,
			label: "Checking",
		},
	};

	const meta = $derived(
		status === "running" && health
			? HEALTH[health]
			: SERVICE_STATUS_CONFIG[status],
	);
	const spinning = $derived(
		status === "pulling" ||
			status === "starting" ||
			(status === "running" && health === "watching"),
	);
</script>

<span
	class="border-border-light bg-surface inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border pr-2.5 pl-2 text-xs font-bold whitespace-nowrap {meta.class}"
	title={status === "running" && health
		? `Running, ${meta.label.toLowerCase()}`
		: undefined}
>
	<meta.icon class="size-3.5 {spinning ? 'animate-spin' : ''}" />
	{meta.label}
</span>
