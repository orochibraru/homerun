<script lang="ts">
	import { Bell, CheckCheck, X } from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import Skeleton from "$lib/components/skeleton.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Popover from "$lib/components/ui/popover/index.js";
	import { timeAgo } from "$lib/formatting";
	import {
		deleteNotification,
		getNotifications,
		markAllNotificationsRead,
		markNotificationRead,
		type NotificationFeedItem,
	} from "$lib/remote/notifications.remote";

	const feed = getNotifications();

	let open = $state(false);

	const notifications = $derived(feed.current?.items ?? []);
	const unreadCount = $derived(feed.current?.unreadCount ?? 0);

	function onItemClick(n: NotificationFeedItem) {
		open = false;
		if (!n.readAt) {
			void markNotificationRead(n.id);
		}
	}
</script>

<Popover.Root bind:open>
  <div class="relative">
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button {...props} aria-label="Notifications" size="icon-sm" variant="ghost">
          <Bell class="size-4" />
        </Button>
      {/snippet}
    </Popover.Trigger>
    {#if unreadCount > 0}
      <span
        class="bg-accent text-bg pointer-events-none absolute top-0.5 right-0.5 flex size-3.5 items-center justify-center rounded-full text-[0.6rem] font-bold"
      >
        {unreadCount > 9 ? "9+" : unreadCount}
      </span>
    {/if}
  </div>

  <Popover.Content
    align="end"
    class="max-h-96 w-80 gap-0 overflow-y-auto rounded-2xl p-0"
  >
    <div class="border-border flex items-center justify-between border-b px-4 py-3">
      <p class="text-text text-sm font-semibold">Notifications</p>
      {#if unreadCount > 0}
        <Button class="h-auto p-0 text-xs" onclick={() => markAllNotificationsRead()} variant="link">
          <CheckCheck class="size-3.5" />
          Mark all read
        </Button>
      {/if}
    </div>
    {#if !feed.ready}
      <div class="space-y-3 p-4">
        {#each [0, 1, 2] as row (row)}
          <div class="space-y-1.5">
            <Skeleton class="h-3 w-full" />
            <Skeleton class="h-2.5 w-20" />
          </div>
        {/each}
      </div>
    {:else if notifications.length === 0}
      <p class="text-text-muted p-4 text-center text-sm">No notifications yet.</p>
    {:else}
      <div>
        {#each notifications as n (n.id)}
          <div
            class="border-border/60 hover:bg-surface-2 group flex items-start gap-1 border-b last:border-0 {n.readAt
            ? ''
            : 'bg-accent-light/40'}"
          >
            {#if n.serviceId}
              <a
                class="min-w-0 flex-1 px-4 py-3"
                href="{resolve('/services')}/{n.serviceId}"
                onclick={() => onItemClick(n)}
              >
                <p class="text-text text-xs">{n.message}</p>
                <p class="text-text-subtle mt-0.5 text-[0.65rem]">
                  {timeAgo(n.createdAt)}
                </p>
              </a>
            {:else}
              <button
                class="min-w-0 flex-1 px-4 py-3 text-left"
                onclick={() => onItemClick(n)}
                type="button"
              >
                <p class="text-text text-xs">{n.message}</p>
                <p class="text-text-subtle mt-0.5 text-[0.65rem]">
                  {timeAgo(n.createdAt)}
                </p>
              </button>
            {/if}
            <button
              aria-label="Delete notification"
              class="text-text-subtle hover:bg-surface-3 hover:text-text mt-2 mr-2 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100"
              onclick={() => deleteNotification(n.id)}
              type="button"
            >
              <X class="size-3" />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </Popover.Content>
</Popover.Root>
