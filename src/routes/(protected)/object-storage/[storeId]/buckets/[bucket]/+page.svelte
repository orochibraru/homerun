<script lang="ts">
	import { CalendarClock, Globe, Plug, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import BucketAccessKeys from "#lib/components/bucket-access-keys.svelte";
	import BucketConnection from "#lib/components/bucket-connection.svelte";
	import CheckBox from "#lib/components/check-box.svelte";
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
	let isPublic = $state(false);
	$effect(() => {
		isPublic = data.isPublic;
	});
	let savingPublic = $state(false);
	let confirmOpen = $state(false);
	let deleteForm: HTMLFormElement | undefined = $state();
</script>

<div class="space-y-5">
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
    <BucketConnection
      builtin={data.store.kind === "garage"}
      endpoint={data.detail.endpoint}
      region={data.detail.region}
    />
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

  <section class="panel rounded-md">
    <PanelHeader
      description="A public bucket's objects can be downloaded by anyone with their link, through this instance, without signing in. Listing and uploading still need an access key."
      icon={Globe}
      title="Public access"
    >
      {#snippet trailing()}
        <SaveButton
          disabled={isPublic === data.isPublic}
          form="bucket-public"
          pending={savingPublic}
        />
      {/snippet}
    </PanelHeader>
    <form
      id="bucket-public"
      class="space-y-3 px-5 py-4"
      action="?/setPublic"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't change the bucket's access.",
        loading: "Saving",
        onSettled: () => {
          savingPublic = false;
        },
        onStart: () => {
          savingPublic = true;
        },
        success: "Saved.",
      })}
    >
      <CheckBox
        helperText="Off by default: objects need a signed request or an access key."
        id="bucketPublic"
        label="Public"
        name="public"
        bind:checked={isPublic}
      />
      {#if data.isPublic}
        <div>
          <p class="text-text-subtle mb-1.5 text-xs">Objects are served under</p>
          <CopyBox label="public URL" value={`${data.publicUrl}<key>`} />
        </div>
      {/if}
    </form>
  </section>

  <BucketAccessKeys
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
