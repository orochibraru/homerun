<script lang="ts">
	import {
		Check,
		ChevronDown,
		Container,
		GitBranch,
		Lock,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import {
		DEFAULT_BAKE_FILE,
		DEFAULT_BAKE_TARGET,
		isBuildMethod,
	} from "$lib/build-methods";
	import BuildMethodField from "$lib/components/build-method-field.svelte";
	import CheckBox from "$lib/components/check-box.svelte";
	import CopyBox from "$lib/components/copy-box.svelte";
	import GitSourceFields from "$lib/components/git-source-fields.svelte";
	import ImageCheckWarning from "$lib/components/image-check-warning.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
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
			gitBakeTarget: svc.gitBakeTarget ?? "",
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
	const buildCacheRegistryLabel = $derived(
		data.buildCacheRegistries.find((r) => r.id === buildCacheRegistryId)
			?.name ?? "No cache",
	);
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
	let gitProviderId = $derived(values.gitProviderId ?? "");
	let gitRepo = $derived(values.gitRepo ?? "");
	let autoDeployOnPush = $derived(values.autoDeployOnPush === "on");
	let gitPollEnabled = $derived(
		form?.values ? values.gitPollEnabled === "on" : svc.gitPollEnabled,
	);
	let previewsEnabled = $derived(
		form?.values ? values.previewsEnabled === "on" : svc.previewsEnabled,
	);
	const reconnectHref = $derived(
		data.pushWebhook?.reconnect
			? `/api/v1/git-providers/${data.pushWebhook.reconnect.providerId}/connect?${new URLSearchParams({ returnTo: `/services/${svc.id}/source` })}`
			: null,
	);
</script>

<section class="panel rounded-md">
  <div class="border-border flex items-center gap-3 border-b px-5 py-4">
    <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
      <Container class="size-4" />
    </div>
    <div>
      <h2 class="eyebrow">Source</h2>
      <p class="text-text-muted text-xs">
        What gets deployed. Changes take effect on the next deploy.
      </p>
    </div>
  </div>

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
      {#if data.pushWebhook}
        <div class="border-border space-y-3 rounded-md border p-4">
          {#if data.pushWebhook.registered}
            <p class="text-sm text-emerald-600">
              Webhook registered on {data.pushWebhook.providerName ?? "the provider"}.
              Pushes to {gitRef} deploy this service.
            </p>
          {:else}
            {#if data.pushWebhook.error}
              <p class="text-xs text-amber-600">{data.pushWebhook.error}</p>
            {/if}
            {#if data.pushWebhook.reconnect && reconnectHref}
              <div class="flex flex-wrap items-center gap-3">
                <p class="text-text-muted flex-1 text-xs">
                  The connection to {data.pushWebhook.reconnect.providerName}
                  doesn't allow adding webhooks. Reconnect it to grant webhook
                  access, and Homerun registers the webhook right after.
                </p>
                <Button data-sveltekit-reload href={reconnectHref} size="sm">
                  Reconnect {data.pushWebhook.reconnect.providerName}
                </Button>
              </div>
            {/if}
            {#if data.pushWebhook.polling}
              <p class="text-text-muted text-xs">
                Until the webhook is in place, Homerun checks {gitRef} for new
                commits every two minutes and deploys when it moves.
              </p>
            {/if}
            <p class="text-text-muted text-xs">
              Add a webhook in the repository's settings with this URL and
              secret, sending push events as JSON. GitLab calls the secret a
              "secret token".
            </p>
            {#if data.pushWebhook.url}
              <div>
                <p class={label}>Payload URL</p>
                <CopyBox label="webhook URL" value={data.pushWebhook.url} />
              </div>
            {/if}
            <div>
              <p class={label}>Secret</p>
              <CopyBox label="webhook secret" value={data.pushWebhook.secret} />
            </div>
          {/if}
        </div>
      {/if}
      {#if autoDeployOnPush}
        <CheckBox
          helperText="Also check the branch for new commits every two minutes, for a dashboard the provider can't reach. Homerun already does this whenever it couldn't register the webhook."
          id="gitPollEnabled"
          label="Poll the branch for pushes"
          name="gitPollEnabled"
          bind:checked={gitPollEnabled}
        />
      {/if}
      {#if data.previewOf}
        <p class="text-text-muted text-xs">
          This service is a pull request preview of
          <a
            class="text-accent underline"
            href={resolve("/(protected)/services/[serviceId]/source", {
              serviceId: data.previewOf.id,
            })}
          >
            {data.previewOf.name}
          </a>. It follows the pull request and is removed when it closes.
        </p>
      {:else}
        <CheckBox
          helperText={`Every pull request opened on the repo gets its own service at ${svc.slug}-pr-<number>, built from the pull request's head, redeployed on every push to it and removed when it's closed or merged. Needs the webhook.`}
          id="previewsEnabled"
          label="Pull request previews"
          name="previewsEnabled"
          bind:checked={previewsEnabled}
        />
        {#if data.previews.length > 0}
          <div class="border-border divide-border divide-y rounded-md border">
            {#each data.previews as preview (preview.id)}
              <div class="flex flex-wrap items-center gap-3 px-4 py-3">
                <div class="min-w-0 flex-1">
                  <a
                    class="text-text text-sm font-medium hover:underline"
                    href={resolve("/(protected)/services/[serviceId]", {
                      serviceId: preview.id,
                    })}
                  >
                    #{preview.prNumber} {preview.title ?? preview.name}
                  </a>
                  <p class="text-text-muted truncate text-xs">
                    {preview.branch ?? preview.gitRef}
                    {#if preview.hostname}
                      · {preview.hostname}
                    {/if}
                  </p>
                </div>
                <StatusBadge status={preview.status} />
              </div>
            {/each}
          </div>
        {/if}
      {/if}
      <BuildMethodField labelClass={label} bind:value={gitBuildMethod} />
      {#if gitBuildMethod === "dockerfile"}
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
      {:else}
        <input name="gitDockerfilePath" type="hidden" value={values.gitDockerfilePath} />
      {/if}
      {#if gitBuildMethod === "bake"}
        <div>
          <label class={label} for="gitBakeFile">Bake file</label>
          <Input
            id="gitBakeFile"
            name="gitBakeFile"
            placeholder={DEFAULT_BAKE_FILE}
            type="text"
            value={values.gitBakeFile}
          />
          <p class="text-text-muted mt-1.5 text-xs">
            Relative to the build context: docker-bake.hcl, docker-bake.json or a compose file.
          </p>
        </div>
        <div>
          <label class={label} for="gitBakeTarget">Bake target</label>
          <Input
            id="gitBakeTarget"
            name="gitBakeTarget"
            placeholder={DEFAULT_BAKE_TARGET}
            type="text"
            value={values.gitBakeTarget}
          />
          {#if errors?.gitBakeTarget}
            <p class={errorClass}>{errors.gitBakeTarget[0]}</p>
          {/if}
        </div>
      {:else}
        <input name="gitBakeFile" type="hidden" value={values.gitBakeFile} />
        <input name="gitBakeTarget" type="hidden" value={values.gitBakeTarget} />
      {/if}
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
      <div>
        <label class={label} for="buildCacheRegistryId">
          Build cache registry
        </label>
        {#if data.buildCacheRegistries.length === 0}
          <p class="text-xs text-text-muted">
            No registries configured.
            <a class="text-accent underline" href={resolve("/build-cache-registries")}>
              Add one
            </a>
            to speed up rebuilds by reusing unchanged layers.
          </p>
        {:else}
          <SelectRoot
            name="buildCacheRegistryId"
            type="single"
            bind:value={buildCacheRegistryId}
          >
            <SelectTrigger id="buildCacheRegistryId">
              {buildCacheRegistryLabel}
            </SelectTrigger>
            <SelectContent>
              <SelectItem label="No cache" value="" />
              {#each data.buildCacheRegistries as reg (reg.id)}
                <SelectItem label={reg.name} value={reg.id} />
              {/each}
            </SelectContent>
          </SelectRoot>
        {/if}
      </div>
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

    <div class="border-border rounded-md border">
      <Button
        class="text-text h-auto w-full justify-start gap-3 px-4 py-3 font-normal"
        onclick={() => {
          showRegistry = !showRegistry;
        }}
        variant="ghost"
      >
        <Lock class="text-text-muted size-4" />
        <span class="text-text flex-1 text-sm font-medium">
          Private registry
        </span>
        <ChevronDown
          class="
            text-text-muted size-4 transition-transform {showRegistry
            ? 'rotate-180'
            : ''}
         "
        />
      </Button>
      {#if showRegistry}
        <div class="border-border space-y-4 border-t p-4">
          <div>
            <label class={label} for="registryUrl">Registry URL</label>
            <Input
              id="registryUrl"
              name="registryUrl"
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
