<script lang="ts">
	import { ArrowLeft, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import CopyBox from "#lib/components/copy-box.svelte";
	import CopyButton from "#lib/components/copy-button.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	const { data } = $props();
	const repo = $derived(data.repository);
	const host = $derived(
		data.status.pushEndpoint ?? data.status.internalEndpoint,
	);

	onMount(() => title.set(`Registry · ${data.repository.repository}`));

	let confirmOpen = $state(false);
	let confirmTitle = $state("");
	let confirmDescription = $state("");
	let confirmForm: HTMLFormElement | null = null;

	function requestConfirm(
		event: MouseEvent,
		heading: string,
		description: string,
	) {
		confirmForm = (event.currentTarget as HTMLElement).closest("form");
		confirmTitle = heading;
		confirmDescription = description;
		confirmOpen = true;
	}

	function confirmPending() {
		confirmForm?.requestSubmit();
	}
</script>

<div class="space-y-5">
  <a
    class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm"
    href={resolve("/(protected)/registry")}
  >
    <ArrowLeft class="size-4" />
    All repositories
  </a>

  <section class="panel rounded-md">
    <div class="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
      <div class="min-w-0">
        <h2 class="text-text font-mono text-sm font-medium break-all">
          {repo.repository}
        </h2>
        <p class="text-text-muted mt-0.5 text-xs">
          {repo.tags.length}
          {repo.tags.length === 1 ? "tag" : "tags"}
        </p>
      </div>
      <form
        action="?/deleteRepository"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't delete that repository.",
          loading: `Deleting ${repo.repository}`,
          onSuccess: () => goto(resolve("/(protected)/registry")),
          success: "Repository deleted.",
        })}
      >
        <Button
          onclick={(event: MouseEvent) =>
            requestConfirm(
              event,
              `Delete ${repo.repository}?`,
              "Deletes every tag in it. A service already running one of these images keeps running, but nothing can pull it again until it's mirrored or pushed back.",
            )}
          size="sm"
          type="button"
          variant="outline"
        >
          <Trash2 class="size-3.5" />
          Delete repository
        </Button>
      </form>
    </div>
    <div class="grid gap-4 px-5 py-4 text-sm md:grid-cols-2">
      <div>
        <p class="text-text-subtle mb-1.5 text-xs">Pull</p>
        <CopyBox
          label="pull command"
          truncate
          value="docker pull {host}/{repo.repository}:{repo.tags[0]?.tag ?? 'latest'}"
        />
      </div>
      <div>
        <p class="text-text-subtle mb-1.5 text-xs">Used by</p>
        {#if repo.usedBy.length > 0}
          <p class="flex flex-wrap gap-x-3 gap-y-1">
            {#each repo.usedBy as svc (svc.id)}
              <a
                class="text-accent hover:underline"
                href={resolve("/(protected)/services/[serviceId]", {
                  serviceId: svc.id,
                })}
              >
                {svc.name}
              </a>
            {/each}
          </p>
        {:else}
          <p class="text-text-muted">Not referenced by any service</p>
        {/if}
      </div>
    </div>
  </section>

  <div class="panel overflow-x-auto rounded-md">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
          <th class="px-4 py-3 font-medium">Tag</th>
          <th class="hidden px-4 py-3 font-medium md:table-cell">Digest</th>
          <th class="px-4 py-3"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {#each repo.tags as tag (tag.tag)}
          {@const reference = `${host}/${repo.repository}:${tag.tag}`}
          <tr class="border-border/60 hover:bg-surface-2 border-b last:border-0">
            <td class="px-4 py-2.5">
              <span class="text-text font-mono break-all">{tag.tag}</span>
            </td>
            <td class="text-text-muted hidden px-4 py-2.5 font-mono text-xs md:table-cell">
              {#if tag.digest}
                <span class="inline-flex items-center gap-1" title={tag.digest}>
                  {tag.digest.slice(0, 19)}
                  <CopyButton class="p-0.5" label="digest" value={tag.digest} />
                </span>
              {:else}
                —
              {/if}
            </td>
            <td class="px-4 py-2.5">
              <div class="flex items-center justify-end gap-1">
                <CopyButton label="image reference" value={reference} />
                <form
                  action="?/deleteTag"
                  method="POST"
                  use:enhance={enhanceToast({
                    error: "Couldn't delete that tag.",
                    loading: `Deleting ${repo.repository}:${tag.tag}`,
                    success: "Tag deleted.",
                  })}
                >
                  <input name="tag" type="hidden" value={tag.tag} />
                  <Button
                    aria-label="Delete {tag.tag}"
                    onclick={(event: MouseEvent) =>
                      requestConfirm(
                        event,
                        `Delete ${repo.repository}:${tag.tag}?`,
                        "Registry deletes work on the manifest, so any other tag pointing at the same image goes with it.",
                      )}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 class="size-3.5" />
                  </Button>
                </form>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  confirmLabel="Delete"
  description={confirmDescription}
  onConfirm={confirmPending}
  title={confirmTitle}
/>
