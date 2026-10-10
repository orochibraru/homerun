<script lang="ts">
	import { X } from "@lucide/svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { timeAgo } from "#lib/formatting.js";
	import {
		isFailureNotification,
		notificationHref,
	} from "#lib/notification-feed.js";
	import {
		markNotificationRead,
		type NotificationFeedItem,
	} from "#lib/remote/notifications.remote.js";

	interface Props {
		item: NotificationFeedItem;
		onDelete?: (id: string) => void;
		showDetail?: boolean;
	}

	const { item, onDelete, showDetail = false }: Props = $props();

	const href = $derived(notificationHref(item));
	const failed = $derived(isFailureNotification(item.type));

	function markRead() {
		if (!item.readAt) {
			void markNotificationRead(item.id);
		}
	}
</script>

<div class="group flex items-start gap-3 px-4 py-3 {item.readAt ? '' : 'bg-accent-light/40'}">
  <span
    class="mt-1.5 size-2 shrink-0 rounded-full {failed
      ? 'bg-red-500'
      : item.readAt
        ? 'bg-border'
        : 'bg-accent'}"
  ></span>
  <div class="min-w-0 flex-1">
    {#if item.stackName}
      <p class="text-text-subtle text-xs font-medium">{item.stackName}</p>
    {/if}
    {#if href}
      <a class="text-text text-sm wrap-break-word hover:underline" {href} onclick={markRead}>{item.message}</a>
    {:else}
      <button class="text-text text-left text-sm wrap-break-word" onclick={markRead} type="button">
        {item.message}
      </button>
    {/if}
    {#if showDetail && item.detail}
      <p class="text-text-muted mt-1.5 text-xs wrap-break-word whitespace-pre-line">{item.detail}</p>
    {/if}
    <p class="text-text-subtle mt-0.5 text-xs">{timeAgo(item.createdAt)}</p>
  </div>
  {#if onDelete}
    <Button aria-label="Delete notification" onclick={() => onDelete(item.id)} size="icon-sm" variant="ghost">
      <X class="size-3.5" />
    </Button>
  {/if}
</div>
