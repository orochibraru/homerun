<script lang="ts">
	import { Check, Container, GitBranch } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { isBuildMethod } from "$lib/build-methods";
	import GitBuildFields from "$lib/components/git-build-fields.svelte";
	import GitSourceFields from "$lib/components/git-source-fields.svelte";
	import ImageCheckWarning from "$lib/components/image-check-warning.svelte";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import RegistryFields from "$lib/components/registry-fields.svelte";
	import StatusCheckPicker from "$lib/components/status-check-picker.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { isDeployed } from "$lib/service-state";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import WebhookPanel from "./webhook-panel.svelte";

	const { data, form } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Source`));

	const label = "block mb-1.5 text-sm font-medium text-text";
	const errorClass = "mt-1.5 text-xs text-red-500";

	const values = $derived(
		(form?.values as Record<string, string> | undefined) ?? {
			buildCacheRegistryId: svc.buildCacheRegistryId ?? "",
			buildServerRemoteHostId: svc.buildServerRemoteHostId ?? "",
			buildSource: svc.buildSource,
			gitBakeFile: svc.gitBakeFile ?? "",
			gitBuildTarget: svc.gitBuildTarget ?? "",
			gitBuildContext: svc.gitBuildContext ?? "",
			gitBuildMethod: svc.gitBuildMethod,
			gitDockerfilePath: svc.gitDockerfilePath ?? "",
			autoDeployOnPush: svc.autoDeployOnPush ? "on" : "",
			gitProviderId: svc.gitProviderId ?? "",
			gitRef: svc.gitRef ?? "main",
			gitRepo: svc.gitRepo ?? "",
			gitUrl: svc.gitUrl ?? "",
			image: svc.image,
			registryUrl: svc.registryUrl ?? "",
			registryUsername: svc.registryUsername ?? "",
			tag: svc.tag,
		},
	);
	let buildCacheRegistryId = $derived(values.buildCacheRegistryId ?? "");
	let buildServerRemoteHostId = $derived(values.buildServerRemoteHostId ?? "");
	const buildServerLabel = $derived(
		data.buildServers.find((r) => r.id === buildServerRemoteHostId)?.name ??
			"Build on deploy target",
	);
	const errors = $derived(form?.errors as Record<string, string[]> | undefined);

	let submitting = $state(false);
	let showRegistry = $derived(!!svc.registryUsername);

	let buildSource = $derived<"image" | "git">(
		(values.buildSource as "image" | "git" | undefined) ?? "image",
	);
	let image = $derived(values.image);
	let tag = $derived(values.tag);
	let registryUrl = $derived(values.registryUrl);
	let gitUrl = $derived(values.gitUrl);
	let gitRef = $derived(values.gitRef);
	let gitBuildMethod = $derived(
		isBuildMethod(values.gitBuildMethod) ? values.gitBuildMethod : "dockerfile",
	);
	let gitDockerfilePath = $derived(values.gitDockerfilePath ?? "");
	let gitBakeFile = $derived(values.gitBakeFile ?? "");
	let gitBuildTarget = $derived(values.gitBuildTarget ?? "");
	let gitBuildContext = $derived(values.gitBuildContext ?? "");
	let registryUsername = $derived(values.registryUsername ?? "");
	let gitProviderId = $derived(values.gitProviderId ?? "");
	let gitRepo = $derived(values.gitRepo ?? "");
	let autoDeployOnPush = $derived(values.autoDeployOnPush === "on");
	let gitPollEnabled = $derived(
		form?.values ? values.gitPollEnabled === "on" : svc.gitPollEnabled,
	);
</script>

<section class="panel rounded-md">
  <PanelHeader
    description="What gets deployed. Changes take effect on the next deploy."
    icon={Container}
    title="Source"
  />

  <form
    action="?/updateSource"
    class="space-y-5 p-5"
    method="POST"
    use:enhance={enhanceToast({
      action: isDeployed(svc)
        ? {
            label: "Redeploy",
            onClick: () =>
              goto(
                resolve("/(protected)/services/[serviceId]", {
                  serviceId: svc.id,
                }),
              ),
          }
        : undefined,
      description: "Changes take effect on the next deploy.",
      error: "Check the form for errors.",
      loading: "Saving the source",
      onSettled: () => {
        submitting = false;
      },
      onStart: () => {
        submitting = true;
      },
      success: "Saved.",
    })}
  >
    <div>
      <div class={label}>Deploy from</div>
      <div class="flex gap-2">
        <button
          class="
            flex flex-1 items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-all {buildSource ===
            'image'
            ? 'border-accent bg-accent-light text-accent'
            : 'border-border text-text-muted hover:bg-surface-2'}
         "
          onclick={() => {
            buildSource = "image";
          }}
          type="button"
        >
          Docker image
        </button>
        <button
          class="
            flex flex-1 items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-all {buildSource ===
            'git'
            ? 'border-accent bg-accent-light text-accent'
            : 'border-border text-text-muted hover:bg-surface-2'}
         "
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
      <p class="text-text-subtle mt-1.5 text-xs">
        Switching this doesn't redeploy by itself : save, then redeploy from the
        Overview tab.
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
            type="text"
            bind:value={tag}
          />
        </div>
      </div>

      <ImageCheckWarning {image} {registryUrl} registryUsername={svc.registryUsername ?? ""} {tag} />
    {:else}
      <GitSourceFields
        {errorClass}
        {errors}
        labelClass={label}
        providers={data.connectedGitProviders}
        bind:autoDeployOnPush
        bind:gitProviderId
        bind:gitRef
        bind:gitRepo
        bind:gitUrl
      />
      <WebhookPanel
        {autoDeployOnPush}
        {gitRef}
        labelClass={label}
        previewOf={data.previewOf}
        pushWebhook={data.pushWebhook}
        serviceId={svc.id}
        bind:gitPollEnabled
      />
      <GitBuildFields
        {errorClass}
        {errors}
        keepHiddenFields
        labelClass={label}
        registries={data.buildCacheRegistries}
        bind:gitBuildMethod
        bind:gitDockerfilePath
        bind:gitBakeFile
        bind:gitBuildTarget
        bind:gitBuildContext
        bind:buildCacheRegistryId
      />
      <div>
        <label class={label} for="buildServerRemoteHostId">
          Build server
        </label>
        {#if data.buildServers.length === 0}
          <p class="text-xs text-text-muted">
            No build servers configured.
            <a class="text-accent underline" href={resolve("/remote-hosts")}>
              Mark a remote host
            </a>
            as one to build there instead of the deploy target.
          </p>
        {:else}
          <SelectRoot
            name="buildServerRemoteHostId"
            type="single"
            bind:value={buildServerRemoteHostId}
          >
            <SelectTrigger id="buildServerRemoteHostId">
              {buildServerLabel}
            </SelectTrigger>
            <SelectContent>
              <SelectItem label="Build on deploy target" value="" />
              {#each data.buildServers as host (host.id)}
                <SelectItem label={host.name} value={host.id} />
              {/each}
            </SelectContent>
          </SelectRoot>
          <p class="text-text-subtle mt-1.5 text-xs">
            With a build cache registry above, the built image is published
            there and pulled back onto this host. Without one it's streamed
            straight back from the build server instead.
          </p>
        {/if}
      </div>
      <StatusCheckPicker
        enabled={svc.requireStatusChecks}
        error={errors?.requiredStatusChecks?.[0]}
        {gitRef}
        {gitUrl}
        labelClass={label}
        selected={svc.requiredStatusChecks}
      />
    {/if}

    <RegistryFields
      class="border-border rounded-md border"
      compact
      labelClass={label}
      passwordPlaceholder="Leave blank to keep current"
      bind:open={showRegistry}
      bind:registryUrl
      bind:registryUsername
    />

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
