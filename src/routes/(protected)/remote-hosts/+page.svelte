<script lang="ts">
  import { ChevronDown, Plus, Server, Trash2 } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import EmptyState from "$lib/components/empty-state.svelte";
  import {
    inputClass as input,
    labelClass as label,
  } from "$lib/components/form-styles";
  import { title } from "$lib/store/title";

  const { data, form } = $props();

  onMount(() => title.set("Remote Hosts"));

  let showForm = $state(false);
  let showTls = $state(false);
  let submitting = $state(false);

  function confirmDelete(e: SubmitEvent, name: string) {
    if (
      // biome-ignore lint/suspicious/noAlert: a native confirm() is the simplest correct guard here — no custom UI built for this yet.
      !confirm(
        `Delete "${name}"? Services deployed to it keep running there — they just won't be manageable from here anymore.`
      )
    ) {
      e.preventDefault();
    }
  }
</script>

<div class="p-6 md:p-8">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-text">Remote Hosts</h1>
      <p class="mt-1 text-sm text-text-muted">
        Other Docker daemons a service can be deployed to instead of this host.
        A remote-hosted service isn't on the shared network or routed through
        Traefik — see the docs on the Networking tab for what that means in
        practice.
      </p>
    </div>
    <button
      class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all"
      onclick={() => {
        showForm = !showForm;
      }}
      type="button"
    >
      <Plus class="size-4" />
      Add Host
    </button>
  </div>

  {#if showForm}
    <form
      action="?/create"
      class="mb-6 space-y-4 rounded-2xl border border-border bg-surface p-5"
      method="POST"
      use:enhance={() => {
        submitting = true;
        return async ({ result, update }) => {
          submitting = false;
          if (result.type === "success") {
            toast.success("Remote host added.");
            showForm = false;
          } else if (result.type === "failure") {
            toast.error(
              (result.data as { error?: string })?.error ??
                "Check the form for errors."
            );
          }
          await update();
        };
      }}
    >
      {#if form?.error}
        <p class="text-sm text-red-500">{form.error}</p>
      {/if}
      <div>
        <label class={label} for="name">Name</label>
        <input class={input} id="name" name="name" required type="text">
      </div>
      <div>
        <label class={label} for="dockerHost">Docker host</label>
        <input
          class="{input} font-mono"
          id="dockerHost"
          name="dockerHost"
          placeholder="tcp://192.168.1.50:2376"
          required
          type="text"
        >
        <p class="mt-1.5 text-xs text-text-subtle">
          <code>tcp://host:port</code>
          (add TLS certs below for a TLS-secured daemon) or
          <code>ssh://user@host</code>
          (uses the system's own SSH agent — no key field here).
        </p>
      </div>

      <button
        class="text-accent flex items-center gap-1.5 text-sm font-medium hover:underline"
        onclick={() => {
          showTls = !showTls;
        }}
        type="button"
      >
        <ChevronDown
          class="size-3.5 transition-transform {showTls ? 'rotate-180' : ''}"
        />
        TLS client certificate (optional, tcp:// only)
      </button>
      {#if showTls}
        <div class="space-y-3">
          <div>
            <label class={label} for="tlsCa">CA certificate</label>
            <textarea
              class="{input} resize-none font-mono"
              id="tlsCa"
              name="tlsCa"
              rows="3"
            ></textarea>
          </div>
          <div>
            <label class={label} for="tlsCert">Client certificate</label>
            <textarea
              class="{input} resize-none font-mono"
              id="tlsCert"
              name="tlsCert"
              rows="3"
            ></textarea>
          </div>
          <div>
            <label class={label} for="tlsKey">Client key</label>
            <textarea
              class="{input} resize-none font-mono"
              id="tlsKey"
              name="tlsKey"
              rows="3"
            ></textarea>
          </div>
        </div>
      {/if}

      <div class="flex justify-end gap-3">
        <button
          class="rounded-xl border border-border px-4 py-2 text-sm font-medium text-text transition-all hover:bg-surface-2"
          disabled={submitting}
          type="submit"
        >
          Add host
        </button>
      </div>
    </form>
  {/if}

  {#if data.hosts.length === 0}
    <EmptyState
      icon={Server}
      subtitle="Every service deploys to this host until you add one."
      title="No remote hosts yet"
    />
  {:else}
    <div class="space-y-3">
      {#each data.hosts as host (host.id)}
        <div
          class="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5"
        >
          <div
            class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl"
          >
            <Server class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-text">
              {host.name}
            </p>
            <p class="mt-0.5 truncate font-mono text-xs text-text-muted">
              {host.dockerHost}
            </p>
          </div>
          <form
            action="?/delete"
            method="POST"
            onsubmit={(e) => confirmDelete(e, host.name)}
            use:enhance={() =>
              async ({ result, update }) => {
                if (result.type === "failure") {
                  toast.error("Couldn't delete the host.");
                }
                await update();
              }}
          >
            <input name="hostId" type="hidden" value={host.id}>
            <button
              class="rounded-lg p-2 text-red-500 transition-all hover:bg-red-500/10"
              title="Delete"
              type="submit"
            >
              <Trash2 class="size-4" />
            </button>
          </form>
        </div>
      {/each}
    </div>
  {/if}
</div>
