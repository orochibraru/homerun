<script lang="ts">
	import { AlertTriangle } from "@lucide/svelte";
	import { checkImage, type ImageCheck } from "$lib/remote/image-check.remote";

	const DEBOUNCE_MS = 600;

	const {
		image,
		registryUrl = "",
		registryUsername = "",
		tag,
	}: {
		image: string;
		registryUrl?: string;
		registryUsername?: string;
		tag: string;
	} = $props();

	let result = $state<ImageCheck | null>(null);

	$effect(() => {
		const args = { image, registryUrl, registryUsername, tag };
		if (!args.image.trim()) {
			result = null;
			return;
		}
		const timer = setTimeout(async () => {
			try {
				result = await checkImage(args);
			} catch {
				result = null;
			}
		}, DEBOUNCE_MS);
		return () => clearTimeout(timer);
	});
</script>

{#if result?.checked && !result.exists}
  <div
    class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400"
  >
    <AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
    <span>
      <strong>{image}:{tag}</strong>
      wasn't found in its registry. You can still save : this doesn't block
      deploying, in case you're still preparing the image.
    </span>
  </div>
{/if}
