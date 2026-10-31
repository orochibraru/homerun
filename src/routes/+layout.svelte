<script lang="ts">
	import "./layout.css";
	import { browser } from "$app/env";
	import { onNavigate } from "$app/navigation";
	import { page } from "$app/state";
	import { Toaster } from "@orochibraru/ui/sonner";
	import * as Tooltip from "@orochibraru/ui/tooltip";
	import { ModeWatcher } from "mode-watcher";
	import { onMount } from "svelte";

	import ErrorBoundary from "#lib/components/error-boundary.svelte";
	import TopLoadingBar from "#lib/components/top-loading-bar.svelte";
	import { title } from "#lib/store/title.js";

	const { children } = $props();

	onMount(() => {
		document.documentElement.dataset.hydrated = "";
	});

	onNavigate((navigation) => {
		if (navigation.shallow) {
			return;
		}

		if (!browser) {
			return;
		}

		if (!document.startViewTransition) {
			return;
		}

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:head>
	<title
		>{page.data.branding?.brandName ?? "Homerun"} - {$title ?? "Home"}</title
	>
</svelte:head>

<TopLoadingBar />
<ModeWatcher />
<svelte:element
	this={page.route.id?.startsWith("/(protected)") ? "div" : "main"}
>
	<Tooltip.Provider delayDuration={300}>
		<ErrorBoundary class="p-5 md:p-6">
			{@render children()}
		</ErrorBoundary>
	</Tooltip.Provider>
</svelte:element>
<Toaster closeButton position="bottom-right" />
