<script lang="ts">
	import { environmentLabel } from "$lib/release-channels";

	const { environment }: { environment: string } = $props();

	const tone = $derived(
		{
			canary: "border-amber-500/40 text-amber-600",
			preview: "border-sky-500/40 text-sky-600",
			production: "border-border text-text-muted",
		}[environment] ?? "border-violet-500/40 text-violet-600",
	);
</script>

<span
  class="inline-flex items-center rounded-sm border px-1.5 py-px text-[0.625rem] font-semibold tracking-[0.08em] uppercase {tone}"
>
  {environmentLabel(environment)}
</span>
