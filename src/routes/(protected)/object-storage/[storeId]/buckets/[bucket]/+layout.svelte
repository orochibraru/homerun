<script lang="ts">
	import { ArrowLeft, FolderOpen, Settings } from "@lucide/svelte";
	import ErrorBoundary from "#lib/components/error-boundary.svelte";
	import SectionNav from "#lib/components/section-nav.svelte";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";

	const { children } = $props();

	const params = $derived({
		bucket: page.params.bucket ?? "",
		storeId: page.params.storeId ?? "",
	});
	const sections = $derived([
		{
			href: resolve(
				"/(protected)/object-storage/[storeId]/buckets/[bucket]",
				params,
			),
			icon: Settings,
			label: "Settings",
		},
		{
			href: resolve(
				"/(protected)/object-storage/[storeId]/buckets/[bucket]/files",
				params,
			),
			icon: FolderOpen,
			label: "Files",
		},
	]);
</script>

<a
  class="text-text-muted hover:text-text mb-5 inline-flex items-center gap-1 text-sm"
  href={resolve("/(protected)/object-storage")}
>
  <ArrowLeft class="size-4" />
  All buckets
</a>

<div>
  <SectionNav label="Bucket sections" {sections} />
  <ErrorBoundary title="This section hit an error while rendering.">
    {@render children()}
  </ErrorBoundary>
</div>
