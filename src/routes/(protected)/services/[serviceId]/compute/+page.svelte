<script lang="ts">
	import { Check, Cpu } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import CheckBox from "$lib/components/check-box.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";

	const { data, form } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Compute`));

	const label = "block mb-1.5 text-sm font-medium text-text";
	const errorClass = "mt-1.5 text-xs text-red-500";

	const values = $derived(
		(form?.values as Record<string, string> | undefined) ?? {
			cpuLimit: svc.cpuLimit ?? "",
			memoryLimitMb: svc.memoryLimitMb ? String(svc.memoryLimitMb) : "",
		},
	);
	const errors = $derived(form?.errors as Record<string, string[]> | undefined);

	let submitting = $state(false);

	const autoscaleReady = $derived(
		data.autoscale.autoscaleEnabled &&
			!!data.autoscale.autoscaleOverflowRemoteHostId,
	);
</script>

<section class="border-border bg-surface rounded-2xl border">
  <div class="border-border flex items-center gap-3 border-b px-5 py-4">
    <div
      class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
    >
      <Cpu class="size-4" />
    </div>
    <div>
      <h2 class="text-text text-sm font-semibold">Compute</h2>
      <p class="text-text-muted text-xs">
        Resource limits and autoscaling. Changes take effect on the next
        deploy.
      </p>
    </div>
  </div>

  <form
    action="?/updateCompute"
    class="space-y-5 p-5"
    method="POST"
    use:enhance={() => {
      submitting = true;
      return async ({ result, update }) => {
        submitting = false;
        if (result.type === "success") {
          toast.success("Saved.", {
            description: "Changes take effect on the next deploy.",
          });
        } else if (result.type === "failure") {
          toast.error("Check the form for errors.");
        }
        await update();
      };
    }}
  >
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class={label} for="cpuLimit">CPU limit</label>
        <Input
          id="cpuLimit"
          name="cpuLimit"
          placeholder="e.g. 0.5 (cores)"
          type="text"
          value={values.cpuLimit}
        />
        {#if errors?.cpuLimit}
          <p class={errorClass}>{errors.cpuLimit[0]}</p>
        {/if}
      </div>
      <div>
        <label class={label} for="memoryLimitMb">Memory limit (MB)</label>
        <Input
          id="memoryLimitMb"
          min="1"
          name="memoryLimitMb"
          placeholder="e.g. 512"
          type="number"
          value={values.memoryLimitMb}
        />
        {#if errors?.memoryLimitMb}
          <p class={errorClass}>{errors.memoryLimitMb[0]}</p>
        {/if}
      </div>
    </div>

    <div class="border-border border-t pt-4">
      <CheckBox
        checked={svc.autoscaleEligible}
        helperText="Let the instance's autoscale scheduler migrate this service onto the configured overflow remote host when the local host is over its resource threshold : moves the service, doesn't run a second copy of it"
        id="autoscaleEligible"
        label="Autoscale-eligible"
        name="autoscaleEligible"
      />
      {#if svc.autoscaleEligible && !autoscaleReady}
        <p class="mt-2 text-xs text-amber-600">
          ⚠ Autoscaling isn't fully configured instance-wide yet (enable it
          and pick an overflow remote host on
          <a class="underline" href={resolve("/settings")}>Settings</a>) : this
          toggle won't do anything until then.
        </p>
      {/if}
    </div>

    <div class="flex justify-end">
      <Button disabled={submitting} type="submit">
        {#if submitting}
          <Spinner />
          Saving…
        {:else}
          <Check class="size-4" />
          Save
        {/if}
      </Button>
    </div>
  </form>
</section>
