<script lang="ts">
	import { Bell, CheckCheck } from "@lucide/svelte";
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { Button } from "$lib/components/ui/button/index.js";
	import { timeAgo } from "$lib/formatting";

	interface NotificationItem {
		createdAt: Date | string;
		id: string;
		message: string;
		readAt: Date | string | null;
		serviceId: string | null;
	}

	const {
		notifications,
		unreadCount,
	}: { notifications: NotificationItem[]; unreadCount: number } = $props();

	let open = $state(false);

	async function markRead(id: string) {
		await fetch(`/notifications/${id}/read`, { method: "POST" });
		await invalidateAll();
	}

	async function markAllRead() {
		await fetch("/notifications/read-all", { method: "POST" });
		await invalidateAll();
	}

	function onItemClick(n: NotificationItem) {
		open = false;
		if (!n.readAt) {
			markRead(n.id);
		}
	}
</script>

<div class="relative">
  <Button
    aria-label="Notifications"
    onclick={() => {
      open = !open;
    }}
    size="icon-sm"
    variant="ghost"
  >
    <Bell class="size-4" />
  </Button>
  {#if unreadCount > 0}
    <span
      class="bg-accent text-bg absolute top-0.5 right-0.5 flex size-3.5 items-center justify-center rounded-full text-[0.6rem] font-bold"
    >
      {unreadCount > 9 ? "9+" : unreadCount}
    </span>
  {/if}
</div>

{#if open}
  <button
    aria-label="Close notifications"
    class="fixed inset-0 z-40"
    onclick={() => {
      open = false;
    }}
    type="button"
  >
  </button>
  <div
    class="border-border bg-surface absolute top-full right-0 z-50 mt-1 max-h-96 w-80 overflow-y-auto rounded-2xl border shadow-xl"
  >
    <div class="border-border flex items-center justify-between border-b px-4 py-3">
      <p class="text-text text-sm font-semibold">Notifications</p>
      {#if unreadCount > 0}
        <Button class="h-auto p-0 text-xs" onclick={markAllRead} variant="link">
          <CheckCheck class="size-3.5" />
          Mark all read
        </Button>
      {/if}
    </div>
    {#if notifications.length === 0}
      <p class="text-text-muted p-4 text-center text-sm">No notifications yet.</p>
    {:else}
      <div>
        {#each notifications as n (n.id)}
          {#if n.serviceId}
            <a
              class="border-border/60 hover:bg-surface-2 block border-b px-4 py-3 last:border-0 {n.readAt
              ? ''
              : 'bg-accent-light/40'}"
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
              class="border-border/60 hover:bg-surface-2 block w-full border-b px-4 py-3 text-left last:border-0 {n.readAt
              ? ''
              : 'bg-accent-light/40'}"
              onclick={() => onItemClick(n)}
              type="button"
            >
              <p class="text-text text-xs">{n.message}</p>
              <p class="text-text-subtle mt-0.5 text-[0.65rem]">
                {timeAgo(n.createdAt)}
              </p>
            </button>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}
