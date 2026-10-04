<script lang="ts">
	import { Checkbox } from "#lib/components/ui/checkbox/index.js";

	let { checked = $bindable(false) }: { checked?: boolean } = $props();
</script>

<label class="flex items-start gap-3">
  <Checkbox bind:checked class="mt-0.5" />
  <span>
    <span class="text-text text-sm font-medium">Also delete volumes</span>
    <span class="text-text-subtle block text-xs">
      Volumes no other service mounts, and their data. A bind mount's host
      directory is left alone.
    </span>
  </span>
</label>
