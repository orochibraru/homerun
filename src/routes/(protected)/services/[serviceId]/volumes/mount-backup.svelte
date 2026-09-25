<script lang="ts">
	import { Settings } from "@lucide/svelte";
	import { tick } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { labelClass as label } from "$lib/components/form-styles";
	import ScheduleField from "$lib/components/schedule-field.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import { Switch } from "$lib/components/ui/switch/index.js";
	import { describeSchedule, scheduleFromCron } from "$lib/schedule";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		destinations: { id: string; name: string }[];
		volume: {
			backupEnabled: boolean;
			backupPrefix: string | null;
			backupSchedule: string | null;
			id: string;
			name: string;
			s3DestinationId: string | null;
		};
	}

	const { destinations, volume }: Props = $props();

	let settingsOpen = $state(false);
	let toggleForm = $state<HTMLFormElement | null>(null);
	let wanted = $state(false);
	let destinationId = $derived(
		volume.s3DestinationId ?? destinations[0]?.id ?? "",
	);

	const summary = $derived(
		volume.backupEnabled && volume.backupSchedule
			? describeSchedule(scheduleFromCron(volume.backupSchedule))
			: "Backups off",
	);

	async function toggle(checked: boolean) {
		wanted = checked;
		await tick();
		toggleForm?.requestSubmit();
	}
</script>

<div class="flex items-center gap-2">
  <span class="text-text-subtle hidden text-xs sm:inline">{summary}</span>
  <form
    action="?/toggleBackup"
    method="POST"
    bind:this={toggleForm}
    use:enhance={enhanceToast({
      error: "Couldn't change the backup.",
      loading: "Updating backups",
      onFailure: (data) => {
        if (data?.needsSettings) {
          settingsOpen = true;
        }
      },
      success: (data) =>
        data?.backupEnabled
          ? `Backups on for ${volume.name}.`
          : `Backups off for ${volume.name}.`,
    })}
  >
    <input name="volumeId" type="hidden" value={volume.id}>
    <input name="enabled" type="hidden" value={wanted ? "on" : ""}>
    <Switch
      aria-label="Back up {volume.name}"
      checked={volume.backupEnabled}
      onCheckedChange={toggle}
    />
  </form>
  <Button
    aria-label="Backup settings for {volume.name}"
    onclick={() => {
      settingsOpen = true;
    }}
    size="icon-sm"
    title="Backup settings"
    type="button"
    variant="ghost"
  >
    <Settings class="size-4" />
  </Button>
</div>

<Dialog.Root bind:open={settingsOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Back up {volume.name}</Dialog.Title>
      <Dialog.Description>
        When to back it up and where to. Saving turns backups on; the volume's
        own page has restores and the stop-services and pre-backup command
        options.
      </Dialog.Description>
    </Dialog.Header>

    {#if destinations.length === 0}
      <p class="text-text-muted text-sm">
        There's nowhere to send backups yet :
        <a class="text-accent underline" href={resolve("/s3-destinations/new")}>
          add an S3 destination
        </a>
        first.
      </p>
    {:else}
      <form
        action="?/configureBackup"
        class="space-y-5"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't save the backup settings.",
          loading: "Saving the backup settings",
          onSuccess: () => {
            settingsOpen = false;
          },
          success: `Backups on for ${volume.name}.`,
        })}
      >
        <input name="volumeId" type="hidden" value={volume.id}>
        <ScheduleField
          id="backupSchedule-{volume.id}"
          name="backupSchedule"
          value={volume.backupSchedule}
        />
        <div>
          <label class={label} for="s3DestinationId-{volume.id}">
            S3 destination
          </label>
          <input name="s3DestinationId" type="hidden" value={destinationId}>
          <SelectRoot type="single" bind:value={destinationId}>
            <SelectTrigger class="w-full" id="s3DestinationId-{volume.id}">
              {destinations.find((d) => d.id === destinationId)?.name
              ?? "Pick a destination"}
            </SelectTrigger>
            <SelectContent>
              {#each destinations as destination (destination.id)}
                <SelectItem label={destination.name} value={destination.id} />
              {/each}
            </SelectContent>
          </SelectRoot>
        </div>
        <div>
          <label class={label} for="backupPrefix-{volume.id}">
            Key prefix (optional)
          </label>
          <Input
            id="backupPrefix-{volume.id}"
            name="backupPrefix"
            placeholder="volumes/{volume.name}/"
            type="text"
            value={volume.backupPrefix ?? ""}
          />
        </div>
        <Dialog.Footer>
          <Button
            onclick={() => {
              settingsOpen = false;
            }}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button type="submit">Save and turn on</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
