<script lang="ts">
	import { BUILTIN_BUILD_CACHE } from "#lib/build-cache.js";
	import {
		type BuildMethod,
		DEFAULT_BAKE_FILE,
		DEFAULT_BAKE_TARGET,
	} from "#lib/build-methods.js";
	import BuildMethodField from "#lib/components/build-method-field.svelte";
	import { Input } from "#lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "#lib/components/ui/select/index.js";
	import { resolve } from "$app/paths";

	interface Props {
		buildCacheRegistryId?: string;
		errorClass: string;
		errors?: Record<string, string[] | undefined>;
		gitBakeFile?: string;
		gitBuildTarget?: string;
		gitBuildContext?: string;
		gitBuildMethod?: BuildMethod;
		gitDockerfilePath?: string;
		keepHiddenFields?: boolean;
		labelClass: string;
		registries: { id: string; name: string }[];
	}

	let {
		buildCacheRegistryId = $bindable(""),
		errorClass,
		errors,
		gitBakeFile = $bindable(""),
		gitBuildTarget = $bindable(""),
		gitBuildContext = $bindable(""),
		gitBuildMethod = $bindable("dockerfile"),
		gitDockerfilePath = $bindable(""),
		keepHiddenFields = false,
		labelClass,
		registries,
	}: Props = $props();

	const buildCacheRegistryLabel = $derived(
		buildCacheRegistryId === BUILTIN_BUILD_CACHE
			? "Built-in registry"
			: (registries.find((r) => r.id === buildCacheRegistryId)?.name ??
					"No cache"),
	);
</script>

<BuildMethodField
  labelClass={labelClass}
  bind:value={gitBuildMethod}
/>

{#if gitBuildMethod === "dockerfile"}
  <div>
    <label class={labelClass} for="gitDockerfilePath">Dockerfile path</label>
    <Input
      id="gitDockerfilePath"
      name="gitDockerfilePath"
      placeholder="Dockerfile"
      type="text"
      bind:value={gitDockerfilePath}
    />
  </div>
  <div>
    <label class={labelClass} for="gitBuildTarget">Target stage</label>
    <Input
      id="gitBuildTarget"
      name="gitBuildTarget"
      placeholder="The last stage"
      type="text"
      bind:value={gitBuildTarget}
    />
    <p class="text-text-muted mt-1.5 text-xs">
      The
      <code>FROM … AS &lt;name&gt;</code>
      stage to build, for a multi-stage Dockerfile. Empty builds the last one.
    </p>
    {#if errors?.gitBuildTarget}
      <p class={errorClass}>{errors.gitBuildTarget[0]}</p>
    {/if}
  </div>
{:else if keepHiddenFields}
  <input
    name="gitDockerfilePath"
    type="hidden"
    value={gitDockerfilePath}
  />
{/if}
{#if gitBuildMethod === "bake"}
  <div>
    <label class={labelClass} for="gitBakeFile">Bake file</label>
    <Input
      id="gitBakeFile"
      name="gitBakeFile"
      placeholder={DEFAULT_BAKE_FILE}
      type="text"
      bind:value={gitBakeFile}
    />
    <p class="text-text-muted mt-1.5 text-xs">
      Relative to the build context: docker-bake.hcl, docker-bake.json or a compose file.
    </p>
  </div>
  <div>
    <label class={labelClass} for="gitBuildTarget">Bake target</label>
    <Input
      id="gitBuildTarget"
      name="gitBuildTarget"
      placeholder={DEFAULT_BAKE_TARGET}
      type="text"
      bind:value={gitBuildTarget}
    />
    {#if errors?.gitBuildTarget}
      <p class={errorClass}>{errors.gitBuildTarget[0]}</p>
    {/if}
  </div>
{:else if keepHiddenFields}
  <input
    name="gitBakeFile"
    type="hidden"
    value={gitBakeFile}
  />

  {#if gitBuildMethod !== "dockerfile"}
    <input
      name="gitBuildTarget"
      type="hidden"
      value={gitBuildTarget}
    />
  {/if}
{/if}
<div>
  <label class={labelClass} for="gitBuildContext">
    Build context (subdirectory)
  </label>
  <Input
    id="gitBuildContext"
    name="gitBuildContext"
    placeholder="Leave blank for repo root"
    type="text"
    bind:value={gitBuildContext}
  />
</div>
<div>
  <label class={labelClass} for="buildCacheRegistryId">
    Build cache registry
  </label>
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
      <SelectItem label="Built-in registry" value={BUILTIN_BUILD_CACHE} />
      {#each registries as reg (reg.id)}
        <SelectItem label={reg.name} value={reg.id} />
      {/each}
    </SelectContent>
  </SelectRoot>
  <p class="text-xs text-text-muted mt-1.5">
    Reuses unchanged layers between builds. The built-in registry is
    Homerun's own; a build server uses it through the registry's public
    hostname, and builds without a cache when it has none. Other registries
    are added under

    <a
      class="text-accent underline"
      href={resolve('build-cache-registries')}
    >Build Cache</a>.
  </p>
</div>
