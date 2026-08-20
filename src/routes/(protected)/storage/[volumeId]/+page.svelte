<script lang="ts">
  import { ArrowLeft, Check, CloudUpload, Loader2 } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import CheckBox from "$lib/components/check-box.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { timeAgo } from "$lib/formatting";
  import { title } from "$lib/store/title";

  const { data, form } = $props();
  const vol = $derived(data.volume);

  onMount(() => title.set(`${vol.name} · Backup`));

  const label = "block mb-1.5 text-sm font-medium text-text";

  let submitting = $state(false);
  let backingUp = $state(false);
</script>

<div class="space-y-6 p-6 md:p-8">
  <a
    class="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
    href={resolve("/storage")}
  >
    <ArrowLeft class="size-3.5" />
    Storage
  </a>

  <div>
    <h1 class="text-2xl font-bold text-text">{vol.name}</h1>
    <p class="mt-1 font-mono text-sm text-text-muted">
      {vol.kind}
      · {vol.source}
    </p>
  </div>

  {#if vol.kind !== "bind"}
    <div
      class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300"
    >
      Only bind-mount volumes can be backed up right now — this is a
      Docker-managed named volume.
    </div>
  {:else}
    <section class="rounded-2xl border border-border bg-surface p-5">
      <div class="mb-4 flex items-center gap-3">
        <div
          class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
        >
          <CloudUpload class="size-4" />
        </div>
        <div>
          <p class="text-sm font-medium text-text">S3 backup</p>
          <p class="text-xs text-text-muted">
            Tars this directory and uploads it to an S3-compatible bucket.
            Disabled by default.
            {#if vol.backupLastRunAt}
              · last run {timeAgo(vol.backupLastRunAt)}
            {/if}
          </p>
        </div>
      </div>

      <form
        action="?/updateBackup"
        class="space-y-3"
        method="POST"
        use:enhance={() => {
          submitting = true;
          return async ({ result, update }) => {
            submitting = false;
            if (result.type === "success") {
              toast.success("Saved.");
            } else if (result.type === "failure") {
              toast.error("Check the form for errors.");
            }
            await update();
          };
        }}
      >
        {#if form?.error}
          <p class="text-xs text-red-500">{form.error}</p>
        {/if}

        <CheckBox
          checked={vol.backupEnabled}
          helperText="Tar this directory and upload it to the S3 destination below on schedule"
          id="backupEnabled"
          label="Enable scheduled backups"
          name="backupEnabled"
        />

        <div>
          <label class={label} for="backupSchedule"
            >Schedule (cron syntax)</label
          >
          <Input
            class="font-mono"
            id="backupSchedule"
            name="backupSchedule"
            placeholder="0 3 * * *"
            type="text"
            value={vol.backupSchedule ?? ""}
          />
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class={label} for="backupEndpoint">Endpoint</label>
            <Input
              id="backupEndpoint"
              name="backupEndpoint"
              placeholder="https://s3.us-east-1.amazonaws.com"
              type="text"
              value={vol.backupEndpoint ?? ""}
            />
          </div>
          <div>
            <label class={label} for="backupBucket">Bucket</label>
            <Input
              id="backupBucket"
              name="backupBucket"
              type="text"
              value={vol.backupBucket ?? ""}
            />
          </div>
          <div>
            <label class={label} for="backupRegion">Region</label>
            <Input
              id="backupRegion"
              name="backupRegion"
              placeholder="us-east-1"
              type="text"
              value={vol.backupRegion ?? ""}
            />
          </div>
          <div>
            <label class={label} for="backupPrefix"
              >Key prefix (optional)</label
            >
            <Input
              id="backupPrefix"
              name="backupPrefix"
              placeholder="backups/my-app"
              type="text"
              value={vol.backupPrefix ?? ""}
            />
          </div>
          <div>
            <label class={label} for="backupAccessKeyId">Access key ID</label>
            <Input
              id="backupAccessKeyId"
              name="backupAccessKeyId"
              type="text"
              value={vol.backupAccessKeyId ?? ""}
            />
          </div>
          <div>
            <label class={label} for="backupSecretAccessKey"
              >Secret access key</label
            >
            <Input
              id="backupSecretAccessKey"
              name="backupSecretAccessKey"
              placeholder={vol.backupAccessKeyId ? "Unchanged" : ""}
              type="password"
            />
          </div>
        </div>

        <Button disabled={submitting} type="submit">
          {#if submitting}
            <Loader2 class="size-4 animate-spin" />
          {:else}
            <Check class="size-4" />
          {/if}
          Save
        </Button>
      </form>
    </section>

    <form
      action="?/backupNow"
      method="POST"
      use:enhance={() => {
        backingUp = true;
        return async ({ result, update }) => {
          backingUp = false;
          if (result.type === "success") {
            toast.success("Backup uploaded.");
          } else {
            toast.error("Backup failed — check the volume's config.");
          }
          await update();
        };
      }}
    >
      <Button
        disabled={backingUp || !vol.backupEndpoint}
        type="submit"
        variant="outline"
      >
        {#if backingUp}
          <Loader2 class="size-4 animate-spin" />
          Backing up…
        {:else}
          <CloudUpload class="size-4" />
          Backup now
        {/if}
      </Button>
    </form>
  {/if}
</div>
