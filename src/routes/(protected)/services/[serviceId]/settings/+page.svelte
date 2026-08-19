<script lang="ts">
  import {
    AlertTriangle,
    Check,
    ChevronDown,
    FolderKanban,
    HardDrive,
    LayoutGrid,
    Loader2,
    Lock,
    Plus,
    Settings,
    Trash2,
    X,
  } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { title } from "$lib/store/title";

  const { data, form } = $props();
  const svc = $derived(data.service);

  onMount(() => title.set(`${svc.name} · Settings`));

  const input =
    "w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-subtle transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";
  const label = "block mb-1.5 text-sm font-medium text-text";
  const errorClass = "mt-1.5 text-xs text-red-500";

  const values = $derived(
    (form?.values as Record<string, string> | undefined) ?? {
      containerPort: String(svc.containerPort),
      cpuLimit: svc.cpuLimit ?? "",
      image: svc.image,
      memoryLimitMb: svc.memoryLimitMb ? String(svc.memoryLimitMb) : "",
      name: svc.name,
      registryUrl: svc.registryUrl ?? "",
      registryUsername: svc.registryUsername ?? "",
      restartPolicy: svc.restartPolicy,
      slug: svc.slug,
      tag: svc.tag,
    }
  );
  const errors = $derived(form?.errors as Record<string, string[]> | undefined);

  let submitting = $state(false);
  let showRegistry = $state(!!svc.registryUsername);
  let showDeleteConfirm = $state(false);
  let deleting = $state(false);
</script>

<div class="space-y-6">
  <section class="rounded-2xl border border-border bg-surface">
    <div class="flex items-center gap-3 border-b border-border px-5 py-4">
      <div
        class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
      >
        <Settings class="size-4" />
      </div>
      <div>
        <h2 class="text-sm font-semibold text-text">Service settings</h2>
        <p class="text-xs text-text-muted">
          Changes take effect on the next deploy.
        </p>
      </div>
    </div>

    <form
      action="?/update"
      class="space-y-5 p-5"
      method="POST"
      use:enhance={() => {
        submitting = true;
        return async ({ result, update }) => {
          submitting = false;
          if (result.type === "success") {
            toast.success("Saved.", {
              action: {
                label: "Redeploy",
                onClick: () =>
                  goto(resolve("/services/[serviceId]", { serviceId: svc.id })),
              },
              description: "Changes take effect on the next deploy.",
            });
          }
          if (result.type === "failure")
            toast.error("Check the form for errors.");
          await update();
        };
      }}
    >
      <div>
        <label class={label} for="name">
          Name <span class="text-red-500">*</span>
        </label>
        <input
          class={input}
          id="name"
          name="name"
          required
          type="text"
          value={values.name}
        >
        {#if errors?.name}
          <p class={errorClass}>{errors.name[0]}</p>
        {/if}
      </div>

      <div>
        <label class={label} for="slug">
          Slug <span class="text-red-500">*</span>
        </label>
        <input
          class={input}
          id="slug"
          maxlength="63"
          name="slug"
          pattern="[a-z0-9\-]+"
          required
          type="text"
          value={values.slug}
        >
        <p class="mt-1 text-xs text-text-subtle">
          Routed at
          <span class="text-accent">{values.slug}.{data.baseDomain}</span>
          — redeploy to apply a change.
        </p>
        {#if errors?.slug}
          <p class={errorClass}>{errors.slug[0]}</p>
        {/if}
      </div>

      <div class="grid grid-cols-3 gap-3">
        <div class="col-span-2">
          <label class={label} for="image">
            Image <span class="text-red-500">*</span>
          </label>
          <input
            class={input}
            id="image"
            name="image"
            required
            type="text"
            value={values.image}
          >
          {#if errors?.image}
            <p class={errorClass}>{errors.image[0]}</p>
          {/if}
        </div>
        <div>
          <label class={label} for="tag">Tag</label>
          <input
            class={input}
            id="tag"
            name="tag"
            type="text"
            value={values.tag}
          >
        </div>
      </div>

      <div>
        <label class={label} for="containerPort">
          Container port <span class="text-red-500">*</span>
        </label>
        <input
          class={input}
          id="containerPort"
          max="65535"
          min="1"
          name="containerPort"
          required
          type="number"
          value={values.containerPort}
        >
        {#if errors?.containerPort}
          <p class={errorClass}>{errors.containerPort[0]}</p>
        {/if}
      </div>

      <div>
        <label class={label} for="restartPolicy">Restart policy</label>
        <select class={input} id="restartPolicy" name="restartPolicy">
          {#each [["unless-stopped", "Unless stopped"], ["always", "Always"], ["on-failure", "On failure"], ["no", "Never"]] as [val, lbl]}
            <option selected={values.restartPolicy === val} value={val}>
              {lbl}
            </option>
          {/each}
        </select>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class={label} for="cpuLimit">CPU limit</label>
          <input
            class={input}
            id="cpuLimit"
            name="cpuLimit"
            placeholder="e.g. 0.5 (cores)"
            type="text"
            value={values.cpuLimit}
          >
          {#if errors?.cpuLimit}
            <p class={errorClass}>{errors.cpuLimit[0]}</p>
          {/if}
        </div>
        <div>
          <label class={label} for="memoryLimitMb">Memory limit (MB)</label>
          <input
            class={input}
            id="memoryLimitMb"
            min="1"
            name="memoryLimitMb"
            placeholder="e.g. 512"
            type="number"
            value={values.memoryLimitMb}
          >
          {#if errors?.memoryLimitMb}
            <p class={errorClass}>{errors.memoryLimitMb[0]}</p>
          {/if}
        </div>
      </div>

      <div class="rounded-xl border border-border">
        <button
          class="flex w-full items-center gap-3 px-4 py-3 text-left"
          onclick={() => (showRegistry = !showRegistry)}
          type="button"
        >
          <Lock class="size-4 text-text-muted" />
          <span class="flex-1 text-sm font-medium text-text">
            Private registry
          </span>
          <ChevronDown
            class="size-4 text-text-muted transition-transform {showRegistry
              ? 'rotate-180'
              : ''}"
          />
        </button>
        {#if showRegistry}
          <div class="space-y-4 border-t border-border p-4">
            <div>
              <label class={label} for="registryUrl">Registry URL</label>
              <input
                class={input}
                id="registryUrl"
                name="registryUrl"
                type="text"
                value={values.registryUrl}
              >
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class={label} for="registryUsername">Username</label>
                <input
                  class={input}
                  id="registryUsername"
                  name="registryUsername"
                  type="text"
                  value={values.registryUsername}
                >
              </div>
              <div>
                <label class={label} for="registryPassword">
                  Password / token
                </label>
                <input
                  class={input}
                  id="registryPassword"
                  name="registryPassword"
                  placeholder="Leave blank to keep current"
                  type="password"
                >
              </div>
            </div>
          </div>
        {/if}
      </div>

      <div class="flex justify-end">
        <button
          class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting}
          type="submit"
        >
          {#if submitting}
            <Loader2 class="size-4 animate-spin" />
            Saving…
          {:else}
            <Check class="size-4" />
            Save
          {/if}
        </button>
      </div>
    </form>
  </section>

  <!-- ═══ Project ═══ -->
  <section class="rounded-2xl border border-border bg-surface">
    <div class="flex items-center justify-between gap-4 p-5">
      <div class="flex items-center gap-3">
        <div
          class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
        >
          <FolderKanban class="size-4" />
        </div>
        <div>
          <p class="text-sm font-medium text-text">Project</p>
          <p class="text-xs text-text-muted">
            Move this service into a different project, or ungroup it.
          </p>
        </div>
      </div>
      <form
        action="?/moveProject"
        class="flex items-center gap-2"
        method="POST"
        use:enhance={() =>
          async ({ result, update }) => {
            if (result.type === "success") {
              toast.success("Moved.");
            } else {
              toast.error("Couldn't move the service.");
            }
            await update();
          }}
      >
        <select
          class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          name="projectId"
        >
          <option selected={!svc.projectId} value="">Ungrouped</option>
          {#each data.projects as proj (proj.id)}
            <option selected={svc.projectId === proj.id} value={proj.id}>
              {proj.name}
            </option>
          {/each}
        </select>
        <button
          class="shrink-0 rounded-xl border border-border px-4 py-2 text-sm font-medium text-text transition-all hover:bg-surface-2"
          type="submit"
        >
          Move
        </button>
      </form>
    </div>
  </section>

  <!-- ═══ Volumes ═══ -->
  <section class="rounded-2xl border border-border bg-surface">
    <div class="flex items-center gap-3 border-b border-border px-5 py-4">
      <div
        class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
      >
        <HardDrive class="size-4" />
      </div>
      <div>
        <h2 class="text-sm font-semibold text-text">Volumes</h2>
        <p class="text-xs text-text-muted">
          Mount a storage volume into the container. Takes effect on the next
          deploy.
        </p>
      </div>
    </div>

    {#if data.mounts.length > 0}
      <div class="divide-y divide-border border-b border-border">
        {#each data.mounts as mount (mount.id)}
          <div class="flex items-center gap-3 px-5 py-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-text">
                {mount.volumeName}
                {#if mount.readOnly}
                  <span class="text-xs font-normal text-text-subtle"
                    >(read-only)</span
                  >
                {/if}
              </p>
              <p class="truncate font-mono text-xs text-text-muted">
                {mount.containerPath}
              </p>
            </div>
            <form
              action="?/detachVolume"
              method="POST"
              use:enhance={() =>
                async ({ result, update }) => {
                  if (result.type === "failure") {
                    toast.error("Couldn't remove the mount.");
                  }
                  await update();
                }}
            >
              <input name="mountId" type="hidden" value={mount.id}>
              <button
                class="rounded-lg p-2 text-text-muted transition-all hover:bg-surface-2 hover:text-text"
                title="Remove"
                type="submit"
              >
                <X class="size-4" />
              </button>
            </form>
          </div>
        {/each}
      </div>
    {/if}

    <div class="p-5">
      {#if data.volumes.length === 0}
        <p class="text-xs text-text-subtle">
          No storage volumes yet —
          <a class="text-accent underline" href={resolve("/storage/new")}
            >create one</a
          >
          first.
        </p>
      {:else}
        <form
          action="?/attachVolume"
          class="flex flex-wrap items-end gap-3"
          method="POST"
          use:enhance={() =>
            async ({ result, update }) => {
              if (result.type === "failure") {
                toast.error("Couldn't mount the volume.");
              }
              await update();
            }}
        >
          <div class="flex-1">
            <label
              class="mb-1.5 block text-xs font-medium text-text"
              for="volumeId"
            >
              Volume
            </label>
            <select
              class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              id="volumeId"
              name="volumeId"
            >
              {#each data.volumes as vol (vol.id)}
                <option value={vol.id}>{vol.name}</option>
              {/each}
            </select>
          </div>
          <div class="flex-1">
            <label
              class="mb-1.5 block text-xs font-medium text-text"
              for="containerPath"
            >
              Mount path
            </label>
            <input
              class="w-full rounded-xl border border-border bg-surface px-3 py-2 font-mono text-sm text-text placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              id="containerPath"
              name="containerPath"
              placeholder="/data"
              required
              type="text"
            >
          </div>
          <label
            class="flex items-center gap-1.5 pb-2.5 text-xs text-text-muted"
          >
            <input name="readOnly" type="checkbox">
            Read-only
          </label>
          <button
            class="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-text transition-all hover:bg-surface-2"
            type="submit"
          >
            <Plus class="size-3.5" />
            Mount
          </button>
        </form>
      {/if}
    </div>
  </section>

  <!-- ═══ Save as template ═══ -->
  <section class="rounded-2xl border border-border bg-surface">
    <div class="flex items-center justify-between gap-4 p-5">
      <div class="flex items-center gap-3">
        <div
          class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
        >
          <LayoutGrid class="size-4" />
        </div>
        <div>
          <p class="text-sm font-medium text-text">Save as template</p>
          <p class="text-xs text-text-muted">
            Reuse this config to deploy another service later.
          </p>
        </div>
      </div>
      <form
        action="?/saveAsTemplate"
        method="POST"
        use:enhance={() =>
          async ({ result, update }) => {
            if (result.type === "success") {
              toast.success("Saved as a template.");
            } else {
              toast.error("Couldn't save the template.");
            }
            await update();
          }}
      >
        <button
          class="shrink-0 rounded-xl border border-border px-4 py-2 text-sm font-medium text-text transition-all hover:bg-surface-2"
          type="submit"
        >
          Save as template
        </button>
      </form>
    </div>
  </section>

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
          Irreversible. Removes the container and all deployment history.
        </p>
      </div>
    </div>
    <div class="p-5">
      {#if !showDeleteConfirm}
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-text">Delete this service</p>
          </div>
          <button
            class="shrink-0 rounded-xl border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-500 hover:text-white dark:border-red-700/60"
            onclick={() => (showDeleteConfirm = true)}
          >
            Delete service
          </button>
        </div>
      {:else}
        <form
          action="?/delete"
          class="space-y-4"
          method="POST"
          use:enhance={() => {
            deleting = true;
            return async ({ result }) => {
              if (result.type === "redirect") {
                toast.success("Service deleted.");
                goto(result.location);
              } else {
                deleting = false;
                toast.error("Couldn't delete the service.");
              }
            };
          }}
        >
          <div
            class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
          >
            <p class="font-semibold">Delete "{svc.name}"?</p>
            <p class="mt-1">
              Its container will be stopped and removed. This can't be undone.
            </p>
          </div>
          <div class="flex items-center gap-3">
            <button
              class="rounded-xl border border-border px-4 py-2 text-sm font-medium text-text transition-all hover:bg-surface-2"
              onclick={() => (showDeleteConfirm = false)}
              type="button"
            >
              Cancel
            </button>
            <button
              class="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={deleting}
              type="submit"
            >
              {#if deleting}
                <Loader2 class="size-4 animate-spin" />
                Deleting…
              {:else}
                <Trash2 class="size-4" />
                Yes, delete
              {/if}
            </button>
          </div>
        </form>
      {/if}
    </div>
  </section>
</div>
