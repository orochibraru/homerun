<script lang="ts">
  import {
    AlertTriangle,
    ArrowLeft,
    Check,
    LayoutGrid,
    Pencil,
    Plus,
    Server,
    Trash2,
  } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import StatusBadge from "$lib/components/status-badge.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import Spinner from "$lib/components/ui/spinner/spinner.svelte";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { title } from "$lib/store/title";

  const { data, form } = $props();
  const proj = $derived(data.project);

  onMount(() => title.set(proj.name));

  let editing = $state(false);
  let renaming = $state(false);
  let showDeleteConfirm = $state(false);
  let deleting = $state(false);
</script>

<div class="p-6 md:p-8">
  <a
    class="mb-4 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
    href={resolve("/projects")}
  >
    <ArrowLeft class="size-3.5" />
    Projects
  </a>

  {#if !editing}
    <div class="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-text">
          {proj.name}
        </h1>
        {#if proj.description}
          <p class="mt-1 text-sm text-text-muted">
            {proj.description}
          </p>
        {/if}
      </div>
      <div class="flex gap-2">
        <Button
          onclick={() => {
            editing = true;
          }}
          variant="outline"
        >
          <Pencil class="size-3.5" />
          Rename
        </Button>
        <Button
          href="{resolve('/templates')}?projectId={proj.id}"
          variant="outline"
        >
          <LayoutGrid class="size-3.5" />
          From Template
        </Button>
        <Button href="{resolve('/services/new')}?projectId={proj.id}">
          <Plus class="size-4" />
          Add Service
        </Button>
      </div>
    </div>
  {:else}
    <form
      action="?/rename"
      class="mb-8 space-y-4 rounded-2xl border border-border bg-surface p-5"
      method="POST"
      use:enhance={() => {
        renaming = true;
        return async ({ result, update }) => {
          renaming = false;
          if (result.type === "success") {
            editing = false;
            toast.success("Saved.");
          }
          await update();
        };
      }}
    >
      {#if form?.error}
        <p class="text-sm text-red-500">{form.error}</p>
      {/if}
      <Input name="name" required type="text" value={proj.name} />
      <Input
        class="font-mono"
        name="slug"
        pattern={"[a-z0-9-]{1,63}"}
        required
        type="text"
        value={proj.slug}
      />
      <Textarea class="resize-none" name="description" rows={2}>
        {proj.description ?? ""}
      </Textarea>

      <div class="flex justify-end gap-3">
        <Button
          onclick={() => {
            editing = false;
          }}
          variant="outline"
        >
          Cancel
        </Button>
        <Button disabled={renaming} type="submit">
          {#if renaming}
            <Spinner />
          {:else}
            <Check class="size-4" />
          {/if}
          Save
        </Button>
      </div>
    </form>
  {/if}

  <!-- ═══ Services ═══ -->
  {#if data.services.length === 0}
    <div
      class="mb-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center"
    >
      <Server class="mb-3 size-8 text-text-muted opacity-40" />
      <p class="text-sm font-medium text-text-muted">
        No services in this project yet
      </p>
      <div class="mt-5 flex gap-2">
        <Button
          href="{resolve('/templates')}?projectId={proj.id}"
          variant="outline"
        >
          <LayoutGrid class="size-4" />
          From Template
        </Button>
        <Button href="{resolve('/services/new')}?projectId={proj.id}">
          <Plus class="size-4" />
          Add Service
        </Button>
      </div>
    </div>
  {:else}
    <div class="mb-8 space-y-3">
      {#each data.services as svc (svc.id)}
        <a
          class="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5 transition-shadow hover:shadow-md"
          href="{resolve('/services')}/{svc.id}"
        >
          <div
            class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl"
          >
            <Server class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-sm font-semibold text-text">
                {svc.name}
              </p>
              <StatusBadge status={svc.currentStatus} />
            </div>
            <p class="mt-0.5 truncate text-xs text-text-muted">
              {svc.image}:{svc.tag}
            </p>
          </div>
        </a>
      {/each}
    </div>
  {/if}

  <!-- ═══ Danger zone ═══ -->
  <section
    class="rounded-2xl border border-red-200 bg-surface dark:border-red-900/40"
  >
    <div
      class="flex items-center gap-3 border-b border-red-100 px-5 py-4 dark:border-red-900/30"
    >
      <div
        class="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600"
      >
        <AlertTriangle class="size-4" />
      </div>
      <div>
        <h2 class="text-sm font-semibold text-red-600 dark:text-red-400">
          Danger zone
        </h2>
        <p class="text-xs text-text-muted">
          Deletes every service in this project and their containers.
          Irreversible.
        </p>
      </div>
    </div>
    <div class="p-5">
      {#if !showDeleteConfirm}
        <Button
          class="border-red-300 text-red-600 hover:bg-red-500 hover:text-white dark:border-red-700/60"
          onclick={() => {
            showDeleteConfirm = true;
          }}
          variant="outline"
        >
          Delete project
        </Button>
      {:else}
        <form
          action="?/delete"
          class="space-y-4"
          method="POST"
          use:enhance={() => {
            deleting = true;
            return ({ result }) => {
              if (result.type === "redirect") {
                toast.success("Project deleted.");
                goto(result.location);
              } else {
                deleting = false;
                toast.error("Couldn't delete the project.");
              }
            };
          }}
        >
          <div
            class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
          >
            <p class="font-semibold">
              Delete "{proj.name}" and all {data.services.length}
              {data.services.length === 1 ? "service" : "services"}
              in it?
            </p>
            <p class="mt-1">
              Every container will be stopped and removed. This can't be undone.
            </p>
          </div>
          <div class="flex items-center gap-3">
            <Button
              onclick={() => {
                showDeleteConfirm = false;
              }}
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={deleting} type="submit" variant="destructive">
              {#if deleting}
                <Spinner />
                Deleting…
              {:else}
                <Trash2 class="size-4" />
                Yes, delete everything
              {/if}
            </Button>
          </div>
        </form>
      {/if}
    </div>
  </section>
</div>
