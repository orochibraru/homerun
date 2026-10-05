<script lang="ts">
	import { Cpu } from "@lucide/svelte";
	import AdvancedDisclosure from "#lib/components/advanced-disclosure.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Input } from "#lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "#lib/components/ui/select/index.js";
	import { errorClass, label } from "./field-classes";
	import type { WizardTemplate } from "./wizard-types";

	interface Props {
		collapsible: boolean;
		errors?: Record<string, string[]>;
		hidden: boolean;
		template: WizardTemplate | null;
		values?: Record<string, string>;
	}

	const { collapsible, errors, hidden, template, values }: Props = $props();

	let restartPolicy = $derived(
		values?.restartPolicy ?? template?.restartPolicy ?? "unless-stopped",
	);
	let cpuLimit = $derived(values?.cpuLimit ?? template?.cpuLimit ?? "");
	let memoryLimitMb = $derived(
		values?.memoryLimitMb ?? String(template?.memoryLimitMb ?? ""),
	);

	const restartPolicyOptions: [string, string][] = [
		["unless-stopped", "Unless stopped"],
		["always", "Always"],
		["on-failure", "On failure"],
		["no", "Never"],
	];
	const restartPolicyLabel = $derived(
		restartPolicyOptions.find(([val]) => val === restartPolicy)?.[1] ??
			"Unless stopped",
	);
</script>

<section class="rounded-md panel" class:hidden>
  <PanelHeader icon={Cpu} title="Compute" />
  <div class="space-y-5 p-5">
    {#if collapsible}
      <p class="text-text-muted text-sm">
        Restart policy {restartPolicyLabel.toLowerCase()}, CPU
        {cpuLimit ? `${cpuLimit} cores` : "unlimited"}, memory
        {memoryLimitMb ? `${memoryLimitMb} MB` : "unlimited"}. Change it here
        or later on the service's Container tab.
      </p>
    {/if}
    <AdvancedDisclosure {collapsible} description="Restart policy and limits">
      <div>
        <label class={label} for="restartPolicy"> Restart policy </label>
        <SelectRoot
          name="restartPolicy"
          type="single"
          bind:value={restartPolicy}
        >
          <SelectTrigger class="w-full" id="restartPolicy">
            {restartPolicyLabel}
          </SelectTrigger>
          <SelectContent>
            {#each restartPolicyOptions as [val, lbl] (val)}
              <SelectItem label={lbl} value={val} />
            {/each}
          </SelectContent>
        </SelectRoot>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class={label} for="cpuLimit"> CPU limit </label>
          <Input
            id="cpuLimit"
            name="cpuLimit"
            placeholder="e.g. 0.5 (cores)"
            type="text"
            bind:value={cpuLimit}
          />
          {#if errors?.cpuLimit}
            <p class={errorClass}>{errors.cpuLimit[0]}</p>
          {/if}
        </div>
        <div>
          <label class={label} for="memoryLimitMb"> Memory limit (MB) </label>
          <Input
            id="memoryLimitMb"
            min="1"
            name="memoryLimitMb"
            placeholder="e.g. 512"
            type="number"
            bind:value={memoryLimitMb}
          />
          {#if errors?.memoryLimitMb}
            <p class={errorClass}>{errors.memoryLimitMb[0]}</p>
          {/if}
        </div>
      </div>
      <p class="text-xs text-text-subtle">Leave blank for unlimited.</p>
    </AdvancedDisclosure>
  </div>
</section>
