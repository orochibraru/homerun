<script lang="ts">
	import { Cpu } from "@lucide/svelte";
	import { onMount } from "svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { Input } from "#lib/components/ui/input/index.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	const { data, form } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Compute`));

	const label = "block mb-1.5 text-sm font-medium text-text";
	const errorClass = "mt-1.5 text-xs text-red-500";

	const values = $derived(
		(form?.values as Record<string, string> | undefined) ?? {
			cpuLimit: svc.cpuLimit ?? "",
			memoryLimitMb: svc.memoryLimitMb ? String(svc.memoryLimitMb) : "",
			replicas: String(svc.replicas ?? 1),
		},
	);
	const errors = $derived(form?.errors as Record<string, string[]> | undefined);

	let submitting = $state(false);
</script>

<section class="panel rounded-md">
  <PanelHeader
    description="Resource limits and autoscaling. Changes take effect on the next deploy."
    icon={Cpu}
    title="Compute"
  >
    {#snippet trailing()}
      <SaveButton form="compute-settings" pending={submitting} />
    {/snippet}
  </PanelHeader>

  <form
    id="compute-settings"
    action="?/updateCompute"
    class="space-y-5 p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Check the form for errors.",
      loading: "Saving compute settings",
      onSettled: () => {
        submitting = false;
      },
      onStart: () => {
        submitting = true;
      },
      success: "Saved.",
    })}
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

    {#if data.orchestrationMode === "swarm"}
      <div>
        <label class={label} for="replicas">Replicas</label>
        <Input
          id="replicas"
          min="0"
          name="replicas"
          type="number"
          value={values.replicas}
        />
        <p class="mt-1.5 text-xs text-text-subtle">
          Swarm mode only. 0 : same as stopping the service.
        </p>
        {#if errors?.replicas}
          <p class={errorClass}>{errors.replicas[0]}</p>
        {/if}
      </div>
    {/if}
  </form>
</section>
