<script lang="ts">
	const { data } = $props();
</script>

<svelte:head>
	<title>{data.doc.title} — Homerun docs</title>
</svelte:head>

<article class="prose-doc max-w-3xl">
  {@html data.doc.html}
</article>
