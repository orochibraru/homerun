<script lang="ts">
	import { Server } from "@lucide/svelte";

	import LaneStrip from "#lib/components/lane-strip.svelte";
	import type { DetectedConfig } from "#lib/image-config.js";
	import { defaultHostname } from "#lib/service-domains.js";

	interface Props {
		buildSource: "git" | "image";
		detected: DetectedConfig | null;
		image: string;
		serviceDomain: string;
		slug: string;
		stackSlug: string | null;
		tag: string;
	}

	const {
		buildSource,
		detected,
		image,
		serviceDomain,
		slug,
		stackSlug,
		tag,
	}: Props = $props();

	const rows = $derived([
		{
			label: "source",
			value:
				buildSource === "git"
					? "git repository"
					: image
						? `${image.split("/").pop()}:${tag || "latest"}`
						: null,
		},
		{
			label: "url",
			value: slug ? defaultHostname(slug, stackSlug, serviceDomain) : null,
		},
		{
			label: "port",
			value: detected?.ports[0] ? String(detected.ports[0].port) : null,
		},
		{
			label: "volumes",
			value: detected?.volumes.length ? String(detected.volumes.length) : null,
		},
		{
			label: "env",
			value:
				detected && Object.keys(detected.env).length
					? `${Object.keys(detected.env).length} from the image`
					: null,
		},
		{ label: "health", value: detected?.healthcheck ?? null },
	]);
</script>

<aside class="space-y-4">
	<p class="text-text-muted text-xs font-medium">Preview</p>
	<div class="border-border bg-surface space-y-2 rounded-lg border p-3">
		<p class="flex items-center gap-2 text-sm">
			<Server class="text-text-subtle size-4 shrink-0" />
			<span class="text-text min-w-0 flex-1 truncate font-medium"
				>{slug || "New service"}</span
			>
			<span class="text-text-subtle font-mono text-[0.6875rem]">draft</span>
		</p>
		<LaneStrip class="h-2.5" stopped />
	</div>
	<dl
		class="border-border bg-surface grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg border p-3 font-mono text-xs"
	>
		{#each rows as row (row.label)}
			<dt class="text-text-muted">{row.label}</dt>
			<dd
				class="truncate {row.value ? 'text-accent' : 'text-text-subtle italic'}"
			>
				{row.value ?? "not set yet"}
			</dd>
		{/each}
	</dl>
	<p class="text-text-subtle text-xs">
		Nothing is created until you click Create on the Review step.
	</p>
</aside>
