<script lang="ts">
	import { ArrowRight } from "@lucide/svelte";

	import type { StepperStep } from "#lib/components/stepper.svelte";

	const {
		activeStep,
		onselect,
		reachableStep,
		steps,
	}: {
		activeStep: number;
		onselect: (step: number) => void;
		reachableStep: number;
		steps: StepperStep[];
	} = $props();
</script>

<div class="sm:hidden" data-slot="stepper-mobile">
	<div class="flex gap-1.5">
		{#each steps as step, i (step.label)}
			<button
				class="h-1.5 flex-1 rounded-full transition-colors duration-300 disabled:cursor-not-allowed {i <=
				activeStep
					? 'bg-accent'
					: i <= reachableStep
						? 'bg-accent/30'
						: 'bg-surface-2'}"
				aria-current={i === activeStep ? "step" : undefined}
				aria-label="Step {i + 1}: {step.label}"
				disabled={i > reachableStep}
				onclick={() => onselect(i)}
				type="button"
			></button>
		{/each}
	</div>
	{#if steps[activeStep]}
		{@const current = steps[activeStep]}
		{@const CurrentIcon = current.icon}
		<div class="mt-4 flex items-center gap-3">
			<span
				class="bg-accent-light text-accent flex size-10 shrink-0 items-center justify-center rounded-xl"
			>
				{#if CurrentIcon}
					<CurrentIcon class="size-5" />
				{:else}
					<span class="text-sm font-semibold">{activeStep + 1}</span>
				{/if}
			</span>
			<div class="min-w-0">
				<p
					class="text-text-subtle text-[0.6875rem] font-medium tracking-wide uppercase"
				>
					Step {activeStep + 1} of {steps.length}
				</p>
				<p class="text-text text-base leading-tight font-semibold">
					{current.label}
				</p>
			</div>
		</div>
		{#if current.description}
			<p class="text-text-muted mt-2 text-sm">{current.description}</p>
		{/if}
		{#if steps[activeStep + 1]}
			<p class="text-text-subtle mt-1.5 flex items-center gap-1 text-xs">
				Next: {steps[activeStep + 1].label}
				<ArrowRight class="size-3" />
			</p>
		{/if}
	{/if}
</div>
