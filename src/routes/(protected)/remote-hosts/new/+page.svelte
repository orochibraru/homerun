<script lang="ts">
	import { ChevronDown, Plus, PlusIcon, Server, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { title } from "$lib/store/title";

	const { data, form } = $props();

	onMount(() => title.set("Remote Hosts"));

	let showTls = $state(false);
	let submitting = $state(false);
</script>

<div class="p-6 md:p-8">
  <div class="mb-8 flex items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-text">Add a new remote host</h1>
      <p class="mt-1 text-sm text-text-muted">
        Fill in the form below to add a remote docker host.
      </p>
    </div>
  </div>

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
          await goto(resolve("/remote-hosts"), {
            invalidateAll: true,
          });
        } else if (result.type === "failure") {
          toast.error(
            (result.data as { error?: string })?.error
              ?? "Check the form for errors.",
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
        (uses the system's own SSH agent : no key field here).
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
</div>
