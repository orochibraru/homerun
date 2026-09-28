<script lang="ts">
	import { FileCode, Trash2 } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import CopyBox from "$lib/components/copy-box.svelte";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import type { SourceMapRelease } from "$lib/dto/error-source-map-dto";
	import { timeAgo } from "$lib/formatting";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		releases: SourceMapRelease[];
		serviceId: string;
	}

	const { releases, serviceId }: Props = $props();

	let deleting = $state<string | null>(null);
	let confirming = $state(false);
	let deleteForm = $state<HTMLFormElement | undefined>();

	/** A byte count in MiB, one decimal. */
	function mib(bytes: number): string {
		return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
	}
</script>

<section class="panel rounded-md">
  <PanelHeader
    description="Maps minified browser stack frames back to your source as errors arrive, for the release they were uploaded under. The 10 most recent releases are kept."
    icon={FileCode}
    title="Source maps"
  />
  <div class="space-y-4 p-5">
    {#if releases.length === 0}
      <p class="text-text-muted text-sm">
        None uploaded: browser errors show their minified frames as sent.
      </p>
    {:else}
      <ul class="divide-border border-border divide-y rounded-md border">
        {#each releases as release (release.release)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <code class="text-text min-w-0 flex-1 truncate font-mono text-xs">{release.release}</code>
            <span class="text-text-subtle text-xs">
              {release.files} {release.files === 1 ? "file" : "files"} · {mib(release.sizeBytes)} · {timeAgo(release.uploadedAt)}
            </span>
            <Button
              aria-label="Delete the maps of {release.release}"
              onclick={() => {
                deleting = release.release;
                confirming = true;
              }}
              size="icon-sm"
              variant="ghost"
            >
              <Trash2 class="size-4" />
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
    <div>
      <p class="text-text-muted mb-1.5 text-xs">
        Build with source maps on, then upload the build output under the release the app
        reports (SENTRY_RELEASE, a git service's commit SHA):
      </p>
      <CopyBox
        label="upload command"
        value="homerun services sourcemaps upload {serviceId} ./build --release <release>"
      />
    </div>
  </div>
</section>

<form
  action="?/deleteSourceMaps"
  method="POST"
  bind:this={deleteForm}
  use:enhance={enhanceToast({
    error: "Couldn't delete the source maps.",
    loading: "Deleting the source maps",
    success: "Source maps deleted.",
  })}
>
  <input name="release" type="hidden" value={deleting ?? ""}>
</form>

<ConfirmDialog
  confirmLabel="Delete maps"
  description="Errors of this release that arrive afterwards show their minified frames again. Errors already stored keep their mapped frames."
  onConfirm={() => deleteForm?.requestSubmit()}
  title="Delete the source maps of {deleting ?? 'this release'}?"
  bind:open={confirming}
/>
