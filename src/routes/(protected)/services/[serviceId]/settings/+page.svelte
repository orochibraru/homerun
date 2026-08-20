<script lang="ts">
  import {
    Check,
    ChevronDown,
    Clock,
    FolderKanban,
    GitBranch,
    LayoutGrid,
    Lock,
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
      buildSource: svc.buildSource,
      containerPort: String(svc.containerPort),
      cpuLimit: svc.cpuLimit ?? "",
      dnsResolvable: svc.dnsResolvable ? "on" : "",
      gitBuildContext: svc.gitBuildContext ?? "",
      gitDockerfilePath: svc.gitDockerfilePath ?? "",
      gitRef: svc.gitRef ?? "main",
      gitUrl: svc.gitUrl ?? "",
      image: svc.image,
      memoryLimitMb: svc.memoryLimitMb ? String(svc.memoryLimitMb) : "",
      name: svc.name,
      registryUrl: svc.registryUrl ?? "",
      registryUsername: svc.registryUsername ?? "",
      restartPolicy: svc.restartPolicy,
      slug: svc.slug,
      tag: svc.tag,
    }
  );
  const errors = $derived(form?.errors as Record<string, string[]> | undefined);

  let submitting = $state(false);
  let showRegistry = $derived(!!svc.registryUsername);
  let showDeleteConfirm = $state(false);
  let deleting = $state(false);

  let buildSource = $derived<"image" | "git">(
    (values.buildSource as "image" | "git") ?? "image"
  );
  let image = $derived(values.image);
  let tag = $derived(values.tag);
  let registryUrl = $derived(values.registryUrl);
  let gitUrl = $derived(values.gitUrl);
  let gitRef = $derived(values.gitRef);
  let imageCheck = $state<{ checked: boolean; exists: boolean } | null>(null);
  let imageCheckTimer: ReturnType<typeof setTimeout> | undefined;

  const restartPolicyOptions: [string, string][] = [
    ["unless-stopped", "Unless stopped"],
    ["always", "Always"],
    ["on-failure", "On failure"],
    ["no", "Never"],
  ];
  let restartPolicy = $derived(values.restartPolicy);
  const restartPolicyLabel = $derived(
    restartPolicyOptions.find(([val]) => val === restartPolicy)?.[1] ??
      "Unless stopped"
  );

  let projectId = $derived(svc.projectId ?? "");
  const projectLabel = $derived(
    data.projects.find((p) => p.id === projectId)?.name ?? "Ungrouped"
  );

  let remoteHostId = $derived(svc.remoteHostId ?? "");
  const remoteHostLabel = $derived(
    data.remoteHosts.find((h) => h.id === remoteHostId)?.name ?? "This host"
  );

  function scheduleImageCheck() {
    clearTimeout(imageCheckTimer);
    if (!image.trim()) {
      imageCheck = null;
      return;
    }
    imageCheckTimer = setTimeout(async () => {
      try {
        const res = await fetch(resolve("/services/check-image"), {
          body: JSON.stringify({ image, registryUrl, tag }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        imageCheck = res.ok ? await res.json() : null;
      } catch {
        imageCheck = null;
      }
    }, 600);
  }

  onMount(() => {
    scheduleImageCheck();
  });
</script>

<div class="space-y-6">
  <section class="rounded-2xl border border-border bg-surface">
    <div class="flex items-center gap-3 border-b border-border px-5 py-4">
      <div
        class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
      >
        <Settings class="size-4" />
      </div>
      <div>
        <h2 class="text-sm font-semibold text-text">Service settings</h2>
        <p class="text-xs text-text-muted">
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
        <p class="mt-1 text-xs text-text-subtle">
          Routed at
          <span class="text-accent">{values.slug}.{data.baseDomain}</span>
          — redeploy to apply a change.
        </p>
        {#if errors?.slug}
          <p class={errorClass}>{errors.slug[0]}</p>
        {/if}
      </div>

      <div>
        <div class={label}>Deploy from</div>
        <div class="flex gap-2">
          <button
            class="flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all {buildSource ===
            'image'
              ? 'border-accent bg-accent-light text-accent'
              : 'border-border text-text-muted hover:bg-surface-2'}"
            onclick={() => {
              buildSource = "image";
            }}
            type="button"
          >
            Docker image
          </button>
          <button
            class="flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all {buildSource ===
            'git'
              ? 'border-accent bg-accent-light text-accent'
              : 'border-border text-text-muted hover:bg-surface-2'}"
            onclick={() => {
              buildSource = "git";
            }}
            type="button"
          >
            <GitBranch class="size-4" />
            Git repository
          </button>
        </div>
        <input name="buildSource" type="hidden" value={buildSource}>
        <p class="mt-1.5 text-xs text-text-subtle">
          Switching this doesn't redeploy by itself — save, then redeploy from
          the Overview tab.
        </p>
      </div>

      {#if buildSource === "image"}
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2">
            <label class={label} for="image">
              Image <span class="text-red-500">*</span>
            </label>
            <Input
              id="image"
              name="image"
              oninput={scheduleImageCheck}
              required
              type="text"
              bind:value={image}
            />
            {#if errors?.image}
              <p class={errorClass}>{errors.image[0]}</p>
            {/if}
          </div>
          <div>
            <label class={label} for="tag">Tag</label>
            <Input
              id="tag"
              name="tag"
              oninput={scheduleImageCheck}
              type="text"
              bind:value={tag}
            />
          </div>
        </div>

        {#if imageCheck?.checked && !imageCheck.exists}
          <div
            class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400"
          >
            <TriangleAlertIcon class="mt-0.5 size-3.5 shrink-0" />
            <span>
              <strong>{image}:{tag}</strong>
              wasn't found in its registry. You can still save — this doesn't
              block deploying.
            </span>
          </div>
        {/if}
      {:else}
        <div>
          <label class={label} for="gitUrl">
            Repository URL <span class="text-red-500">*</span>
          </label>
          <Input
            id="gitUrl"
            name="gitUrl"
            placeholder="https://github.com/acme/api.git"
            required
            type="text"
            bind:value={gitUrl}
          />
          {#if errors?.gitUrl}
            <p class={errorClass}>{errors.gitUrl[0]}</p>
          {/if}
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class={label} for="gitRef">Branch / tag</label>
            <Input
              id="gitRef"
              name="gitRef"
              placeholder="main"
              type="text"
              bind:value={gitRef}
            />
          </div>
          <div>
            <label class={label} for="gitDockerfilePath">Dockerfile path</label>
            <Input
              id="gitDockerfilePath"
              name="gitDockerfilePath"
              placeholder="Dockerfile"
              type="text"
              value={values.gitDockerfilePath}
            />
          </div>
        </div>
        <div>
          <label class={label} for="gitBuildContext">
            Build context (subdirectory)
          </label>
          <Input
            id="gitBuildContext"
            name="gitBuildContext"
            placeholder="Leave blank for repo root"
            type="text"
            value={values.gitBuildContext}
          />
        </div>
      {/if}

      <div>
        <label class={label} for="containerPort">
          Container port <span class="text-red-500">*</span>
        </label>
        <Input
          id="containerPort"
          max="65535"
          min="1"
          name="containerPort"
          required
          type="number"
          value={values.containerPort}
        />
        {#if errors?.containerPort}
          <p class={errorClass}>{errors.containerPort[0]}</p>
        {/if}
      </div>

      <CheckBox
        checked={values.dnsResolvable === "on"}
        helperText="Get a public {values.slug}.{data.baseDomain} route. Turn off to keep this service reachable only from other services on the same network. Takes effect on the next deploy."
        id="dnsResolvable"
        label="DNS-resolvable"
        name="dnsResolvable"
      />

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

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class={label} for="cpuLimit">CPU limit</label>
          <Input
            id="cpuLimit"
            name="cpuLimit"
            placeholder="e.g. 0.5 (cores)"
            type="text"
            value={values.cpuLimit}
          />
          {#if errors?.cpuLimit}
            <p class={errorClass}>{errors.cpuLimit[0]}</p>
          {/if}
        </div>
        <div>
          <label class={label} for="memoryLimitMb">Memory limit (MB)</label>
          <Input
            id="memoryLimitMb"
            min="1"
            name="memoryLimitMb"
            placeholder="e.g. 512"
            type="number"
            value={values.memoryLimitMb}
          />
          {#if errors?.memoryLimitMb}
            <p class={errorClass}>{errors.memoryLimitMb[0]}</p>
          {/if}
        </div>
      </div>

      <div class="rounded-xl border border-border">
        <Button
          class="h-auto w-full justify-start gap-3 px-4 py-3 font-normal text-text"
          onclick={() => {
            showRegistry = !showRegistry;
          }}
          variant="ghost"
        >
          <Lock class="size-4 text-text-muted" />
          <span class="flex-1 text-sm font-medium text-text">
            Private registry
          </span>
          <ChevronDown
            class="size-4 text-text-muted transition-transform {showRegistry
              ? 'rotate-180'
              : ''}"
          />
        </Button>
        {#if showRegistry}
          <div class="space-y-4 border-t border-border p-4">
            <div>
              <label class={label} for="registryUrl">Registry URL</label>
              <Input
                id="registryUrl"
                name="registryUrl"
                oninput={scheduleImageCheck}
                type="text"
                bind:value={registryUrl}
              />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class={label} for="registryUsername">Username</label>
                <Input
                  id="registryUsername"
                  name="registryUsername"
                  type="text"
                  value={values.registryUsername}
                />
              </div>
              <div>
                <label class={label} for="registryPassword">
                  Password / token
                </label>
                <Input
                  id="registryPassword"
                  name="registryPassword"
                  placeholder="Leave blank to keep current"
                  type="password"
                />
              </div>
            </div>
          </div>
        {/if}
      </div>

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
  <section class="rounded-2xl border border-border bg-surface">
    <div class="flex items-center justify-between gap-4 p-5">
      <div class="flex items-center gap-3">
        <div
          class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
        >
          <FolderKanban class="size-4" />
        </div>
        <div>
          <p class="text-sm font-medium text-text">Project</p>
          <p class="text-xs text-text-muted">
            Move this service into a different project, or ungroup it.
          </p>
        </div>
      </div>
      <form
        action="?/moveProject"
        class="flex items-center gap-2 w-75"
        method="POST"
        use:enhance={() =>
          async ({ result, update }) => {
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
  <section class="rounded-2xl border border-border bg-surface">
    <div class="flex items-center justify-between gap-4 p-5">
      <div class="flex items-center gap-3">
        <div
          class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
        >
          <Server class="size-4" />
        </div>
        <div>
          <p class="text-sm font-medium text-text">Deploy target</p>
          <p class="text-xs text-text-muted">
            Which Docker daemon this service runs on. Changing this only takes
            effect on the next deploy — the current container, if any, keeps
            running where it is.
          </p>
        </div>
      </div>
      <form
        action="?/moveRemoteHost"
        class="flex items-center gap-2 w-75"
        method="POST"
        use:enhance={() =>
          async ({ result, update }) => {
            if (result.type === "success") {
              toast.success("Saved.");
            } else {
              toast.error("Couldn't change the deploy target.");
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
  <section class="rounded-2xl border border-border bg-surface">
    <div class="flex items-center justify-between gap-4 p-5">
      <div class="flex items-center gap-3">
        <div
          class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
        >
          <LayoutGrid class="size-4" />
        </div>
        <div>
          <p class="text-sm font-medium text-text">Save as template</p>
          <p class="text-xs text-text-muted">
            Reuse this config to deploy another service later.
          </p>
        </div>
      </div>
      <form
        action="?/saveAsTemplate"
        method="POST"
        use:enhance={() =>
          async ({ result, update }) => {
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
  <section class="rounded-2xl border border-border bg-surface p-5">
    <div class="mb-4 flex items-center gap-3">
      <div
        class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
      >
        <Clock class="size-4" />
      </div>
      <div>
        <p class="text-sm font-medium text-text">Auto-redeploy schedule</p>
        <p class="text-xs text-text-muted">
          Periodically repull the image and redeploy — useful for tracking a
          <code>:latest</code>
          tag. Disabled by default.
        </p>
      </div>
    </div>

    <form
      action="?/updateCron"
      class="space-y-3"
      method="POST"
      use:enhance={() =>
        async ({ result, update }) => {
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
        <p class="mt-1.5 text-xs text-text-subtle">
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
  <section
    class="rounded-2xl border border-red-200 bg-surface dark:border-red-900/40"
  >
    <div
      class="flex items-center gap-3 border-b border-red-100 px-5 py-4 dark:border-red-900/30"
    >
      <div
        class="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600"
      >
        <TriangleAlertIcon class="size-4" />
      </div>
      <div>
        <h2 class="text-sm font-semibold text-red-600 dark:text-red-400">
          Danger zone
        </h2>
        <p class="text-xs text-text-muted">
          Irreversible. Removes the container and all deployment history.
        </p>
      </div>
    </div>
    <div class="p-5">
      {#if !showDeleteConfirm}
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-text">Delete this service</p>
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
          <div
            class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
          >
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
