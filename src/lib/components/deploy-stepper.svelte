<script lang="ts">
	import {
		Box,
		Check,
		CheckCircle2,
		Download,
		GitBranch,
		Hammer,
		HardDrive,
		HeartPulse,
		Minus,
		Rocket,
		Route,
		Settings2,
		ShieldCheck,
		X,
		XCircle,
	} from "@lucide/svelte";
	import { Spinner } from "@orochibraru/ui/spinner";
	import type { Component } from "svelte";
	import { untrack } from "svelte";

	import {
		type DeployPhase,
		type DeployPhaseId,
		type DeployPhaseState,
		deployPhaseStates,
	} from "#lib/deploy-phases.js";

	interface Props {
		buildSource: "git" | "image";
		log: string;
		noun?: string;
		phases?: DeployPhase[];
		status: string;
		successLabel?: string;
	}

	const {
		buildSource,
		log,
		noun = "Deploy",
		phases,
		status,
		successLabel = "Deployed",
	}: Props = $props();

	const ICONS: Record<DeployPhaseId, Component> = $derived({
		config: Settings2,
		container: Box,
		health: HeartPulse,
		image: buildSource === "git" ? Hammer : Download,
		network: Route,
		ready: Rocket,
		scan: ShieldCheck,
		source: GitBranch,
		volumes: HardDrive,
	});

	const states = $derived(deployPhaseStates(log, status, buildSource, phases));
	const active = $derived(
		states.find((s) => s.state === "active" || s.state === "failed") ?? null,
	);
	const failed = $derived(status === "failed");
	const finished = $derived(status === "running" || status === "stopped");
	const settled = $derived(
		states.filter((s) => s.state === "done" || s.state === "skipped").length,
	);
	const percent = $derived(
		Math.round(
			((settled + (active && !failed ? 0.5 : 0)) / states.length) * 100,
		),
	);

	const startedAt = $state<Partial<Record<DeployPhaseId, number>>>({});
	let endedAt = $state<number | null>(null);
	let now = $state(Date.now());

	$effect(() => {
		const timer = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(timer);
	});

	$effect(() => {
		const entered = states
			.filter((s) => s.state !== "pending" && s.state !== "skipped")
			.map((s) => s.phase.id);
		const over = failed || finished;
		untrack(() => {
			const at = Date.now();
			for (const id of entered) {
				startedAt[id] ??= at;
			}
			if (over) {
				endedAt ??= at;
			}
		});
	});

	/** Seconds spent in the phase at `index`: until the next entered phase started, or until now while it runs. */
	function secondsIn(index: number): number | null {
		const start = startedAt[states[index].phase.id];
		if (start === undefined) {
			return null;
		}
		const next = states
			.slice(index + 1)
			.map((s) => startedAt[s.phase.id])
			.find((at) => at !== undefined);
		const end = next ?? endedAt ?? now;
		const seconds = Math.round((end - start) / 1000);
		return seconds >= 1 ? seconds : null;
	}

	/** `seconds` as `42s` or `3m 05s`. */
	function duration(seconds: number): string {
		if (seconds < 60) {
			return `${seconds}s`;
		}
		return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
	}

	/** The circle's colours for a phase in `state`. */
	function circleClass(state: DeployPhaseState): string {
		switch (state) {
			case "done":
				return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
			case "active":
				return "border-accent bg-accent-light text-accent ring-4 ring-accent/15";
			case "failed":
				return "border-red-500/50 bg-red-500/10 text-red-500 ring-4 ring-red-500/15";
			case "skipped":
				return "border-dashed border-border text-text-subtle";
			default:
				return "border-border bg-surface-2 text-text-subtle";
		}
	}

	/** The colour of the line leading into a phase in `state`. */
	function connectorClass(state: DeployPhaseState): string {
		if (state === "done" || state === "skipped") {
			return "bg-emerald-500/50";
		}
		if (state === "active") {
			return "bg-accent/60";
		}
		if (state === "failed") {
			return "bg-red-500/50";
		}
		return "bg-border";
	}

	/** The label's colours for a phase in `state`. */
	function labelClass(state: DeployPhaseState): string {
		switch (state) {
			case "active":
				return "text-text font-medium";
			case "failed":
				return "text-red-500 font-medium";
			case "done":
				return "text-text";
			case "skipped":
				return "text-text-subtle line-through decoration-text-subtle/50";
			default:
				return "text-text-subtle";
		}
	}
</script>

<div class="border-border border-b px-5 pt-4 pb-3">
	<div class="mb-3 flex items-center justify-between gap-3">
		<div class="flex min-w-0 items-center gap-2 text-sm">
			{#if failed}
				<XCircle class="size-4 shrink-0 text-red-500" />
				<span class="text-text font-medium">
					{noun} failed{active ? ` at ${active.phase.label.toLowerCase()}` : ""}
				</span>
			{:else if finished}
				<CheckCircle2 class="size-4 shrink-0 text-emerald-500" />
				<span class="text-text font-medium">{successLabel}</span>
			{:else if active}
				<Spinner class="size-4 shrink-0" />
				<span class="text-text font-medium">{active.phase.label}</span>
				<span class="text-text-muted truncate max-sm:hidden"
					>{active.phase.hint}</span
				>
			{:else}
				<Spinner class="size-4 shrink-0" />
				<span class="text-text-muted"
					>Waiting for the {noun.toLowerCase()} to start…</span
				>
			{/if}
		</div>
		<span class="text-text-muted shrink-0 font-mono text-xs tabular-nums"
			>{percent}%</span
		>
	</div>
	<div class="bg-surface-2 mb-4 h-1 overflow-hidden rounded-full">
		<div
			style:width="{finished ? 100 : percent}%"
			class="h-full rounded-full transition-[width] duration-500 {failed
				? 'bg-red-500'
				: finished
					? 'bg-emerald-500'
					: 'bg-accent'}"
		></div>
	</div>
	<ol class="flex overflow-x-auto pb-1">
		{#each states as { phase, state }, i (phase.id)}
			{@const Icon = ICONS[phase.id]}
			{@const seconds = secondsIn(i)}
			<li
				class="relative flex min-w-18 flex-1 flex-col items-center gap-1.5 text-center"
				title="{phase.label}: {phase.hint}{state === 'skipped'
					? ' (skipped)'
					: ''}"
			>
				{#if i > 0}
					<span
						class="absolute top-3.5 right-[calc(50%+1.125rem)] left-[calc(-50%+1.125rem)] h-px transition-colors {connectorClass(
							state,
						)}"
						aria-hidden="true"
					></span>
				{/if}
				<span
					class="relative flex size-7 items-center justify-center rounded-full border transition-all {circleClass(
						state,
					)}"
				>
					{#if state === "done"}
						<Check class="size-3.5" />
					{:else if state === "failed"}
						<X class="size-3.5" />
					{:else if state === "skipped"}
						<Minus class="size-3.5" />
					{:else}
						<Icon class="size-3.5" />
					{/if}
					{#if state === "active"}
						<span
							class="border-t-accent absolute -inset-0.75 animate-spin rounded-full border-2 border-transparent"
							aria-hidden="true"
						></span>
					{/if}
				</span>
				<span class="text-xs leading-tight {labelClass(state)}"
					>{phase.label}</span
				>
				<span class="text-text-subtle h-3 font-mono text-[10px] tabular-nums">
					{#if state === "skipped"}
						skipped
					{:else if seconds !== null}
						{duration(seconds)}
					{/if}
				</span>
			</li>
		{/each}
	</ol>
</div>
