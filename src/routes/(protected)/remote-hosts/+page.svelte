<script lang="ts">
  import { ChevronDown, Plus, Server, Trash2 } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import EmptyState from "$lib/components/empty-state.svelte";
  import { labelClass as label } from "$lib/components/form-styles";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
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
    <Button
      onclick={() => {
        showForm = !showForm;
      }}
    >
      <Plus class="size-4" />
      Add Host
    </Button>
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
        <Input id="name" name="name" required type="text" />
      </div>
      <div>
        <label class={label} for="dockerHost">Docker host</label>
        <Input
          class="font-mono"
          id="dockerHost"
          name="dockerHost"
          placeholder="tcp://192.168.1.50:2376"
          required
          type="text"
        />
        <p class="mt-1.5 text-xs text-text-subtle">
          <code>tcp://host:port</code>
          (add TLS certs below for a TLS-secured daemon) or
          <code>ssh://user@host</code>
          (uses the system's own SSH agent — no key field here).
        </p>
      </div>

      <Button
        class="h-auto p-0"
        onclick={() => {
          showTls = !showTls;
        }}
        variant="link"
      >
        <ChevronDown
          class="size-3.5 transition-transform {showTls ? 'rotate-180' : ''}"
        />
        TLS client certificate (optional, tcp:// only)
      </Button>
      {#if showTls}
        <div class="space-y-3">
          <div>
            <label class={label} for="tlsCa">CA certificate</label>
            <Textarea
              class="resize-none font-mono"
              id="tlsCa"
              name="tlsCa"
              rows={3}
            />
          </div>
          <div>
            <label class={label} for="tlsCert">Client certificate</label>
            <Textarea
              class="resize-none font-mono"
              id="tlsCert"
              name="tlsCert"
              rows={3}
            />
          </div>
          <div>
            <label class={label} for="tlsKey">Client key</label>
            <Textarea
              class="resize-none font-mono"
              id="tlsKey"
              name="tlsKey"
              rows={3}
            />
          </div>
        </div>
      {/if}

      <div class="flex justify-end gap-3">
        <Button disabled={submitting} type="submit" variant="outline">
          Add host
        </Button>
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
            <Button
              class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
              size="icon-sm"
              title="Delete"
              type="submit"
              variant="ghost"
            >
              <Trash2 class="size-4" />
            </Button>
          </form>
        </div>
      {/each}
    </div>
  {/if}
</div>
