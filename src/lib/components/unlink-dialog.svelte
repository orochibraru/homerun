<script lang="ts" module>
	export interface UnlinkTarget {
		from: { id: string; name: string };
		keys: string[];
		to: { id: string; name: string };
	}
</script>

<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import { enhanceToast } from "$lib/toast";

	let {
		link,
		open = $bindable(false),
	}: { link: UnlinkTarget | null; open?: boolean } = $props();

	let form = $state<HTMLFormElement>();
</script>

{#if link}
  <form
    bind:this={form}
    class="hidden"
    action="{resolve('/services')}/{link.from.id}?/unlink"
    method="POST"
    use:enhance={enhanceToast({
      error: `Couldn't unlink ${link.from.name} from ${link.to.name}.`,
      loading: `Unlinking ${link.from.name} from ${link.to.name}`,
      success: `${link.from.name} no longer points at ${link.to.name}. Redeploy it to apply.`,
    })}
  >
    <input name="targetId" type="hidden" value={link.to.id} />
  </form>
{/if}

<ConfirmDialog
  bind:open
  confirmLabel="Unlink"
  description={link
    ? `Removes the variables in ${link.from.name} that point at ${link.to.name}. It keeps running as it is until its next deploy.`
    : ""}
  onConfirm={() => form?.requestSubmit()}
  title={link ? `Unlink ${link.from.name} from ${link.to.name}` : "Unlink"}
>
  {#if link}
    <ul class="text-text space-y-1 font-mono text-xs">
      {#each link.keys as key (key)}
        <li>{key}</li>
      {/each}
    </ul>
  {/if}
</ConfirmDialog>
