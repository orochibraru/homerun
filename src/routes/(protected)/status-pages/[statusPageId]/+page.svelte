<script lang="ts">
	import {
		Activity,
		ArrowLeft,
		ExternalLink,
		Save,
		Trash2,
	} from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import CopyBox from "$lib/components/copy-box.svelte";
	import HeartbeatStrip from "$lib/components/heartbeat-strip.svelte";
	import StatusPageFields from "$lib/components/status-page-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import type { StatusPageScope } from "$lib/types";

	const { data, form } = $props();

	const page = $derived(data.statusPage);

	onMount(() => title.set(`${data.statusPage.name} · Status Page`));

	let name = $state(untrack(() => data.statusPage.name));
	let slug = $state(untrack(() => data.statusPage.slug));
	let description = $state(untrack(() => data.statusPage.description ?? ""));
	let scope = $state<StatusPageScope>(untrack(() => data.statusPage.scope));
	let stackId = $state(untrack(() => data.statusPage.stackId ?? ""));
	let isPublic = $state(untrack(() => data.statusPage.isPublic));
	let selectedServiceIds = $state<string[]>(untrack(() => [...data.memberIds]));
	let saving = $state(false);

	let deleteDialogOpen = $state(false);
	let deleteForm: HTMLFormElement | null = null;

	const publicUrl = $derived(
		`${data.dashboardOrigin}${resolve("/status/[slug]", {
			slug: data.statusPage.slug,
		})}`,
	);

	function uptimeOf(beats: Array<{ ok: boolean }>): string {
		if (beats.length === 0) {
			return "—";
		}
		const pct = (beats.filter((b) => b.ok).length / beats.length) * 100;
		return `${pct.toFixed(1)}%`;
	}
</script>

<div class="p-5 md:p-6">
  <a
    class="text-text-muted hover:text-text mb-4 inline-flex items-center gap-1.5 text-sm"
    href={resolve("/status-pages")}
  >
    <ArrowLeft class="size-3.5" />
    Status Page
  </a>

  <div class="mb-6 flex flex-wrap items-center gap-3">
    <h1 class="text-text text-lg font-semibold tracking-tight">{page.name}</h1>
    {#if page.isPublic}
      <span class="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        Public
      </span>
    {:else}
      <span class="bg-surface-2 text-text-muted rounded-md px-2 py-0.5 text-xs font-medium">
        Private
      </span>
    {/if}
  </div>

  {#if page.isPublic}
    <div class="mb-6 flex flex-wrap items-center gap-3">
      <CopyBox class="min-w-0 flex-1" label="the public URL" value={publicUrl} />
      <Button
        href={resolve("/status/[slug]", { slug: page.slug })}
        target="_blank"
        variant="outline"
      >
        <ExternalLink class="size-4" />
        Open
      </Button>
    </div>
  {/if}

  {#if form?.error}
    <Alert class="mb-6">{form.error}</Alert>
  {/if}

  <section class="panel mb-6 rounded-md">
    <div class="panel-head">
      <h2 class="eyebrow flex items-center gap-1.5">
        <Activity class="size-3" />
        Tracked services
      </h2>
      <span class="text-text-subtle text-[0.6875rem]">
        Last {data.beatWindow} internal probes
      </span>
    </div>
    {#if data.tracked.length === 0}
      <p class="text-text-muted px-5 py-6 text-center text-xs">
        This page doesn't cover any services yet.
      </p>
    {:else}
      <div class="divide-border divide-y">
        {#each data.tracked as svc (svc.id)}
          <div class="flex items-center gap-4 px-5 py-3">
            <div class="min-w-0 flex-1">
              <a
                class="text-text truncate text-sm font-medium hover:underline"
                href="{resolve('/services')}/{svc.id}"
              >
                {svc.name}
              </a>
              <HeartbeatStrip beats={svc.beats} class="mt-2" />
            </div>
            <span class="text-text-muted shrink-0 text-xs tabular-nums">
              {uptimeOf(svc.beats)}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <form
    action="?/update"
    class="panel space-y-6 rounded-md p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't save the status page.",
      loading: "Saving the status page",
      onSettled: () => {
        saving = false;
      },
      onStart: () => {
        saving = true;
      },
      success: "Status page saved.",
    })}
  >
    <StatusPageFields
      bind:name
      bind:slug
      bind:description
      bind:scope
      bind:stackId
      bind:isPublic
      bind:selectedServiceIds
      errors={form?.errors}
      stacks={data.stacks}
      services={data.services}
    />

    <div class="flex justify-end">
      <Button disabled={saving} type="submit">
        <Save class="size-4" />
        Save changes
      </Button>
    </div>
  </form>

  <section class="bg-surface mt-6 rounded-md border border-red-200 dark:border-red-900/40">
    <div class="flex items-center gap-3 border-b border-red-100 px-5 py-4 dark:border-red-900/30">
      <span class="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600">
        <Trash2 class="size-4" />
      </span>
      <div>
        <h2 class="text-sm font-semibold text-red-600 dark:text-red-400">
          Delete this status page
        </h2>
        <p class="text-text-muted text-xs">
          The services it tracks are untouched. Any public link stops working.
        </p>
      </div>
      <form
        action="?/delete"
        bind:this={deleteForm}
        class="ml-auto"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't delete the status page.",
          loading: "Deleting the status page",
          success: "Status page deleted.",
        })}
      >
        <Button
          onclick={() => {
            deleteDialogOpen = true;
          }}
          type="button"
          variant="destructive"
        >
          Delete status page
        </Button>
      </form>
    </div>
  </section>
</div>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete"
  confirmPhrase={page.name}
  description="This removes the status page and its public URL. The services it tracks are untouched."
  onConfirm={() => deleteForm?.requestSubmit()}
  title="Delete {page.name}?"
/>
