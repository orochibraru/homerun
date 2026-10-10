<script lang="ts">
	import { Bell, CheckCheck } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import BrowserNotificationsButton from "#lib/components/browser-notifications-button.svelte";
	import NotificationRow from "#lib/components/notification-row.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import {
		getUnreadNotifications,
		markAllNotificationsRead,
	} from "#lib/remote/notifications.remote.js";
	import { toastError } from "#lib/toast.js";
	import { resolve } from "$app/paths";

	const unread = getUnreadNotifications();

	const items = $derived(unread.current?.items ?? []);
	const unreadCount = $derived(unread.current?.unreadCount ?? 0);

	function handleMarkAllRead() {
		return toast.promise(markAllNotificationsRead(), {
			error: (error) => toastError(error, "Couldn't mark them read."),
			loading: "Marking everything read",
			success: "All caught up.",
		});
	}
</script>

{#if unreadCount > 0}
  <section class="panel mb-4 rounded-xl">
    <div class="panel-head flex-wrap gap-2">
      <h2 class="eyebrow flex items-center gap-1.5">
        <Bell class="size-3.5" />
        {unreadCount} unread {unreadCount === 1 ? "notification" : "notifications"}
      </h2>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <BrowserNotificationsButton />
        <Button onclick={handleMarkAllRead} size="sm" variant="ghost">
          <CheckCheck class="size-3.5" />
          Mark all read
        </Button>
        <Button href={resolve("notifications")} size="sm" variant="outline">View all</Button>
      </div>
    </div>
    <div class="divide-border divide-y">
      {#each items as item (item.id)}
        <NotificationRow {item} />
      {/each}
    </div>
    {#if unreadCount > items.length}
      <a
        class="border-border text-text-muted hover:text-text block border-t px-4 py-2.5 text-xs"
        href={resolve("notifications")}
      >
        And {unreadCount - items.length} more unread.
      </a>
    {/if}
  </section>
{/if}
