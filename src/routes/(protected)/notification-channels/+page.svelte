<script lang="ts">
	import {
		BellRing,
		Hash,
		Mail,
		MessageCircle,
		Plus,
		Send,
		SlidersHorizontal,
		Trash2,
		Webhook,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { inputClass, labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { NOTIFICATION_EVENTS } from "$lib/notification-events";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import type { NotificationChannelKind } from "$lib/types";

	const { data, form } = $props();

	onMount(() => title.set("Notification Channels"));

	let channelKind = $state<NotificationChannelKind>("discord");
	let creating = $state(false);

	let deleteDialogOpen = $state(false);
	let pendingDeleteName = $state("");
	let pendingDeleteForm: HTMLFormElement | null = null;

	function requestDelete(event: MouseEvent, name: string) {
		pendingDeleteForm = (event.currentTarget as HTMLElement).closest("form");
		pendingDeleteName = name;
		deleteDialogOpen = true;
	}

	const KIND_LABEL: Record<NotificationChannelKind, string> = {
		discord: "Discord",
		email: "Email",
		slack: "Slack",
		telegram: "Telegram",
		webhook: "Webhook",
	};

	const TARGET_PLACEHOLDER: Record<NotificationChannelKind, string> = {
		discord: "https://discord.com/api/webhooks/…",
		email: "oncall@example.com",
		slack: "https://hooks.slack.com/services/…",
		telegram: "",
		webhook: "https://hooks.example.com/…",
	};

	function eventSummary(events: string[]): string {
		const labels = NOTIFICATION_EVENTS.filter((info) =>
			events.includes(info.event),
		).map((info) => info.label);
		return labels.length === 0 ? "No events" : labels.join(", ");
	}
</script>

<div class="p-5 md:p-6">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">
        Notification Channels
      </h1>
      <p class="text-text-muted mt-1 text-sm">
        Where Homerun sends build, update and uptime notifications. Pick which
        events each channel receives in your notification settings.
      </p>
    </div>
    <Button href={resolve("/profile/notifications")} size="sm" variant="outline">
      <SlidersHorizontal class="size-4" />
      Notification settings
    </Button>
  </div>

  <section class="panel mb-6 rounded-md">
    <div class="panel-head">
      <h2 class="eyebrow flex items-center gap-1.5">
        <Plus class="size-3" />
        Add a channel
      </h2>
      <span class="text-text-subtle text-[0.6875rem]">
        New channels get build and update failures by default
      </span>
    </div>
    <form
      action="?/createChannel"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't add the channel.",
        loading: "Adding the channel",
        onSettled: () => {
          creating = false;
        },
        onStart: () => {
          creating = true;
        },
        reset: true,
        success: "Channel added.",
      })}
    >
      <div class="grid gap-4 md:grid-cols-3">
        <div>
          <label class={label} for="channelName">Name</label>
          <Input id="channelName" name="name" placeholder="On-call Discord" />
        </div>
        <div>
          <label class={label} for="channelKind">Kind</label>
          <select
            bind:value={channelKind}
            class={inputClass}
            id="channelKind"
            name="kind"
          >
            <option value="discord">Discord</option>
            <option value="slack">Slack</option>
            <option value="telegram">Telegram</option>
            <option value="webhook">Webhook</option>
            <option value="email">Email</option>
          </select>
        </div>
        {#if channelKind === "telegram"}
          <div>
            <label class={label} for="telegramBotToken">Bot token</label>
            <Input
              autocomplete="off"
              id="telegramBotToken"
              name="telegramBotToken"
              placeholder="123456789:AA…"
              type="password"
            />
          </div>
        {:else}
          <div>
            <label class={label} for="channelTarget">
              {channelKind === "email" ? "Address" : "Webhook URL"}
            </label>
            <Input
              id="channelTarget"
              name="target"
              placeholder={TARGET_PLACEHOLDER[channelKind]}
            />
          </div>
        {/if}
      </div>
      {#if channelKind === "telegram"}
        <div class="grid gap-4 md:grid-cols-3">
          <div class="md:col-start-3">
            <label class={label} for="telegramChatId">Chat id</label>
            <Input
              id="telegramChatId"
              name="telegramChatId"
              placeholder="-1001234567890 or @channel"
            />
          </div>
        </div>
        <p class="text-text-subtle text-xs">
          Create a bot with @BotFather, add it to the chat, and use the chat's
          numeric id (or a public channel's @name).
        </p>
      {/if}
      {#if form?.errors && "target" in form.errors && form.errors.target}
        <p class="text-xs text-red-500">{form.errors.target[0]}</p>
      {/if}
      <div class="flex justify-end">
        <Button disabled={creating} type="submit">
          <Plus class="size-4" />
          Add channel
        </Button>
      </div>
    </form>
  </section>

  {#if data.channels.length === 0}
    <EmptyState
      icon={BellRing}
      subtitle="Add a Discord, Slack or Telegram channel, a generic webhook or an email address above."
      title="No notification channels yet"
    />
  {:else}
    <section class="panel rounded-md">
      <div class="panel-head">
        <h2 class="eyebrow flex items-center gap-1.5">
          <Send class="size-3" />
          Channels
        </h2>
      </div>
      <div class="divide-border divide-y">
        {#each data.channels as channel (channel.id)}
          <div class="flex flex-wrap items-center gap-3 px-5 py-3">
            {#if channel.kind === "webhook"}
              <Webhook class="text-text-muted size-4 shrink-0" />
            {:else if channel.kind === "discord"}
              <MessageCircle class="text-text-muted size-4 shrink-0" />
            {:else if channel.kind === "slack"}
              <Hash class="text-text-muted size-4 shrink-0" />
            {:else if channel.kind === "telegram"}
              <Send class="text-text-muted size-4 shrink-0" />
            {:else}
              <Mail class="text-text-muted size-4 shrink-0" />
            {/if}
            <div class="min-w-0 flex-1">
              <p class="text-text truncate text-sm font-medium">
                {channel.name}
                <span class="text-text-subtle ml-1 text-xs font-normal">
                  {KIND_LABEL[channel.kind]}
                </span>
              </p>
              <p class="text-text-subtle truncate text-xs">{channel.target}</p>
              <p class="text-text-muted truncate text-xs">
                {eventSummary(channel.events)}
              </p>
              {#if channel.lastError}
                <p class="truncate text-xs text-red-500">{channel.lastError}</p>
              {/if}
            </div>
            <form
              action="?/testChannel"
              method="POST"
              use:enhance={enhanceToast({
                error: "Couldn't send the test notification.",
                loading: "Sending a test notification",
                success: "Test notification sent.",
              })}
            >
              <input name="channelId" type="hidden" value={channel.id} />
              <Button size="sm" type="submit" variant="outline">Send test</Button>
            </form>
            <form
              action="?/deleteChannel"
              method="POST"
              use:enhance={enhanceToast({
                error: "Couldn't remove the channel.",
                loading: "Removing the channel",
                success: "Channel removed.",
              })}
            >
              <input name="channelId" type="hidden" value={channel.id} />
              <Button
                aria-label="Remove {channel.name}"
                class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
                onclick={(event) => requestDelete(event, channel.name)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Trash2 class="size-4" />
              </Button>
            </form>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Remove"
  description={`Remove "${pendingDeleteName}"? It stops receiving notifications.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Remove notification channel"
/>
