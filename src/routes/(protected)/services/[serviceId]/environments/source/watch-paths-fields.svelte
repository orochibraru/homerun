<script lang="ts">
	import { Textarea } from "#lib/components/ui/textarea/index.js";

	interface Props {
		errorClass: string;
		errors: Record<string, string[]> | undefined;
		/** The ignore paths, one per line. */
		ignore: string;
		labelClass: string;
		/** The watch paths, one per line. */
		watch: string;
	}

	const { errorClass, errors, ignore, labelClass, watch }: Props = $props();
</script>

<div class="grid gap-4 md:grid-cols-2">
  <div>
    <label class={labelClass} for="gitWatchPaths">Watch paths</label>
    <Textarea
      class="font-mono text-xs"
      id="gitWatchPaths"
      name="gitWatchPaths"
      placeholder={"apps/api/**\npackages/shared"}
      rows={3}
      value={watch}
    />
    <p class="text-text-subtle mt-1.5 text-xs">
      One glob per line. A push deploys only when it changes a file matching
      one. Empty watches every file.
    </p>
    {#if errors?.gitWatchPaths}
      <p class={errorClass}>{errors.gitWatchPaths[0]}</p>
    {/if}
  </div>
  <div>
    <label class={labelClass} for="gitIgnorePaths">Ignore paths</label>
    <Textarea
      class="font-mono text-xs"
      id="gitIgnorePaths"
      name="gitIgnorePaths"
      placeholder={"*.md\ndocs/**"}
      rows={3}
      value={ignore}
    />
    <p class="text-text-subtle mt-1.5 text-xs">
      Files matching these never count, even when watched.
    </p>
    {#if errors?.gitIgnorePaths}
      <p class={errorClass}>{errors.gitIgnorePaths[0]}</p>
    {/if}
  </div>
</div>
<p class="text-text-subtle -mt-2 text-xs">
  Paths are relative to the repo root: <code>**</code> crosses folders,
  <code>*</code> doesn't, a pattern without a slash matches at any depth and a
  folder path covers everything under it. Only webhook pushes that list their
  files are filtered: Bitbucket pushes and branch polling always deploy.
</p>
