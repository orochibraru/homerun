<script lang="ts">
  import "./layout.css";
  import { ModeWatcher } from "mode-watcher";
  import { browser } from "$app/environment";
  import { onNavigate } from "$app/navigation";
  import { Toaster } from "$lib/components/ui/sonner";
  import { title } from "$lib/store/title";

  const { children } = $props();

  onNavigate((navigation) => {
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
  <title>Local Run - {$title ?? "Home"}</title>
</svelte:head>

<ModeWatcher defaultMode="light" />
<main>
  {@render children()}
</main>
<Toaster closeButton position="top-center" richColors />
