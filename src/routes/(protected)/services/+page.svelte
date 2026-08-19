<script lang="ts">
  import {
    Loader2,
    Play,
    Plus,
    RotateCw,
    Server,
    Square,
    Trash2,
  } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import StatusBadge from "$lib/components/status-badge.svelte";
  import { title } from "$lib/store/title";

  const { data } = $props();

  onMount(() => title.set("Services"));

  // Group by project name, "Ungrouped" last — order of first appearance
  // otherwise, matching the underlying createdAt-desc query order.
  const groups = $derived.by(() => {
    const byLabel = new Map<string, typeof data.services>();
    for (const svc of data.services) {
      const label = svc.projectName ?? "Ungrouped";
      const bucket = byLabel.get(label);
      if (bucket) {
        bucket.push(svc);
      } else {
        byLabel.set(label, [svc]);
      }
    }
    const ungrouped = byLabel.get("Ungrouped");
    byLabel.delete("Ungrouped");
    const entries = [...byLabel.entries()];
    if (ungrouped) {
      entries.push(["Ungrouped", ungrouped]);
    }
    return entries;
  });

  // Tracks which service's action is in flight, keyed by serviceId, so
  // only that row's buttons show a spinner/disable.
  let pending = $state<Record<string, boolean>>({});

  function withPending(serviceId: string) {
    return () => {
      pending[serviceId] = true;
      return async ({
        result,
        update,
      }: {
        result: { type: string; data?: { error?: string } };
        update: () => Promise<void>;
      }) => {
        pending[serviceId] = false;
        if (result.type === "failure" && result.data?.error) {
          toast.error(result.data.error);
        }
        await update();
      };
    };
  }

  function confirmDelete(e: SubmitEvent, name: string) {
    if (
      // biome-ignore lint/suspicious/noAlert: a native confirm() is the simplest correct guard here — no custom UI built for this yet.
      !confirm(
        `Delete "${name}"? This removes its container and can't be undone.`
      )
    ) {
      e.preventDefault();
    }
  }
</script>

<div class="p-6 md:p-8">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-text">Services</h1>
      <p class="mt-1 text-sm text-text-muted">
        Containers deployed to this server.
      </p>
    </div>
    <a
      class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all"
      href={resolve("/services/new")}
    >
      <Plus class="size-4" />
      Deploy a Service
    </a>
  </div>

  {#if data.services.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center"
    >
      <Server class="mb-3 size-10 text-text-muted opacity-40" />
      <p class="text-sm font-medium text-text-muted">No services yet</p>
      <p class="mt-1 text-xs text-text-subtle">
        Point at an image, fill in a config, and deploy.
      </p>
      <a
        class="bg-accent shadow-accent/30 hover:bg-accent-dark mt-5 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all"
        href={resolve("/services/new")}
      >
        <Plus class="size-4" />
        Deploy your first service
      </a>
    </div>
  {:else}
    <div class="space-y-8">
      {#each groups as [label, services] (label)}
        <div>
          {#if groups.length > 1}
            <h2
              class="mb-3 text-xs font-semibold tracking-widest text-text-subtle uppercase"
            >
              {label}
            </h2>
          {/if}
          <div class="space-y-3">
            {#each services as svc (svc.id)}
              <div
                class="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-5 transition-shadow hover:shadow-md"
              >
                <a
                  class="flex min-w-0 flex-1 items-center gap-4"
                  href="{resolve('/services')}/{svc.id}"
                >
                  <div
                    class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl"
                  >
                    <Server class="size-5" />
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <p class="truncate text-sm font-semibold text-text">
                        {svc.name}
                      </p>
                      <StatusBadge status={svc.currentStatus} />
                    </div>
                    <p class="mt-0.5 truncate text-xs text-text-muted">
                      {svc.image}:{svc.tag}
                      · {svc.slug}.{data.baseDomain}
                    </p>
                  </div>
                </a>

                <div class="flex shrink-0 items-center gap-1.5">
                  {#if svc.desiredState === "running"}
                    <form
                      action="?/stop"
                      method="POST"
                      use:enhance={withPending(svc.id)}
                    >
                      <input name="serviceId" type="hidden" value={svc.id}>
                      <button
                        class="rounded-lg p-2 text-text-muted transition-all hover:bg-surface-2 hover:text-text disabled:opacity-50"
                        disabled={pending[svc.id]}
                        title="Stop"
                        type="submit"
                      >
                        {#if pending[svc.id]}
                          <Loader2 class="size-4 animate-spin" />
                        {:else}
                          <Square class="size-4" />
                        {/if}
                      </button>
                    </form>
                  {:else}
                    <form
                      action="?/start"
                      method="POST"
                      use:enhance={withPending(svc.id)}
                    >
                      <input name="serviceId" type="hidden" value={svc.id}>
                      <button
                        class="rounded-lg p-2 text-text-muted transition-all hover:bg-surface-2 hover:text-text disabled:opacity-50"
                        disabled={pending[svc.id] || !svc.containerId}
                        title={svc.containerId
                          ? "Start"
                          : "Deploy first from the service page"}
                        type="submit"
                      >
                        {#if pending[svc.id]}
                          <Loader2 class="size-4 animate-spin" />
                        {:else}
                          <Play class="size-4" />
                        {/if}
                      </button>
                    </form>
                  {/if}

                  <form
                    action="?/restart"
                    method="POST"
                    use:enhance={withPending(svc.id)}
                  >
                    <input name="serviceId" type="hidden" value={svc.id}>
                    <button
                      class="rounded-lg p-2 text-text-muted transition-all hover:bg-surface-2 hover:text-text disabled:opacity-50"
                      disabled={pending[svc.id] || !svc.containerId}
                      title="Restart"
                      type="submit"
                    >
                      <RotateCw class="size-4" />
                    </button>
                  </form>

                  <form
                    action="?/delete"
                    method="POST"
                    onsubmit={(e) => confirmDelete(e, svc.name)}
                    use:enhance={withPending(svc.id)}
                  >
                    <input name="serviceId" type="hidden" value={svc.id}>
                    <button
                      class="rounded-lg p-2 text-red-500 transition-all hover:bg-red-500/10 disabled:opacity-50"
                      disabled={pending[svc.id]}
                      title="Delete"
                      type="submit"
                    >
                      <Trash2 class="size-4" />
                    </button>
                  </form>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
