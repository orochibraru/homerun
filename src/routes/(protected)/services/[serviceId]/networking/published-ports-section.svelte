<script lang="ts">
	import { Check, Plug, Plus, X } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import type { PublishedPort } from "$lib/published-ports";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		svc: {
			containerPort: number;
			networkMode: string;
			publishedPorts: PublishedPort[];
		};
	}

	const { svc }: Props = $props();

	interface Row {
		containerPort: string;
		hostPort: string;
		protocol: "tcp" | "udp";
	}

	const toRow = (port: PublishedPort): Row => ({
		containerPort: String(port.containerPort),
		hostPort: String(port.hostPort),
		protocol: port.protocol,
	});

	let rows = $state<Row[]>([]);
	let submitting = $state(false);

	$effect.pre(() => {
		rows = svc.publishedPorts.map(toRow);
	});

	const payload = $derived(
		JSON.stringify(
			rows.map((row) => ({
				containerPort: Number(row.containerPort),
				hostPort: Number(row.hostPort),
				protocol: row.protocol,
			})),
		),
	);

	function addRow() {
		rows = [
			...rows,
			{
				containerPort: String(svc.containerPort),
				hostPort: "",
				protocol: "tcp",
			},
		];
	}

	function removeRow(index: number) {
		rows = rows.filter((_, i) => i !== index);
	}
</script>

<section class="panel rounded-md p-5">
  <div class="mb-4 flex items-center gap-3">
    <div class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
      <Plug class="size-4" />
    </div>
    <div>
      <p class="text-text text-sm font-medium">Published ports</p>
      <p class="text-text-muted text-xs">
        Bind a port on this machine straight to the container, for what
        Traefik can't route by domain : UDP (VPN, game servers, DNS) or raw TCP
        (SSH, databases). Clients reach it at any hostname pointing at this
        machine, on the host port.
      </p>
    </div>
  </div>

  {#if svc.networkMode === "host"}
    <p class="text-text-muted text-sm">
      Host networking already exposes every port the container listens on :
      there's nothing to publish.
    </p>
  {:else}
    <form
      action="?/updatePublishedPorts"
      class="space-y-3"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the published ports.",
        loading: "Saving published ports",
        onSettled: () => {
          submitting = false;
        },
        onStart: () => {
          submitting = true;
        },
        success: "Saved. Redeploy for it to take effect.",
      })}
    >
      <input name="publishedPorts" type="hidden" value={payload}>

      {#if rows.length === 0}
        <p class="text-text-subtle text-xs">Nothing published.</p>
      {:else}
        <div class="grid grid-cols-[1fr_1fr_8rem_auto] items-end gap-2">
          <span class={label}>Host port</span>
          <span class={label}>Container port</span>
          <span class={label}>Protocol</span>
          <span></span>
          {#each rows as row, index (index)}
            <Input
              aria-label="Host port"
              max="65535"
              min="1"
              placeholder="1194"
              required
              type="number"
              bind:value={row.hostPort}
            />
            <Input
              aria-label="Container port"
              max="65535"
              min="1"
              required
              type="number"
              bind:value={row.containerPort}
            />
            <SelectRoot type="single" bind:value={row.protocol}>
              <SelectTrigger aria-label="Protocol" class="w-full">
                {row.protocol.toUpperCase()}
              </SelectTrigger>
              <SelectContent>
                <SelectItem label="TCP" value="tcp" />
                <SelectItem label="UDP" value="udp" />
              </SelectContent>
            </SelectRoot>
            <Button
              aria-label="Remove this port"
              onclick={() => removeRow(index)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X class="size-4" />
            </Button>
          {/each}
        </div>
      {/if}

      <div class="flex flex-wrap items-center gap-3">
        <Button onclick={addRow} type="button" variant="outline">
          <Plus class="size-4" />
          Add port
        </Button>
        <Button disabled={submitting} type="submit" variant="outline">
          {#if submitting}
            <Spinner />
          {:else}
            <Check class="size-4" />
          {/if}
          Save
        </Button>
        <p class="text-text-subtle text-xs">
          Redeploy for changes to take effect. A service with published ports
          stops its old container before starting the new one.
        </p>
      </div>
    </form>
  {/if}
</section>
