<script lang="ts">
	const { level }: { level: string } = $props();

	const tone = $derived(
		{
			debug: "border-border text-text-muted",
			error: "border-red-500/40 text-red-600 dark:text-red-400",
			fatal: "border-red-600/60 bg-red-500/10 text-red-700 dark:text-red-300",
			info: "border-sky-500/40 text-sky-600",
			warning: "border-amber-500/40 text-amber-600",
		}[level] ?? "border-border text-text-muted",
	);
</script>

<span
  class="inline-flex shrink-0 items-center rounded-sm border px-1.5 py-px text-[0.625rem] font-semibold tracking-[0.08em] uppercase {tone}"
>
  {level}
</span>
