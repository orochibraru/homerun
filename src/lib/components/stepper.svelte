<script lang="ts" module>
	export interface StepperStep {
		icon?: Component<{ class?: string }>;
		label: string;
	}
</script>

<script lang="ts">
  import { ArrowLeft, ArrowRight, Check } from "@lucide/svelte";
  import type { Component, Snippet } from "svelte";
  import { Button } from "$lib/components/ui/button/index.js";

  interface Props {
    /** Which step is currently shown : the page toggles its own step panels with this, same pattern services/new uses today. */
    activeStep: number;
    /** The step panels : the page renders every step's markup here and hides the inactive ones (e.g. class:hidden), so field state survives switching steps. */
    children: Snippet;
    /** Rendered instead of the "Next" button on the last step : the page's own real submit button (label/spinner are page-specific). */
    finish: Snippet;
    /**
     * Validates `step` (the step about to be left). Return true to allow
     * advancing. This is also where the page should mark that step
     * "attempted" for its own field-error display : nothing should render
     * an error before the user has actually tried to move past it.
     */
    onNext: (step: number) => boolean;
    steps: StepperStep[];
  }

  let {
    steps,
    activeStep = $bindable(0),
    onNext,
    children,
    finish,
  }: Props = $props();

  // Furthest step reached after a *successful* onNext : gates which step
  // buttons are clickable. Grows monotonically: you can always go back,
  // but never jump ahead of a step you haven't actually passed validation
  // on. This, plus onNext's own "mark attempted" contract, is what keeps a
  // field from ever showing an error before the user has tried to proceed
  // past it.
  let reachableStep = $state(0);

  function goToStep(i: number) {
    if (i <= reachableStep) {
      activeStep = i;
    }
  }

  function next() {
    if (!onNext(activeStep)) {
      return;
    }
    reachableStep = Math.max(reachableStep, activeStep + 1);
    activeStep += 1;
  }

  function back() {
    activeStep = Math.max(0, activeStep - 1);
  }

  function markerClass(i: number): string {
    if (i === activeStep) {
      return "border-accent bg-accent text-white shadow-[0_0_0_4px_var(--color-accent-light)]";
    }
    if (i < activeStep) {
      return "border-accent/40 bg-accent-light text-accent";
    }
    return "border-border bg-surface-2 text-text-subtle";
  }
</script>

<div class="space-y-7">
  <!-- ═══ Step indicator : connected markers with labels at sm+, compact
       progress bar below it. Two separate layouts rather than one that
       just hides the label at small widths: bare markers with nothing but
       a number in them read as broken, not minimal, once there's no room
       for the label. ═══ -->
  <div class="hidden items-start sm:flex">
    {#each steps as step, i (step.label)}
      {@const StepIcon = step.icon}
      <button
        class="group flex shrink-0 flex-col items-center gap-2 disabled:cursor-not-allowed"
        disabled={i > reachableStep}
        onclick={() => goToStep(i)}
        type="button"
      >
        <span
          class="flex size-9 items-center justify-center rounded-full border transition-all duration-300 {markerClass(
            i,
          )}"
        >
          {#if i < activeStep}
            <Check class="size-4" />
          {:else if StepIcon}
            <StepIcon class="size-4" />
          {:else}
            <span class="text-xs">{i + 1}</span>
          {/if}
        </span>
        <span
          class="text-[0.7rem] tracking-wide transition-colors {i
          === activeStep
            ? 'text-text'
            : 'text-text-subtle'} {i <= reachableStep
            ? 'group-hover:text-text'
            : 'opacity-60'}"
        >
          {step.label}
        </span>
      </button>
      {#if i < steps.length - 1}
        <div
          class="mt-[1.0625rem] h-0.5 flex-1 rounded-full transition-colors duration-300 {i
          < activeStep
            ? 'bg-accent/50'
            : 'bg-surface-3'}"
        >
        </div>
      {/if}
    {/each}
  </div>

  <div class="sm:hidden">
    <div class="flex items-center justify-between text-sm font-medium text-text">
      <span class="text-xs">
        Step {activeStep + 1} of {steps.length}
      </span>
      <span class="text-text-muted">{steps[activeStep]?.label}</span>
    </div>
    <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        class="h-full rounded-full bg-accent transition-all duration-300"
        style="width: {((activeStep + 1) / steps.length) * 100}%"
      ></div>
    </div>
  </div>

  {@render children()}

  <!-- ═══ Step nav ═══ -->
  <div class="flex justify-between gap-3">
    <div>
      {#if activeStep > 0}
        <Button onclick={back} variant="outline">
          <ArrowLeft class="size-4" />
          Back
        </Button>
      {/if}
    </div>
    <div class="flex gap-3">
      {#if activeStep < steps.length - 1}
        <Button onclick={next}>
          Next
          <ArrowRight class="size-4" />
        </Button>
      {:else}
        {@render finish()}
      {/if}
    </div>
  </div>
</div>
