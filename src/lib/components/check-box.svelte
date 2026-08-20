<script lang="ts">
	import { Checkbox } from "$lib/components/ui/checkbox/index.js";
	import { Label } from "$lib/components/ui/label/index.js";

	interface Props {
		checked: boolean;
		helperText: string;
		id: string;
		label: string;
		name: string;
	}

	let {
		id,
		label,
		helperText,
		name,
		checked = $bindable(false),
	}: Props = $props();
</script>

<Label
  class="flex items-start gap-3 rounded-xl border p-3 hover:bg-muted/50 has-aria-checked:border-accent has-aria-checked:bg-accent-light"
>
  <Checkbox {id} {name} bind:checked />
  <div class="grid gap-1.5 font-normal">
    <p class="text-sm leading-none font-medium">
      {label}
    </p>
    <p class="text-sm text-muted-foreground">
      {helperText}
    </p>
  </div>
</Label>
