<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
		description: string;
		hidden: boolean;
		title: string;
	}

	const { children, description, hidden, title }: Props = $props();
</script>

<section class="space-y-5 rounded-md panel p-6" class:hidden>
  <div class="border-b border-border pb-4">
    <h2 class="text-text text-base font-semibold tracking-tight">{title}</h2>
    <p class="text-text-muted mt-1 text-sm">{description}</p>
  </div>
  {@render children()}
</section>
