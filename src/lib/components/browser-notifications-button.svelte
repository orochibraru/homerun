<script lang="ts">
	import { BellRing } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button } from "#lib/components/ui/button/index.js";
	import {
		browserNotificationPermission,
		requestBrowserNotifications,
	} from "#lib/notification-feed.js";
	import { toastError } from "#lib/toast.js";

	let permission = $state<NotificationPermission | "unsupported">(
		"unsupported",
	);

	onMount(() => {
		permission = browserNotificationPermission();
	});

	async function enableCallback() {
		try {
			await requestBrowserNotifications();
		} finally {
			permission = browserNotificationPermission();
		}
	}

	function handleEnable() {
		return toast.promise(enableCallback(), {
			error: (error) =>
				toastError(error, "Couldn't turn on browser notifications."),
			loading: "Waiting for the browser",
			success: "Browser notifications are on.",
		});
	}
</script>

{#if permission === "default"}
  <Button onclick={handleEnable} size="sm" variant="outline">
    <BellRing class="size-3.5" />
    Turn on browser notifications
  </Button>
{/if}
