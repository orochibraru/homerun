<script lang="ts">
	import { ArrowLeft, ArrowRight, Plus, Rocket, X } from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";

	interface Props {
		currentStep: number;
		stepCount: number;
		submittingAction: "create" | "createAndDeploy" | null;
	}

	let {
		currentStep = $bindable(),
		stepCount,
		submittingAction,
	}: Props = $props();
</script>

<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between sm:gap-3">
  <div class="flex flex-col max-sm:empty:hidden sm:block">
    {#if currentStep > 0}
      <Button
        onclick={() => {
          currentStep = Math.max(currentStep - 1, 0);
        }}
        variant="outline"
      >
        <ArrowLeft class="size-4" />
        Back
      </Button>
    {/if}
  </div>
  <div class="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
    <Button href={resolve("/services")} variant="outline">
      <X class="size-4" />
      Cancel
    </Button>
    {#if currentStep < stepCount - 1}
      <Button
        onclick={() => {
          currentStep = Math.min(currentStep + 1, stepCount - 1);
        }}
      >
        Next
        <ArrowRight class="size-4" />
      </Button>
    {:else}
      <Button
        disabled={submittingAction !== null}
        formaction="?/create"
        type="submit"
        variant="outline"
      >
        {#if submittingAction === "create"}
          <Spinner />
          Creating…
        {:else}
          <Plus class="size-4" />
          Create service
        {/if}
      </Button>
      <Button
        disabled={submittingAction !== null}
        formaction="?/createAndDeploy"
        type="submit"
      >
        {#if submittingAction === "createAndDeploy"}
          <Spinner />
          Creating…
        {:else}
          <Rocket class="size-4" />
          Create and Deploy
        {/if}
      </Button>
    {/if}
  </div>
</div>
