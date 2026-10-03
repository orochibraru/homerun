<script lang="ts">
	import "./layout.css";
	import { ModeWatcher } from "mode-watcher";
	import TopLoadingBar from "#lib/components/top-loading-bar.svelte";
	import { Toaster } from "#lib/components/ui/sonner/index.js";
	import { title } from "#lib/store/title.js";
	import { browser } from "$app/env";
	import { onNavigate } from "$app/navigation";

	const { children } = $props();

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
	<title>Homerun - {$title ?? "Home"}</title>
</svelte:head>

<TopLoadingBar />
<ModeWatcher />
<main>
	{@render children()}
</main>
<Toaster closeButton position="bottom-right" richColors />
