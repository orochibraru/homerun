<script lang="ts">
	import { resolve } from "$app/paths";
	import { Button } from "@orochibraru/ui/button";

	import Alert from "#lib/components/alert.svelte";
	import CodeBlock from "#lib/components/code-block.svelte";

	const { data } = $props();

	const settingsHref = $derived(
		resolve("/(protected)/package-registries/[kind]/settings", {
			kind: data.kind,
		}),
	);
	const newTokenHref = $derived(
		resolve("/(protected)/package-registries/[kind]/tokens/new", {
			kind: data.kind,
		}),
	);
</script>

{#if !data.status.enabled}
	<Alert class="mb-6" title="This registry is off.">
		Turn it on under Settings: Homerun starts its container and keeps its
		packages in a volume of their own.
		<div class="mt-3">
			<Button href={settingsHref} size="sm" variant="outline">
				Open Settings
			</Button>
		</div>
	</Alert>
{/if}

<section class="border-border bg-surface-1 mb-6 rounded-lg border p-4">
	<h2 class="text-text text-sm font-medium">Status</h2>
	<dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
		<div>
			<dt class="text-text-muted text-xs">Container</dt>
			<dd class="text-text mt-0.5">
				{data.status.enabled
					? data.status.running
						? "Running"
						: "Not running"
					: "Off"}
			</dd>
		</div>
		<div>
			<dt class="text-text-muted text-xs">Public address</dt>
			<dd class="text-text mt-0.5 font-mono text-xs">
				{data.status.publicHost
					? `https://${data.status.publicHost}/`
					: "Not published"}
			</dd>
		</div>
		<div>
			<dt class="text-text-muted text-xs">Address on the Homerun network</dt>
			<dd class="text-text mt-0.5 font-mono text-xs">
				{data.status.internalUrl}
			</dd>
		</div>
		<div>
			<dt class="text-text-muted text-xs">Tokens</dt>
			<dd class="text-text mt-0.5">{data.status.tokenCount}</dd>
		</div>
	</dl>
</section>

<section class="border-border bg-surface-1 rounded-lg border p-4">
	<div class="flex items-center justify-between gap-4">
		<h2 class="text-text text-sm font-medium">Use it</h2>
		<Button href={newTokenHref} size="sm" variant="outline">New token</Button>
	</div>
	<p class="text-text-muted mt-1 mb-4 text-sm">
		Every request needs a token, installs included. Create one under Tokens: its
		page shows these snippets with the token already filled in.
		{#if !data.status.publicHost}
			Until the registry is published at a hostname, only services on the
			Homerun network reach it, at the address below.
		{/if}
	</p>
	<div class="grid gap-4 xl:grid-cols-2">
		{#each data.snippets as snippet (snippet.title)}
			<div class="min-w-0">
				<p class="text-text-muted mb-1.5 text-xs font-medium">
					{snippet.title}
				</p>
				<CodeBlock
					code={snippet.code}
					html={snippet.html}
					label={snippet.title}
				/>
			</div>
		{/each}
	</div>
</section>
