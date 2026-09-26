<script lang="ts">
	import { resolve } from "$app/paths";
	import {
		type BuildMethod,
		DEFAULT_BAKE_FILE,
		DEFAULT_BAKE_TARGET,
	} from "$lib/build-methods";
	import BuildMethodField from "$lib/components/build-method-field.svelte";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";

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
		registries.find((r) => r.id === buildCacheRegistryId)?.name ?? "No cache",
	);
</script>

<BuildMethodField {labelClass} bind:value={gitBuildMethod} />
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
      The <code>FROM … AS &lt;name&gt;</code> stage to build, for a multi-stage
      Dockerfile. Empty builds the last one.
    </p>
    {#if errors?.gitBuildTarget}
      <p class={errorClass}>{errors.gitBuildTarget[0]}</p>
    {/if}
  </div>
{:else if keepHiddenFields}
  <input name="gitDockerfilePath" type="hidden" value={gitDockerfilePath}>
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
  <input name="gitBakeFile" type="hidden" value={gitBakeFile}>
  {#if gitBuildMethod !== "dockerfile"}
    <input name="gitBuildTarget" type="hidden" value={gitBuildTarget}>
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
  {#if registries.length === 0}
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
        {#each registries as reg (reg.id)}
          <SelectItem label={reg.name} value={reg.id} />
        {/each}
      </SelectContent>
    </SelectRoot>
  {/if}
</div>
