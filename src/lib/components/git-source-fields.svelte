<script lang="ts">
	import CheckBox from "$lib/components/check-box.svelte";
	import GitRepoPicker from "$lib/components/git-repo-picker.svelte";
	import { Input } from "$lib/components/ui/input/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { listRepoBranches } from "$lib/remote/git-repos.remote";

	interface ConnectedProvider {
		id: string;
		name: string;
		providerUsername: string;
	}

	let {
		autoDeployOnPush = $bindable(false),
		errorClass,
		errors,
		gitProviderId = $bindable(""),
		gitRef = $bindable("main"),
		gitRepo = $bindable(""),
		gitUrl = $bindable(""),
		labelClass,
		providers,
	}: {
		autoDeployOnPush?: boolean;
		errorClass: string;
		errors?: Record<string, string[] | undefined>;
		gitProviderId?: string;
		gitRef?: string;
		gitRepo?: string;
		gitUrl?: string;
		labelClass: string;
		providers: ConnectedProvider[];
	} = $props();

	let manualUrl = $state(
		(() => providers.length === 0 || (!!gitUrl && !gitRepo))(),
	);

	const picked = $derived(!manualUrl && !!gitProviderId && !!gitRepo);
	const pickedProviderName = $derived(
		providers.find((p) => p.id === gitProviderId)?.name ?? "the provider",
	);
	const branchesPromise = $derived(
		picked
			? listRepoBranches({ providerId: gitProviderId, repo: gitRepo })
			: null,
	);

	function useManualUrl() {
		manualUrl = true;
		gitProviderId = "";
		gitRepo = "";
	}
</script>

<input name="gitProviderId" type="hidden" value={manualUrl ? "" : gitProviderId}>
<input name="gitRepo" type="hidden" value={manualUrl ? "" : gitRepo}>

{#if manualUrl}
  <div>
    <label class={labelClass} for="gitUrl">
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
    <p class="text-text-subtle mt-1.5 text-xs">
      Any git-clone-able HTTPS URL. Private repos on a connected git provider
      are cloned with that account's access; anything else needs a token in the
      URL (<code>https://TOKEN@host/...</code>).
      {#if providers.length > 0}
        <button
          class="text-accent font-medium hover:underline"
          onclick={() => {
            manualUrl = false;
          }}
          type="button"
        >
          Pick from a connected account instead
        </button>
      {/if}
    </p>
    {#if errors?.gitUrl}
      <p class={errorClass}>{errors.gitUrl[0]}</p>
    {/if}
  </div>
  <div>
    <label class={labelClass} for="gitRef">Branch / tag</label>
    <Input
      id="gitRef"
      name="gitRef"
      placeholder="main"
      type="text"
      bind:value={gitRef}
    />
  </div>
{:else}
  <input name="gitUrl" type="hidden" value={gitUrl}>
  <GitRepoPicker
    initialProviderId={gitProviderId || null}
    initialRepo={gitRepo || null}
    {labelClass}
    onpick={(repo, providerId) => {
      gitProviderId = providerId;
      gitRepo = repo.fullName;
      gitUrl = repo.cloneUrl;
      gitRef = repo.defaultBranch;
      autoDeployOnPush = true;
    }}
    {providers}
  />
  {#if errors?.gitUrl}
    <p class={errorClass}>Pick a repository.</p>
  {/if}

  {#if picked}
    <div>
      <label class={labelClass} for="gitRef">Branch</label>
      {#await branchesPromise}
        <p class="text-text-muted flex items-center gap-2 text-xs">
          <Spinner />
          Listing branches…
        </p>
        <input name="gitRef" type="hidden" value={gitRef}>
      {:then branches}
        <Select.Root name="gitRef" type="single" bind:value={gitRef}>
          <Select.Trigger class="w-full" id="gitRef">{gitRef}</Select.Trigger>
          <Select.Content>
            {#if !branches?.includes(gitRef)}
              <Select.Item label={gitRef} value={gitRef} />
            {/if}
            {#each branches ?? [] as branch (branch)}
              <Select.Item label={branch} value={branch} />
            {/each}
          </Select.Content>
        </Select.Root>
      {:catch}
        <Input
          id="gitRef"
          name="gitRef"
          placeholder="main"
          type="text"
          bind:value={gitRef}
        />
        <p class="mt-1.5 text-xs text-amber-600">
          Couldn't list branches, type the branch name instead.
        </p>
      {/await}
    </div>
  {:else}
    <input name="gitRef" type="hidden" value={gitRef}>
  {/if}

  <p class="text-text-subtle text-xs">
    <button
      class="text-accent font-medium hover:underline"
      onclick={useManualUrl}
      type="button"
    >
      Use a clone URL instead
    </button>
  </p>
{/if}

<CheckBox
  helperText={picked
  ? `Homerun adds a webhook to the repo on ${pickedProviderName}, and every push to this branch deploys the service.`
  : "Every push to this branch deploys the service. Homerun can't add the webhook to a pasted URL itself, so it gives you the URL and secret to add in the repo's settings."}
  id="autoDeployOnPush"
  label="Deploy on push"
  name="autoDeployOnPush"
  bind:checked={autoDeployOnPush}
/>
