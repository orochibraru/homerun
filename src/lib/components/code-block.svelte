<script lang="ts">
	import CopyButton from "#lib/components/copy-button.svelte";

	interface Props {
		class?: string;
		code: string;
		html: string;
		label?: string;
	}

	const { class: className = "", code, html, label = "code" }: Props = $props();
</script>

<div class="code-block border-border bg-surface-2 relative rounded-lg border {className}">
  <div class="absolute top-1.5 right-1.5">
    <CopyButton {label} value={code} />
  </div>
  {@html html}
</div>

<style>
	.code-block :global(pre.shiki) {
		margin: 0;
		overflow-x: auto;
		padding: 0.75rem 2.75rem 0.75rem 0.875rem;
		background: transparent !important;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.6;
	}

	.code-block :global(pre.shiki span) {
		color: var(--shiki-light);
	}

	:global(.dark) .code-block :global(pre.shiki span) {
		color: var(--shiki-dark);
	}
</style>
