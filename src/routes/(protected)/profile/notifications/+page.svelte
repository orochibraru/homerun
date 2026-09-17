<script lang="ts">
	import { BellRing, Plus } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Checkbox } from "$lib/components/ui/checkbox/index.js";
	import { NOTIFICATION_EVENTS } from "$lib/notification-events";
	import { title } from "$lib/store/title";
	import { saveToast } from "$lib/toast";

	const { data } = $props();

	onMount(() => title.set("Notifications"));

	const groups = [...new Set(NOTIFICATION_EVENTS.map((info) => info.group))];
</script>

{#if data.channels.length === 0}
  <EmptyState
    icon={BellRing}
    subtitle="Add a Discord, Slack or Telegram channel, a generic webhook or an email address, then choose what it receives here."
    title="No notification channels yet"
  >
    <Button href={resolve("/notification-channels")}>
      <Plus class="size-4" />
      Add a channel
    </Button>
  </EmptyState>
{:else}
  <form
    action="?/save"
    class="panel rounded-md"
    method="POST"
    use:enhance={saveToast("Notification settings")}
  >
    <div class="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
      <div>
        <h2 class="eyebrow">What to send, and where</h2>
        <p class="text-text-muted text-xs">
          Tick an event under every channel that should receive it.
        </p>
      </div>
      <Button href={resolve("/notification-channels")} size="sm" variant="outline">
        Manage channels
      </Button>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-border border-b">
            <th class="eyebrow px-5 py-3 text-left font-medium">Event</th>
            {#each data.channels as channel (channel.id)}
              <th class="text-text px-4 py-3 text-center text-xs font-medium whitespace-nowrap">
                {channel.name}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each groups as group (group)}
            <tr class="bg-surface-2/50">
              <td class="eyebrow px-5 py-2" colspan={data.channels.length + 1}>
                {group}
              </td>
            </tr>
            {#each NOTIFICATION_EVENTS.filter((info) => info.group === group) as info (info.event)}
              <tr class="border-border border-b last:border-b-0">
                <td class="px-5 py-3">
                  <p class="text-text font-medium">{info.label}</p>
                  <p class="text-text-subtle text-xs">{info.description}</p>
                </td>
                {#each data.channels as channel (channel.id)}
                  <td class="px-4 py-3 text-center">
                    <div class="flex justify-center">
                      <Checkbox
                        aria-label="{info.label} to {channel.name}"
                        checked={channel.events.includes(info.event)}
                        name="channel:{channel.id}"
                        value={info.event}
                      />
                    </div>
                  </td>
                {/each}
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
    </div>
    <div class="border-border flex justify-end border-t px-5 py-4">
      <Button type="submit">Save</Button>
    </div>
  </form>
{/if}
