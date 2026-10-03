<script lang="ts">
	import type { HTMLTextareaAttributes } from "svelte/elements";
	import { type HighlightLanguage, loadHighlighter } from "#lib/highlight.js";

	const MAX_HIGHLIGHT_CHARS = 200_000;

	let {
		value = $bindable(""),
		language,
		...rest
	}: HTMLTextareaAttributes & {
		value?: string;
		language: HighlightLanguage | null;
	} = $props();

	let highlighter = $state<((code: string) => string) | null>(null);

	$effect(() => {
		const lang = language;
		highlighter = null;
		if (!lang) {
			return;
		}
		let live = true;
		loadHighlighter(lang)
			.then((fn) => {
				if (live) {
					highlighter = fn;
				}
			})
			.catch(() => undefined);
		return () => {
			live = false;
		};
	});

	const html = $derived(
		highlighter && value.length <= MAX_HIGHLIGHT_CHARS
			? highlighter(value)
			: null,
	);
</script>

<div class="code panel focus-within:border-accent grid min-h-112 rounded-md font-mono text-[0.8125rem] leading-relaxed">
  <pre
    class="pointer-events-none m-0 p-3 wrap-anywhere whitespace-pre-wrap [grid-area:1/1]"
    aria-hidden="true"
  >{#if html !== null}{@html html}{:else}{value}{/if}{"\n "}</pre>
  <textarea
    class="caret-text w-full resize-none overflow-hidden border-0 bg-transparent p-3 wrap-anywhere whitespace-pre-wrap text-transparent [grid-area:1/1] focus:ring-0 focus:outline-none"
    spellcheck="false"
    bind:value
    {...rest}
  ></textarea>
</div>

<style>
	.code {
		color: var(--color-text);
		tab-size: 4;
	}
	.code textarea,
	.code textarea:focus {
		background: transparent;
		border: 0;
		border-radius: 0;
		box-shadow: none;
	}
	.code textarea::selection {
		background: var(--color-accent-glow);
	}
	.code :global(:is(.hljs-comment, .hljs-quote)) {
		color: var(--color-text-subtle);
		font-style: italic;
	}
	.code :global(:is(.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-doctag, .hljs-section)) {
		color: var(--color-accent);
	}
	.code :global(:is(.hljs-string, .hljs-regexp, .hljs-addition, .hljs-template-tag)) {
		color: var(--chart-4);
	}
	.code :global(:is(.hljs-number, .hljs-literal, .hljs-symbol, .hljs-bullet)) {
		color: var(--chart-5);
	}
	.code :global(:is(.hljs-title, .hljs-name, .hljs-selector-id, .hljs-selector-class, .hljs-type)) {
		color: var(--chart-3);
	}
	.code :global(:is(.hljs-attr, .hljs-attribute, .hljs-property, .hljs-variable, .hljs-template-variable, .hljs-params)) {
		color: var(--chart-2);
	}
	.code :global(:is(.hljs-meta, .hljs-deletion, .hljs-subst)) {
		color: var(--color-text-muted);
	}
	.code :global(.hljs-emphasis) {
		font-style: italic;
	}
	.code :global(.hljs-strong) {
		font-weight: 600;
	}
</style>
