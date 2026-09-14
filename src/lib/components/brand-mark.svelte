<script lang="ts">
	interface Props {
		class?: string;
		size?: "lg" | "sm";
	}

	let { size = "sm", class: className = "" }: Props = $props();
</script>

<span class="inline-flex items-center gap-2.5 {className}">
  <span
    class="bg-accent relative rounded-full shadow-[0_0_12px_3px_var(--color-accent-glow)] {size
    === 'lg'
      ? 'size-2.5'
      : 'size-2'}"
  >
  </span>
  <span
    class="text-text font-mono font-semibold tracking-tight {size === 'lg'
      ? 'text-lg'
      : 'text-[0.95rem]'}"
  >
    homerun
  </span>
</span>
