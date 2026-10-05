<script lang="ts">
	import "./layout.css";
	import { ModeWatcher } from "mode-watcher";
	import { onMount } from "svelte";
	import TopLoadingBar from "#lib/components/top-loading-bar.svelte";
	import { Toaster } from "#lib/components/ui/sonner/index.js";
	import { title } from "#lib/store/title.js";
	import { browser } from "$app/env";
	import { onNavigate } from "$app/navigation";
	import { page } from "$app/state";

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
	<title>{page.data.branding?.brandName ?? "Homerun"} - {$title ?? "Home"}</title>
</svelte:head>

<TopLoadingBar />
<ModeWatcher />
<svelte:element this={page.route.id?.startsWith("/(protected)") ? "div" : "main"}>
	{@render children()}
</svelte:element>
<Toaster closeButton position="bottom-right" richColors />
