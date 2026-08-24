<script lang="ts">
	import {
		Check,
		Clock,
		FolderKanban,
		LayoutGrid,
		Server,
		Settings,
		Trash2Icon,
		TriangleAlertIcon,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import CheckBox from "$lib/components/check-box.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { timeAgo } from "$lib/formatting";
	import { title } from "$lib/store/title";

	const { data, form } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Settings`));

	const label = "block mb-1.5 text-sm font-medium text-text";
	const errorClass = "mt-1.5 text-xs text-red-500";

	const values = $derived(
		(form?.values as Record<string, string> | undefined) ?? {
			name: svc.name,
			restartPolicy: svc.restartPolicy,
			slug: svc.slug,
		},
	);
	const errors = $derived(form?.errors as Record<string, string[]> | undefined);

	let submitting = $state(false);
	let showDeleteConfirm = $state(false);
	let deleting = $state(false);

	const restartPolicyOptions: [string, string][] = [
		["unless-stopped", "Unless stopped"],
		["always", "Always"],
		["on-failure", "On failure"],
		["no", "Never"],
	];
	let restartPolicy = $derived(values.restartPolicy);
	const restartPolicyLabel = $derived(
		restartPolicyOptions.find(([val]) => val === restartPolicy)?.[1] ??
			"Unless stopped",
	);

	let projectId = $derived(svc.projectId ?? "");
	const projectLabel = $derived(
		data.projects.find((p) => p.id === projectId)?.name ?? "Ungrouped",
	);

	let remoteHostId = $derived(svc.remoteHostId ?? "");
	const remoteHostLabel = $derived(
		data.remoteHosts.find((h) => h.id === remoteHostId)?.name ?? "This host",
	);
</script>

<div class="space-y-6">
  <section class="border-border bg-surface rounded-2xl border">
    <div class="border-border flex items-center gap-3 border-b px-5 py-4">
      <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
        <Settings class="size-4" />
      </div>
      <div>
        <h2 class="text-text text-sm font-semibold">Service settings</h2>
        <p class="text-text-muted text-xs">
          Changes take effect on the next deploy.
        </p>
      </div>
    </div>

    <form
      action="?/update"
      class="space-y-5 p-5"
      method="POST"
      use:enhance={() => {
        submitting = true;
        return async ({ result, update }) => {
          submitting = false;
          if (result.type === "success") {
            toast.success("Saved.", {
              action: {
                label: "Redeploy",
                onClick: () =>
                  goto(
                    resolve("/(protected)/services/[serviceId]", {
                      serviceId: svc.id,
                    }),
                  ),
              },
              description: "Changes take effect on the next deploy.",
            });
          }
          if (result.type === "failure") {
            toast.error("Check the form for errors.");
          }
          await update();
        };
      }}
    >
      <div>
        <label class={label} for="name">
          Name <span class="text-red-500">*</span>
        </label>
        <Input id="name" name="name" required type="text" value={values.name} />
        {#if errors?.name}
          <p class={errorClass}>{errors.name[0]}</p>
        {/if}
      </div>

      <div>
        <label class={label} for="slug">
          Slug <span class="text-red-500">*</span>
        </label>
        <Input
          id="slug"
          maxlength={63}
          name="slug"
          pattern="[a-z0-9\-]+"
          required
          type="text"
          value={values.slug}
        />
        <p class="text-text-subtle mt-1 text-xs">
          Routed at
          <span class="text-accent">{values.slug}.{data.baseDomain}</span>
          : redeploy to apply a change.
        </p>
        {#if errors?.slug}
          <p class={errorClass}>{errors.slug[0]}</p>
        {/if}
      </div>

      <p class="text-text-subtle text-xs">
        Container port, network mode, and DNS-resolvability moved to the
        <a
          class="text-accent underline"
          href={resolve("/(protected)/services/[serviceId]/networking", {
            serviceId: svc.id,
          })}
        >Networking</a>
        tab.
      </p>

      <div>
        <label class={label} for="restartPolicy">Restart policy</label>
        <SelectRoot
          name="restartPolicy"
          type="single"
          bind:value={restartPolicy}
        >
          <SelectTrigger class="w-full" id="restartPolicy">
            {restartPolicyLabel}
          </SelectTrigger>
          <SelectContent>
            {#each restartPolicyOptions as [val, lbl] (val)}
              <SelectItem label={lbl} value={val} />
            {/each}
          </SelectContent>
        </SelectRoot>
      </div>

      <p class="text-text-subtle text-xs">
        CPU/memory limits and autoscaling moved to the
        <a
          class="text-accent underline"
          href={resolve("/(protected)/services/[serviceId]/compute", {
            serviceId: svc.id,
          })}
        >Compute</a>
        tab.
      </p>

      <div class="flex justify-end">
        <Button disabled={submitting} type="submit">
          {#if submitting}
            <Spinner />
            Saving…
          {:else}
            <Check class="size-4" />
            Save
          {/if}
        </Button>
      </div>
    </form>
  </section>

  <!-- ═══ Project ═══ -->
  <section class="border-border bg-surface rounded-2xl border">
    <div class="flex items-center justify-between gap-4 p-5">
      <div class="flex items-center gap-3">
        <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
          <FolderKanban class="size-4" />
        </div>
        <div>
          <p class="text-text text-sm font-medium">Project</p>
          <p class="text-text-muted text-xs">
            Move this service into a different project, or ungroup it.
          </p>
        </div>
      </div>
      <form
        action="?/moveProject"
        class="flex w-75 items-center gap-2"
        method="POST"
        use:enhance={() => async ({ result, update }) => {
          if (result.type === "success") {
            toast.success("Moved.");
          } else {
            toast.error("Couldn't move the service.");
          }
          await update();
        }}
      >
        <SelectRoot name="projectId" type="single" bind:value={projectId}>
          <SelectTrigger class="w-full">
            {projectLabel}
          </SelectTrigger>
          <SelectContent>
            <SelectItem label="Ungrouped" value="" />
            {#each data.projects as proj (proj.id)}
              <SelectItem label={proj.name} value={proj.id} />
            {/each}
          </SelectContent>
        </SelectRoot>
        <Button class="shrink-0" type="submit" variant="outline">Move</Button>
      </form>
    </div>
  </section>

  <!-- ═══ Deploy target (remote host) ═══ -->
  <section class="border-border bg-surface rounded-2xl border">
    <div class="flex items-center justify-between gap-4 p-5">
      <div class="flex items-center gap-3">
        <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
          <Server class="size-4" />
        </div>
        <div>
          <p class="text-text text-sm font-medium">Deploy target</p>
          <p class="text-text-muted text-xs">
            Which Docker daemon this service runs on. Changing this only takes
            effect on the next deploy : the current container, if any, keeps
            running where it is.
          </p>
        </div>
      </div>
      <form
        action="?/moveRemoteHost"
        class="flex w-75 items-center gap-2"
        method="POST"
        use:enhance={() => async ({
          result,
          update,
        }: {
          result: { type: string; data?: { error?: string } };
          update: () => Promise<void>;
        }) => {
          if (result.type === "success") {
            toast.success("Saved.");
          } else {
            toast.error(
              result.data?.error ?? "Couldn't change the deploy target.",
            );
          }
          await update();
        }}
      >
        <SelectRoot name="remoteHostId" type="single" bind:value={remoteHostId}>
          <SelectTrigger class="w-full">
            {remoteHostLabel}
          </SelectTrigger>
          <SelectContent>
            <SelectItem label="This host" value="" />
            {#each data.remoteHosts as host (host.id)}
              <SelectItem label={host.name} value={host.id} />
            {/each}
          </SelectContent>
        </SelectRoot>
        <Button class="shrink-0" type="submit" variant="outline">Save</Button>
      </form>
    </div>
  </section>

  <!-- ═══ Save as template ═══ -->
  <section class="border-border bg-surface rounded-2xl border">
    <div class="flex items-center justify-between gap-4 p-5">
      <div class="flex items-center gap-3">
        <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
          <LayoutGrid class="size-4" />
        </div>
        <div>
          <p class="text-text text-sm font-medium">Save as template</p>
          <p class="text-text-muted text-xs">
            Reuse this config to deploy another service later.
          </p>
        </div>
      </div>
      <form
        action="?/saveAsTemplate"
        method="POST"
        use:enhance={() => async ({ result, update }) => {
          if (result.type === "success") {
            toast.success("Saved as a template.");
          } else {
            toast.error("Couldn't save the template.");
          }
          await update();
        }}
      >
        <Button class="shrink-0" type="submit" variant="outline">
          Save as template
        </Button>
      </form>
    </div>
  </section>

  <!-- ═══ Auto-redeploy (cron) ═══ -->
  <section class="border-border bg-surface rounded-2xl border p-5">
    <div class="mb-4 flex items-center gap-3">
      <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
        <Clock class="size-4" />
      </div>
      <div>
        <p class="text-text text-sm font-medium">Auto-redeploy schedule</p>
        <p class="text-text-muted text-xs">
          Periodically repull the image and redeploy : useful for tracking a
          <code>:latest</code>
          tag. Disabled by default.
        </p>
      </div>
    </div>

    <form
      action="?/updateCron"
      class="space-y-3"
      method="POST"
      use:enhance={() => async ({ result, update }) => {
        if (result.type === "success") {
          toast.success("Saved.");
        } else if (result.type === "failure") {
          toast.error("Check the schedule for errors.");
        }
        await update();
      }}
    >
      {#if form?.cronError}
        <p class={errorClass}>{form.cronError}</p>
      {/if}

      <CheckBox
        checked={svc.cronEnabled}
        helperText="Automatically re-deploy this app"
        id="cronEnabled"
        label="Enable auto-redeploy"
        name="cronEnabled"
      />
      <div>
        <label class={label} for="cronSchedule">Schedule (cron syntax)</label>
        <Input
          class="font-mono"
          id="cronSchedule"
          name="cronSchedule"
          placeholder="0 3 * * *"
          type="text"
          value={svc.cronSchedule ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          Standard 5-field cron ("min hour day month weekday"), server local
          time. E.g. <code>0 3 * * *</code> = every day at 3am.
          {#if svc.cronLastRunAt}
            · last run {timeAgo(svc.cronLastRunAt)}
          {/if}
        </p>
      </div>
      <Button type="submit" variant="outline">Save schedule</Button>
    </form>
  </section>

  <!-- ═══ Danger zone ═══ -->
  <section class="bg-surface rounded-2xl border border-red-200 dark:border-red-900/40">
    <div class="flex items-center gap-3 border-b border-red-100 px-5 py-4 dark:border-red-900/30">
      <div class="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600">
        <TriangleAlertIcon class="size-4" />
      </div>
      <div>
        <h2 class="text-sm font-semibold text-red-600 dark:text-red-400">
          Danger zone
        </h2>
        <p class="text-text-muted text-xs">
          Irreversible. Removes the container and all deployment history.
        </p>
      </div>
    </div>
    <div class="p-5">
      {#if !showDeleteConfirm}
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-text text-sm font-medium">Delete this service</p>
          </div>
          <Button
            onclick={() => {
              showDeleteConfirm = true;
            }}
            variant="destructive"
          >
            Delete service
          </Button>
        </div>
      {:else}
        <form
          action="?/delete"
          class="space-y-4"
          method="POST"
          use:enhance={() => {
            deleting = true;
            return ({ result }) => {
              if (result.type === "redirect") {
                toast.success("Service deleted.");
                goto(result.location);
              } else {
                deleting = false;
                toast.error("Couldn't delete the service.");
              }
            };
          }}
        >
          <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
            <p class="font-semibold">Delete "{svc.name}"?</p>
            <p class="mt-1">
              Its container will be stopped and removed. This can't be undone.
            </p>
          </div>
          <div class="flex items-center gap-3">
            <Button
              onclick={() => {
                showDeleteConfirm = false;
              }}
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={deleting} type="submit" variant="destructive">
              {#if deleting}
                <Spinner />
                Deleting…
              {:else}
                <Trash2Icon class="size-4" />
                Yes, delete
              {/if}
            </Button>
          </div>
        </form>
      {/if}
    </div>
  </section>
</div>
