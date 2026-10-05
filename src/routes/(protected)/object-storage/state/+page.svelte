<script lang="ts">
	import { ChevronRight, FileCode2, Lock } from "@lucide/svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import ObjectStoreSelect from "#lib/components/object-store-select.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { timeAgo } from "#lib/formatting.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	const { data } = $props();

	let storeId = $state("");
	let creating = $state(false);

	$effect(() => {
		if (!storeId && data.stores.length > 0) {
			storeId = data.stores[0].id;
		}
	});
</script>

{#if data.projects.length > 0}
  <div class="panel mb-6 overflow-x-auto rounded-md">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
          <th class="px-4 py-3 font-medium">Project</th>
          <th class="px-4 py-3 font-medium">Serial</th>
          <th class="hidden px-4 py-3 font-medium md:table-cell">Bucket</th>
          <th class="hidden px-4 py-3 font-medium md:table-cell">Last written</th>
          <th class="w-8 px-4 py-3"><span class="sr-only">Open</span></th>
        </tr>
      </thead>
      <tbody>
        {#each data.projects as project (project.id)}
          <tr class="border-border/60 hover:bg-surface-2 group relative border-b last:border-0">
            <td class="px-4 py-3">
              <span class="inline-flex items-center gap-1.5">
                <a
                  class="text-text group-hover:text-accent font-medium after:absolute after:inset-0"
                  href={resolve("/(protected)/object-storage/state/[projectId]", {
                    projectId: project.id,
                  })}
                >
                  {project.name}
                </a>
                {#if project.locked}
                  <Lock aria-label="Locked" class="size-3.5 text-amber-500" />
                {/if}
              </span>
            </td>
            <td class="text-text-muted px-4 py-3 tabular-nums">{project.serial ?? "—"}</td>
            <td class="text-text-muted hidden px-4 py-3 font-mono text-xs md:table-cell">{project.bucket}</td>
            <td class="text-text-muted hidden px-4 py-3 md:table-cell">
              {project.updatedAt ? timeAgo(project.updatedAt) : "Never"}
            </td>
            <td class="text-text-subtle px-4 py-3"><ChevronRight class="size-4" /></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<section class="panel rounded-md">
  <PanelHeader
    description="One Terraform state, kept in a bucket you pick. Every write is kept as a version you can compare or roll back to, and the lock lives in Homerun."
    icon={FileCode2}
    title="New state project"
  >
    {#snippet trailing()}
      <SaveButton
        disabled={data.stores.length === 0}
        form="new-state-project"
        label="Create"
        pending={creating}
      />
    {/snippet}
  </PanelHeader>
  {#if data.stores.length === 0}
    <p class="text-text-muted px-5 py-4 text-sm">
      Turn on the built-in store or connect one first: the state lives in one
      of its buckets.
    </p>
  {:else}
    <form
      id="new-state-project"
      class="grid gap-4 px-5 py-4 sm:grid-cols-2"
      action="?/create"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't create the project.",
        loading: "Creating the project",
        onSettled: () => {
          creating = false;
        },
        onStart: () => {
          creating = true;
        },
        onSuccess: (result) => {
          if (typeof result?.projectId === "string") {
            void goto(
              resolve("/(protected)/object-storage/state/[projectId]", {
                projectId: result.projectId,
              }),
            );
          }
        },
        success: "Project created.",
      })}
    >
      <div>
        <label class={labelClass} for="projectName">Name</label>
        <input
          id="projectName"
          class={inputClass}
          autocomplete="off"
          name="name"
          placeholder="homelab"
          required
        />
      </div>
      <div>
        <label class={labelClass} for="projectStore">Store</label>
        <ObjectStoreSelect
          id="projectStore"
          name="storeId"
          stores={data.stores}
          bind:value={storeId}
        />
      </div>
      <div>
        <label class={labelClass} for="projectBucket">Bucket</label>
        <input
          id="projectBucket"
          class={inputClass}
          autocomplete="off"
          name="bucket"
          placeholder="tfstate"
          required
        />
      </div>
      <div>
        <label class={labelClass} for="projectPrefix">Folder in the bucket</label>
        <input
          id="projectPrefix"
          class={inputClass}
          autocomplete="off"
          name="prefix"
          placeholder="Optional, e.g. terraform"
        />
      </div>
    </form>
  {/if}
</section>
