<script lang="ts">
	import { ArrowLeft, CalendarClock, Plug, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import CopyBox from "#lib/components/copy-box.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import Skeleton from "#lib/components/skeleton.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { formatBytes } from "#lib/formatting.js";
	import { objectCountLabel } from "#lib/object-storage.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import AccessKeysPanel from "./access-keys-panel.svelte";

	const { data, form } = $props();

	onMount(() => title.set(`Object Storage · ${data.bucket}`));

	let days = $state("");
	$effect(() => {
		days =
			data.detail.expirationDays === null
				? ""
				: String(data.detail.expirationDays);
	});
	let savingLifecycle = $state(false);
	let confirmOpen = $state(false);
	let deleteForm: HTMLFormElement | undefined = $state();
</script>

<div class="space-y-5">
  <a
    class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm"
    href={resolve("/(protected)/object-storage")}
  >
    <ArrowLeft class="size-4" />
    All buckets
  </a>

  <section class="panel rounded-md">
    <div class="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
      <div class="min-w-0">
        <h2 class="text-text font-mono text-sm font-medium break-all">{data.bucket}</h2>
        <p class="text-text-muted mt-0.5 text-xs">
          {data.store.name} ·
          {#await data.usage}
            counting…
          {:then usage}
            {usage
              ? `${objectCountLabel(usage.objects, usage.capped)}, ${formatBytes(usage.bytes)}${usage.capped ? "+" : ""}`
              : "usage unknown"}
          {/await}
        </p>
      </div>
      <form
        bind:this={deleteForm}
        action="?/deleteBucket"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't delete that bucket.",
          loading: `Deleting ${data.bucket}`,
          onSuccess: () => goto(resolve("/(protected)/object-storage")),
          success: "Bucket deleted.",
        })}
      >
        <Button
          onclick={() => {
            confirmOpen = true;
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <Trash2 class="size-3.5" />
          Delete bucket
        </Button>
      </form>
    </div>
    <div class="grid gap-4 px-5 py-4 text-sm md:grid-cols-3">
      <div class="md:col-span-2">
        <p class="text-text-subtle mb-1.5 text-xs">Endpoint</p>
        <CopyBox label="endpoint" value={data.detail.endpoint} />
        {#if data.store.kind === "garage" && !data.detail.endpoint.startsWith("https://")}
          <p class="text-text-subtle mt-1.5 text-xs">
            Reachable from containers on Homerun's network. Publish the
            built-in store under Built-in to reach it from elsewhere.
          </p>
        {/if}
      </div>
      <div>
        <p class="text-text-subtle mb-1.5 text-xs">Region</p>
        <CopyBox label="region" value={data.detail.region} />
        <p class="text-text-subtle mt-1.5 text-xs">Use path-style addressing.</p>
      </div>
    </div>
  </section>

  <section class="panel rounded-md">
    <PanelHeader
      description="Deletes every object this many days after it was written. Leave it empty to keep objects until you delete them."
      icon={CalendarClock}
      title="Lifecycle"
    >
      {#snippet trailing()}
        <SaveButton form="bucket-lifecycle" pending={savingLifecycle} />
      {/snippet}
    </PanelHeader>
    <form
      id="bucket-lifecycle"
      class="px-5 py-4"
      action="?/setExpiration"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the lifecycle.",
        loading: "Saving the lifecycle",
        onSettled: () => {
          savingLifecycle = false;
        },
        onStart: () => {
          savingLifecycle = true;
        },
        success: "Lifecycle saved.",
      })}
    >
      <label class={labelClass} for="expirationDays">Expire objects after (days)</label>
      <input
        id="expirationDays"
        class="{inputClass} max-w-40"
        inputmode="numeric"
        min="1"
        name="days"
        placeholder="Never"
        type="number"
        bind:value={days}
      />
    </form>
  </section>

  <AccessKeysPanel
    createdKey={form?.createdKey ?? null}
    endpoint={data.detail.endpoint}
    keys={data.detail.keys}
    region={data.detail.region}
  />

  <section class="panel rounded-md">
    <PanelHeader
      description={data.store.kind === "garage"
        ? "Adds this bucket as a backup destination, with a read/write key of its own."
        : "Adds this bucket as a backup destination, with the store's credentials."}
      icon={Plug}
      title="Volume backups"
    >
      {#snippet trailing()}
        <form
          action="?/useAsBackupDestination"
          method="POST"
          use:enhance={enhanceToast({
            error: "Couldn't add the backup destination.",
            loading: "Adding the backup destination",
            success: "Backup destination added.",
          })}
        >
          <Button size="sm" type="submit" variant="outline">
            Use for backups
          </Button>
        </form>
      {/snippet}
    </PanelHeader>
    {#if form?.destinationId}
      <p class="text-text-muted px-5 py-4 text-sm">
        Added.
        <a
          class="text-accent hover:underline"
          href={resolve("/(protected)/s3-destinations/[destinationId]", {
            destinationId: form.destinationId,
          })}
        >
          Open the destination
        </a>
        to test it, then pick it on a volume's backup settings.
      </p>
    {/if}
  </section>
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  confirmLabel="Delete"
  description="Only an empty bucket can be deleted. A backup destination or Terraform project pointing at it stops working."
  onConfirm={() => deleteForm?.requestSubmit()}
  title="Delete {data.bucket}?"
/>
