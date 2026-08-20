<script lang="ts" module>
  export interface StepperStep {
    icon?: Component<{ class?: string }>;
    label: string;
  }
</script>

<script lang="ts">
  import { ArrowLeft, ArrowRight, Check } from "@lucide/svelte";
  import type { Component, Snippet } from "svelte";

  interface Props {
    /** Which step is currently shown — the page toggles its own step panels with this, same pattern services/new uses today. */
    activeStep: number;
    /** The step panels — the page renders every step's markup here and hides the inactive ones (e.g. class:hidden), so field state survives switching steps. */
    children: Snippet;
    /** Rendered instead of the "Next" button on the last step — the page's own real submit button (label/spinner are page-specific). */
    finish: Snippet;
    /**
     * Validates `step` (the step about to be left). Return true to allow
     * advancing. This is also where the page should mark that step
     * "attempted" for its own field-error display — nothing should render
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

  // Furthest step reached after a *successful* onNext — gates which step
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

  function stepButtonClass(i: number): string {
    if (i === activeStep) {
      return "border-accent bg-accent-light text-accent";
    }
    if (i < activeStep) {
      return "border-border text-text bg-surface-2";
    }
    return "border-border text-text-muted";
  }
</script>

<div class="space-y-6">
  <!-- ═══ Step indicator — full labeled row at sm+, compact progress bar
       below it. Two separate layouts rather than one that just hides the
       label at small widths: five equal-width pill buttons with nothing
       but a bare number in them (padding and border intact) reads as
       broken, not minimal, once there's no room for the label. ═══ -->
  <div class="hidden flex-wrap justify-center gap-1 sm:flex">
    {#each steps as step, i (step.label)}
      {@const StepIcon = step.icon}
      <button
        class="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 {stepButtonClass(
          i,
        )}"
        disabled={i > reachableStep}
        onclick={() => goToStep(i)}
        type="button"
      >
        <div
          class="flex size-5 shrink-0 items-center justify-center rounded-full text-xs {i <=
          activeStep
            ? 'bg-accent text-white'
            : 'bg-surface-2 text-text-subtle'}"
        >
          {#if i < activeStep}
            <Check class="size-3" />
          {:else}
            {i + 1}
          {/if}
        </div>
        {#if StepIcon}
          <StepIcon class="size-3.5" />
        {/if}
        {step.label}
      </button>
    {/each}
  </div>

  <div class="sm:hidden">
    <div
      class="flex items-center justify-between text-sm font-medium text-text"
    >
      <span>Step {activeStep + 1} of {steps.length}</span>
      <span class="text-text-muted">{steps[activeStep]?.label}</span>
    </div>
    <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        class="h-full rounded-full bg-accent transition-all"
        style="width: {((activeStep + 1) / steps.length) * 100}%"
      ></div>
    </div>
  </div>

  {@render children()}

  <!-- ═══ Step nav ═══ -->
  <div class="flex justify-between gap-3">
    <div>
      {#if activeStep > 0}
        <button
          class="flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-text transition-all hover:bg-surface-2"
          onclick={back}
          type="button"
        >
          <ArrowLeft class="size-4" />
          Back
        </button>
      {/if}
    </div>
    <div class="flex gap-3">
      {#if activeStep < steps.length - 1}
        <button
          class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all"
          onclick={next}
          type="button"
        >
          Next
          <ArrowRight class="size-4" />
        </button>
      {:else}
        {@render finish()}
      {/if}
    </div>
  </div>
</div>
