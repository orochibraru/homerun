<script lang="ts">
	import {
		BUILD_METHOD_DESCRIPTIONS,
		BUILD_METHOD_LABELS,
		BUILD_METHODS,
		type BuildMethod,
	} from "$lib/build-methods";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";

	let {
		labelClass,
		value = $bindable("dockerfile"),
	}: { labelClass: string; value?: BuildMethod } = $props();
</script>

<div>
  <label class={labelClass} for="gitBuildMethod">Build method</label>
  <SelectRoot name="gitBuildMethod" type="single" bind:value>
    <SelectTrigger id="gitBuildMethod">{BUILD_METHOD_LABELS[value]}</SelectTrigger>
    <SelectContent>
      {#each BUILD_METHODS as method (method)}
        <SelectItem label={BUILD_METHOD_LABELS[method]} value={method} />
      {/each}
    </SelectContent>
  </SelectRoot>
  <p class="text-text-muted mt-1.5 text-xs">{BUILD_METHOD_DESCRIPTIONS[value]}</p>
</div>
