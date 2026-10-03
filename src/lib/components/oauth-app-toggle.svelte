<script lang="ts">
	import { Switch } from "#lib/components/ui/switch/index.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	interface Props {
		app: { disabled: boolean; id: string; name: string };
		showLabel?: boolean;
	}

	const { app, showLabel = false }: Props = $props();

	let form = $state<HTMLFormElement | undefined>();
	let pending = $state(false);
</script>

<form
  action="{resolve('/(protected)/idp/[appId]', { appId: app.id })}?/toggle"
  class="flex items-center gap-2"
  method="POST"
  bind:this={form}
  use:enhance={enhanceToast({
    error: `Couldn't change ${app.name}.`,
    loading: app.disabled ? `Turning ${app.name} on` : `Turning ${app.name} off`,
    onSettled: () => {
      pending = false;
    },
    onStart: () => {
      pending = true;
    },
    success: (result) =>
      (result as { disabled?: boolean } | undefined)?.disabled
        ? `${app.name} is off: it can't start new sign-ins.`
        : `${app.name} is on.`,
  })}
>
  <Switch
    aria-label={app.disabled ? `Turn ${app.name} on` : `Turn ${app.name} off`}
    checked={!app.disabled}
    disabled={pending}
    onCheckedChange={() => form?.requestSubmit()}
  />
  {#if showLabel}
    <span class="text-text-muted text-xs">{app.disabled ? "Off" : "On"}</span>
  {/if}
</form>
