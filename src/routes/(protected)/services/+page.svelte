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

	// Tracks which service's action is in flight, keyed by serviceId, so
	// only that row's buttons show a spinner/disable.
	let pending = $state<Record<string, boolean>>({});

	function withPending(serviceId: string) {
		pending[serviceId] = true;
		return () =>
			async ({
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
	}

	function confirmDelete(e: SubmitEvent, name: string) {
		if (
			!confirm(
				`Delete "${name}"? This removes its container and can't be undone.`,
			)
		) {
			e.preventDefault();
		}
	}
</script>

<div class="p-6 md:p-8">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-[var(--color-text)]">Services</h1>
      <p class="mt-1 text-sm text-[var(--color-text-muted)]">
        Containers deployed to this server.
      </p>
    </div>
    <a
      href={resolve("/services/new")}
      class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all"
    >
      <Plus class="size-4" />
      Deploy a Service
    </a>
  </div>

  {#if data.services.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] py-20 text-center"
    >
      <Server class="mb-3 size-10 text-[var(--color-text-muted)] opacity-40" />
      <p class="text-sm font-medium text-[var(--color-text-muted)]">
        No services yet
      </p>
      <p class="mt-1 text-xs text-[var(--color-text-subtle)]">
        Point at an image, fill in a config, and deploy.
      </p>
      <a
        href={resolve("/services/new")}
        class="bg-accent shadow-accent/30 hover:bg-accent-dark mt-5 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all"
      >
        <Plus class="size-4" />
        Deploy your first service
      </a>
    </div>
  {:else}
    <div class="space-y-3">
      {#each data.services as svc (svc.id)}
        <div
          class="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 transition-shadow hover:shadow-md"
        >
          <a
            href="{resolve('/services')}/{svc.id}"
            class="flex min-w-0 flex-1 items-center gap-4"
          >
            <div
              class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl"
            >
              <Server class="size-5" />
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p
                  class="truncate text-sm font-semibold text-[var(--color-text)]"
                >
                  {svc.name}
                </p>
                <StatusBadge status={svc.currentStatus} />
              </div>
              <p class="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                {svc.image}:{svc.tag} · {svc.slug}.{data.baseDomain}
              </p>
            </div>
          </a>

          <div class="flex shrink-0 items-center gap-1.5">
            {#if svc.desiredState === "running"}
              <form
                method="POST"
                action="?/stop"
                use:enhance={withPending(svc.id)}
              >
                <input type="hidden" name="serviceId" value={svc.id} />
                <button
                  type="submit"
                  disabled={pending[svc.id]}
                  title="Stop"
                  class="rounded-lg p-2 text-[var(--color-text-muted)] transition-all hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
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
                method="POST"
                action="?/start"
                use:enhance={withPending(svc.id)}
              >
                <input type="hidden" name="serviceId" value={svc.id} />
                <button
                  type="submit"
                  disabled={pending[svc.id] || !svc.containerId}
                  title={svc.containerId
                    ? "Start"
                    : "Deploy first from the service page"}
                  class="rounded-lg p-2 text-[var(--color-text-muted)] transition-all hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
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
              method="POST"
              action="?/restart"
              use:enhance={withPending(svc.id)}
            >
              <input type="hidden" name="serviceId" value={svc.id} />
              <button
                type="submit"
                disabled={pending[svc.id] || !svc.containerId}
                title="Restart"
                class="rounded-lg p-2 text-[var(--color-text-muted)] transition-all hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-50"
              >
                <RotateCw class="size-4" />
              </button>
            </form>

            <form
              method="POST"
              action="?/delete"
              use:enhance={withPending(svc.id)}
              onsubmit={(e) => confirmDelete(e, svc.name)}
            >
              <input type="hidden" name="serviceId" value={svc.id} />
              <button
                type="submit"
                disabled={pending[svc.id]}
                title="Delete"
                class="rounded-lg p-2 text-red-500 transition-all hover:bg-red-500/10 disabled:opacity-50"
              >
                <Trash2 class="size-4" />
              </button>
            </form>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
