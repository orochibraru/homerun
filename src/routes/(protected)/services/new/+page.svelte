<script lang="ts">
	import {
		AlertTriangle,
		ArrowLeft,
		ArrowRight,
		Check,
		ChevronDown,
		Cpu,
		GitBranch,
		Lock,
		Network,
		Plus,
		Rocket,
		Server,
		SlidersHorizontal,
		Trash2,
		X,
	} from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import CheckBox from "$lib/components/check-box.svelte";
	import EnvPasteButton from "$lib/components/env-paste-button.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { mergeEnvRows, type ParsedEnvVar } from "$lib/env-parse";
	import { title } from "$lib/store/title";

	const { data, form } = $props();

	onMount(() => {
		title.set("Deploy a Service");
		scheduleImageCheck();
	});

	const label = "block mb-1.5 text-sm font-medium text-text";
	const errorClass = "mt-1.5 text-xs text-red-500";
	const values = $derived(form?.values as Record<string, string> | undefined);
	const errors = $derived(form?.errors as Record<string, string[]> | undefined);
	// Flat list of every error message, so a field we forgot to render a
	// dedicated <p> for still surfaces instead of silently failing.
	const errorMessages = $derived(errors ? Object.values(errors).flat() : []);

	const STEPS = [
		{ icon: Server, label: "Basic info" },
		{ icon: Network, label: "Networking" },
		{ icon: SlidersHorizontal, label: "Environment" },
		{ icon: Cpu, label: "Compute" },
	];
	// Every field lives in $state (not an uncontrolled `value={}`) so its
	// value survives a step being hidden : steps are hidden with a CSS
	// class, not {#if}, specifically so the DOM nodes (and their bound
	// state) never unmount between steps.
	let currentStep = $state(0);

	let name = $derived(
		(form?.values?.name as string | undefined) ?? data.template?.name ?? "",
	);
	let slug = $derived(
		(form?.values?.slug as string | undefined) ??
			(data.template ? slugify(data.template.name) : ""),
	);
	let slugTouched = $state(false);
	let submittingAction = $state<"create" | "createAndDeploy" | null>(null);
	let showRegistry = $derived(!!values?.registryUsername);

	let buildSource = $derived<"image" | "git">(
		(values?.buildSource as "image" | "git" | undefined) ?? "image",
	);
	let image = $derived(values?.image ?? data.template?.image ?? "");
	let tag = $derived(values?.tag ?? data.template?.tag ?? "latest");
	let registryUrl = $derived(values?.registryUrl ?? "");
	let registryUsername = $derived(values?.registryUsername ?? "");
	let gitUrl = $derived(values?.gitUrl ?? "");
	let gitRef = $derived(values?.gitRef ?? "main");
	let gitDockerfilePath = $derived(values?.gitDockerfilePath ?? "");
	let gitBuildContext = $derived(values?.gitBuildContext ?? "");
	let buildCacheRegistryId = $derived(values?.buildCacheRegistryId ?? "");
	const buildCacheRegistryLabel = $derived(
		data.buildCacheRegistries.find((r) => r.id === buildCacheRegistryId)
			?.name ?? "No cache",
	);
	let imageCheck = $state<{ checked: boolean; exists: boolean } | null>(null);
	let imageCheckTimer: ReturnType<typeof setTimeout> | undefined;

	// "Browse repos" : same picker as the service Source tab, only shown
	// when the user has at least one connected git provider. Picking a repo
	// autofills gitUrl/gitRef above rather than requiring a pasted URL, and
	// checks for a Dockerfile at the picked ref so there's a heads-up before
	// deploying fails on a repo that doesn't have one.
	let browseProviderId = $state(
		untrack(() => data.connectedGitProviders[0]?.id ?? ""),
	);
	let repos = $state<
		Array<{
			cloneUrl: string;
			defaultBranch: string;
			fullName: string;
			private: boolean;
		}>
	>([]);
	let loadingRepos = $state(false);
	let selectedRepo = $state("");
	let dockerfileCheck = $state<{ checked: boolean; exists: boolean } | null>(
		null,
	);

	async function loadRepos() {
		if (!browseProviderId) {
			return;
		}
		loadingRepos = true;
		repos = [];
		try {
			const res = await fetch(
				`/api/v1/git-providers/${browseProviderId}/repos`,
			);
			if (res.ok) {
				const body = (await res.json()) as { repos: typeof repos };
				repos = body.repos;
			} else {
				toast.error("Couldn't list repos for that provider.");
			}
		} finally {
			loadingRepos = false;
		}
	}

	async function pickRepo(fullName: string) {
		selectedRepo = fullName;
		const repo = repos.find((r) => r.fullName === fullName);
		if (!repo) {
			return;
		}
		gitUrl = repo.cloneUrl;
		gitRef = repo.defaultBranch;
		dockerfileCheck = null;
		try {
			const res = await fetch(
				`/api/v1/git-providers/${browseProviderId}/dockerfile?repo=${encodeURIComponent(
					fullName,
				)}&ref=${encodeURIComponent(repo.defaultBranch)}`,
			);
			if (res.ok) {
				const body = (await res.json()) as { exists: boolean };
				dockerfileCheck = { checked: true, exists: body.exists };
			}
		} catch {
			// Best-effort : not finding out doesn't block picking the repo.
		}
	}

	let containerPort = $derived(
		values?.containerPort ?? String(data.template?.containerPort ?? ""),
	);
	let dnsResolvable = $derived(
		values?.dnsResolvable !== "off" && values?.dnsResolvable !== "false",
	);
	let restartPolicy = $derived(
		values?.restartPolicy ?? data.template?.restartPolicy ?? "unless-stopped",
	);
	let cpuLimit = $derived(values?.cpuLimit ?? data.template?.cpuLimit ?? "");
	let memoryLimitMb = $derived(
		values?.memoryLimitMb ?? String(data.template?.memoryLimitMb ?? ""),
	);

	const restartPolicyOptions: [string, string][] = [
		["unless-stopped", "Unless stopped"],
		["always", "Always"],
		["on-failure", "On failure"],
		["no", "Never"],
	];
	const restartPolicyLabel = $derived(
		restartPolicyOptions.find(([val]) => val === restartPolicy)?.[1] ??
			"Unless stopped",
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

	function slugify(value: string): string {
		return value
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9-]+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 63);
	}

	function onNameInput() {
		if (!slugTouched) {
			slug = slugify(name);
		}
	}

	function onSlugInput() {
		slugTouched = true;
	}

	interface EnvRow {
		key: string;
		value: string;
	}
	function envRowsFromTemplate(): EnvRow[] {
		const entries = data.template
			? Object.entries(data.template.envVars ?? {}).map(([key, value]) => ({
					key,
					value,
				}))
			: [];
		return entries.length > 0 ? entries : [{ key: "", value: "" }];
	}

	// $state, not $derived: pushed/spliced into directly below
	// (addEnvRow/removeEnvRow), a $derived value is read-only, so mutating
	// it doesn't reliably stick (see the same fix in settings/+page.svelte
	// for the OAuth-providers form this pattern was originally copied from).
	// Seeded once at init; re-synced if `data.template` changes (picking a
	// different template mid-form via the template-context query param).
	let envRows = $state<EnvRow[]>(envRowsFromTemplate());
	$effect(() => {
		envRows = envRowsFromTemplate();
	});

	function addEnvRow() {
		envRows.push({ key: "", value: "" });
	}

	function removeEnvRow(i: number) {
		envRows.splice(i, 1);
		if (envRows.length === 0) {
			envRows.push({ key: "", value: "" });
		}
	}

	function importEnvRows(imported: ParsedEnvVar[]) {
		envRows = mergeEnvRows(envRows, imported, (row) => row);
	}

	function goNext() {
		currentStep = Math.min(currentStep + 1, STEPS.length - 1);
	}
	function goBack() {
		currentStep = Math.max(currentStep - 1, 0);
	}

	function stepButtonClass(i: number): string {
		if (i === currentStep) {
			return "border-accent bg-accent-light text-accent";
		}
		if (i < currentStep) {
			return "border-border text-text bg-surface-2";
		}
		return "border-border text-text-muted";
	}
</script>

<div class="space-y-6 p-6 md:p-8">
  <div>
    <h1 class="text-xl font-bold text-text">Deploy a Service</h1>
    <p class="mt-0.5 text-sm text-text-muted">
      Point at an image, fill in the config, deploy.
    </p>
  </div>

  <!-- ═══ Step indicator ═══ -->
  <div class="flex items-center gap-1">
    {#each STEPS as step, i}
      {@const StepIcon = step.icon}
      <button
        class="
          flex flex-1 items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all {stepButtonClass(
          i,
          )}
        "
        onclick={() => {
          currentStep = i;
        }}
        type="button"
      >
        <div
          class="
            flex size-5 shrink-0 items-center justify-center rounded-full text-xs {i <=
            currentStep
            ? 'bg-accent text-white'
            : 'bg-surface-2 text-text-subtle'}
          "
        >
          {#if i < currentStep}
            <Check class="size-3" />
          {:else}
            {i + 1}
          {/if}
        </div>
        <span class="hidden sm:inline"><StepIcon
            class="mr-1 inline size-3.5"
          />{step.label}</span>
      </button>
    {/each}
  </div>

  <form
    action="?/create"
    class="space-y-6"
    method="POST"
    use:enhance={() => {
      return async ({ result, update }) => {
        submittingAction = null;
        if (result.type === "failure") {
          const data = result.data as
            | { error?: string; errors?: Record<string, string[]> }
            | undefined;
          const first = data?.errors
            ? (Object.values(data.errors).flat()[0] as string | undefined)
            : data?.error;
          toast.error(first ?? "Check the form for errors.");
          // The failing field could be on any step : jump back to the
          // first one so the top error banner and per-field messages are
          // actually visible, not stranded behind whatever step the user
          // happened to be on when they hit Create.
          currentStep = 0;
        } else if (result.type === "error") {
          toast.error(result.error?.message ?? "Something went wrong.");
        }
        await update();
      };
    }}
  >
    {#if data.projectId}
      <input name="projectId" type="hidden" value={data.projectId}>
    {/if}

    {#if data.template}
      <div class="bg-accent/10 text-accent rounded-xl px-4 py-3 text-sm font-medium">
        Starting from the {data.template.name} template : review everything
        below (especially any placeholder passwords) before deploying.
      </div>
    {/if}

    {#if errorMessages.length > 0}
      <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
        <p class="font-semibold">Couldn't create the service:</p>
        <ul class="mt-1 ml-4 list-disc">
          {#each errorMessages as msg}
            <li>{msg}</li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="flex min-h-136 flex-col gap-6">
      <div class="flex-1 space-y-6">
        <!-- ═══ Step 1: Basic info ═══ -->
        <section
          class="rounded-2xl border border-border bg-surface"
          class:hidden={currentStep !== 0}
        >
          <div class="flex items-center gap-3 border-b border-border px-5 py-4">
            <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
              <Server class="size-4" />
            </div>
            <div>
              <h2 class="text-sm font-semibold text-text">Basic info</h2>
              <p class="text-xs text-text-muted">Name it and point at an image.</p>
            </div>
          </div>

          <div class="space-y-5 p-5">
            <div>
              <label class={label} for="name">
                Name <span class="text-red-500">*</span>
              </label>
              <Input
                id="name"
                name="name"
                oninput={onNameInput}
                placeholder="My API"
                required
                type="text"
                bind:value={name}
              />
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
                oninput={onSlugInput}
                pattern="[a-z0-9\-]+"
                placeholder="my-api"
                required
                type="text"
                bind:value={slug}
              />
              <p class="mt-1 text-xs text-text-subtle">
                Routed at
                <span class="text-accent">{slug || "your-slug"}.{
                    data.baseDomain
                  }</span>
              </p>
              {#if errors?.slug}
                <p class={errorClass}>{errors.slug[0]}</p>
              {/if}
            </div>

            <div>
              <div class={label}>Deploy from</div>
              <div class="flex gap-2">
                <button
                  class="
                    flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all {buildSource ===
                    'image'
                    ? 'border-accent bg-accent-light text-accent'
                    : 'border-border text-text-muted hover:bg-surface-2'}
                  "
                  onclick={() => {
                    buildSource = "image";
                  }}
                  type="button"
                >
                  <Server class="size-4" />
                  Docker image
                </button>
                <button
                  class="
                    flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all {buildSource ===
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
                    placeholder="ghcr.io/acme/api"
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
                    placeholder="latest"
                    type="text"
                    bind:value={tag}
                  />
                </div>
              </div>

              {#if imageCheck?.checked && !imageCheck.exists}
                <div class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400">
                  <AlertTriangle class="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <strong>{image}:{tag}</strong>
                    wasn't found in its registry. You can still save : this doesn't
                    block deploying, in case you're still preparing the image.
                  </span>
                </div>
              {/if}
            {:else}
              {#if data.connectedGitProviders.length > 0}
                <div class="rounded-xl border border-border p-4">
                  <p class={label}>Browse repos</p>
                  <div class="flex flex-wrap gap-2">
                    {#if data.connectedGitProviders.length > 1}
                      <select
                        bind:value={browseProviderId}
                        class="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                      >
                        {#each data.connectedGitProviders as p (p.id)}
                          <option value={p.id}>{p.name} ({p.providerUsername})</option>
                        {/each}
                      </select>
                    {/if}
                    <Button
                      disabled={loadingRepos}
                      onclick={loadRepos}
                      type="button"
                      variant="outline"
                    >
                      {#if loadingRepos}
                        <Spinner />
                      {:else}
                        <GitBranch class="size-4" />
                      {/if}
                      List repos
                    </Button>
                  </div>
                  {#if repos.length > 0}
                    <select
                      bind:value={selectedRepo}
                      class="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                      onchange={(e) => pickRepo(e.currentTarget.value)}
                    >
                      <option value="">Select a repo…</option>
                      {#each repos as repo (repo.fullName)}
                        <option value={repo.fullName}>
                          {repo.fullName}{repo.private ? " (private)" : ""}
                        </option>
                      {/each}
                    </select>
                    {#if dockerfileCheck?.checked}
                      <p
                        class="
                          mt-2 text-xs {dockerfileCheck.exists
                          ? 'text-emerald-600'
                          : 'text-amber-600'}
                        "
                      >
                        {
                          dockerfileCheck.exists
                          ? "✓ Dockerfile found at the repo root."
                          : "⚠ No Dockerfile found at the repo root on this branch : the build will fail unless one exists at the path you set below."
                        }
                      </p>
                    {/if}
                  {/if}
                </div>
              {/if}
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
                <p class="mt-1.5 text-xs text-text-subtle">
                  Any git-clone-able HTTPS URL : GitHub, GitLab, a self-hosted Gitea
                  instance, whatever. Private repos: embed a token in the URL
                  yourself (<code>https://TOKEN@host/...</code>), there's no
                  separate credential field for this yet.
                </p>
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
                  <label class={label} for="gitDockerfilePath"
                  >Dockerfile path</label>
                  <Input
                    id="gitDockerfilePath"
                    name="gitDockerfilePath"
                    placeholder="Dockerfile"
                    type="text"
                    bind:value={gitDockerfilePath}
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
                  bind:value={gitBuildContext}
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
            {/if}
          </div>
        </section>

        <!-- ═══ Step 1: Private registry (collapsible) ═══ -->
        <section
          class="rounded-2xl border border-border bg-surface"
          class:hidden={currentStep !== 0}
        >
          <Button
            class="h-auto w-full items-center justify-start gap-3 px-5 py-4 font-normal"
            onclick={() => {
              showRegistry = !showRegistry;
            }}
            variant="ghost"
          >
            <div class="flex size-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <Lock class="size-4" />
            </div>
            <div class="flex-1 text-left">
              <h2 class="text-sm font-semibold text-text">Private registry</h2>
              <p class="text-xs text-text-muted">
                Only needed for non-public images.
              </p>
            </div>
            <ChevronDown
              class="
                size-4 text-text-muted transition-transform {showRegistry
                ? 'rotate-180'
                : ''}
              "
            />
          </Button>

          {#if showRegistry}
            <div class="space-y-4 border-t border-border p-5">
              <div>
                <label class={label} for="registryUrl"> Registry URL </label>
                <Input
                  id="registryUrl"
                  name="registryUrl"
                  oninput={scheduleImageCheck}
                  placeholder="ghcr.io (blank = Docker Hub)"
                  type="text"
                  bind:value={registryUrl}
                />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class={label} for="registryUsername"> Username </label>
                  <Input
                    id="registryUsername"
                    name="registryUsername"
                    type="text"
                    bind:value={registryUsername}
                  />
                </div>
                <div>
                  <label class={label} for="registryPassword">
                    Password / token
                  </label>
                  <Input
                    id="registryPassword"
                    name="registryPassword"
                    type="password"
                  />
                </div>
              </div>
            </div>
          {/if}
        </section>

        <!-- ═══ Step 2: Networking ═══ -->
        <section
          class="rounded-2xl border border-border bg-surface"
          class:hidden={currentStep !== 1}
        >
          <div class="flex items-center gap-3 border-b border-border px-5 py-4">
            <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
              <Network class="size-4" />
            </div>
            <div>
              <h2 class="text-sm font-semibold text-text">Networking</h2>
              <p class="text-xs text-text-muted">
                The port it listens on, and how it's routed.
              </p>
            </div>
          </div>

          <div class="space-y-5 p-5">
            <div>
              <label class={label} for="containerPort">
                Container port <span class="text-red-500">*</span>
              </label>
              <Input
                id="containerPort"
                max="65535"
                min="1"
                name="containerPort"
                placeholder="3000"
                required={currentStep === 1}
                type="number"
                bind:value={containerPort}
              />
              <p class="mt-1 text-xs text-text-subtle">
                The port your app listens on inside the container.
              </p>
              {#if errors?.containerPort}
                <p class={errorClass}>{errors.containerPort[0]}</p>
              {/if}
            </div>

            <CheckBox
              helperText="Get a public slug.{data.baseDomain} route. Turn off to keep this service reachable only from other services on the same network. More networking controls (custom domain, auth gate) are on the service's Networking tab after it's created."
              id="dnsResolvable"
              label="DNS-resolvable"
              name="dnsResolvable"
              bind:checked={dnsResolvable}
            />
          </div>
        </section>

        <!-- ═══ Step 3: Environment ═══ -->
        <section
          class="rounded-2xl border border-border bg-surface"
          class:hidden={currentStep !== 2}
        >
          <div class="border-b border-border px-5 py-4">
            <h2 class="text-sm font-semibold text-text">Environment variables</h2>
            <p class="text-xs text-text-muted">
              Passed to the container at deploy time.
            </p>
          </div>

          <div class="space-y-2.5 p-5">
            {#each envRows as row, i}
              <div class="flex items-center gap-2">
                <Input
                  class="font-mono"
                  name="envKey"
                  placeholder="KEY"
                  type="text"
                  bind:value={row.key}
                />
                <Input
                  class="font-mono"
                  name="envValue"
                  placeholder="value"
                  type="text"
                  bind:value={row.value}
                />
                <Button
                  aria-label="Remove"
                  class="shrink-0 text-red-500 hover:bg-red-500/10 hover:text-red-500"
                  onclick={() => removeEnvRow(i)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Trash2 class="size-4" />
                </Button>
              </div>
            {/each}

            <div class="mt-1 flex items-center gap-4">
              <Button class="h-auto p-0" onclick={addEnvRow} variant="link">
                <Plus class="size-3.5" />
                Add variable
              </Button>
              <EnvPasteButton onImport={importEnvRows} />
            </div>
          </div>
        </section>

        <!-- ═══ Step 4: Compute ═══ -->
        <section
          class="rounded-2xl border border-border bg-surface"
          class:hidden={currentStep !== 3}
        >
          <div class="flex items-center gap-3 border-b border-border px-5 py-4">
            <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
              <Cpu class="size-4" />
            </div>
            <h2 class="text-sm font-semibold text-text">Compute</h2>
          </div>
          <div class="space-y-5 p-5">
            <div>
              <label class={label} for="restartPolicy"> Restart policy </label>
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
                <label class={label} for="cpuLimit"> CPU limit </label>
                <Input
                  id="cpuLimit"
                  name="cpuLimit"
                  placeholder="e.g. 0.5 (cores)"
                  type="text"
                  bind:value={cpuLimit}
                />
                {#if errors?.cpuLimit}
                  <p class={errorClass}>{errors.cpuLimit[0]}</p>
                {/if}
              </div>
              <div>
                <label class={label} for="memoryLimitMb"> Memory limit (MB) </label>
                <Input
                  id="memoryLimitMb"
                  min="1"
                  name="memoryLimitMb"
                  placeholder="e.g. 512"
                  type="number"
                  bind:value={memoryLimitMb}
                />
                {#if errors?.memoryLimitMb}
                  <p class={errorClass}>{errors.memoryLimitMb[0]}</p>
                {/if}
              </div>
            </div>
            <p class="text-xs text-text-subtle">Leave blank for unlimited.</p>
          </div>
        </section>
      </div>

      <!-- ═══ Step nav ═══ -->
      <div class="flex justify-between gap-3">
        <div>
          {#if currentStep > 0}
            <Button onclick={goBack} variant="outline">
              <ArrowLeft class="size-4" />
              Back
            </Button>
          {/if}
        </div>
        <div class="flex gap-3">
          <Button href={resolve("/services")} variant="outline">
            <X class="size-4" />
            Cancel
          </Button>
          {#if currentStep < STEPS.length - 1}
            <Button onclick={goNext}>
              Next
              <ArrowRight class="size-4" />
            </Button>
          {:else}
            <Button
              disabled={submittingAction !== null}
              formaction="?/create"
              onclick={() => {
                submittingAction = "create";
              }}
              type="submit"
              variant="outline"
            >
              {#if submittingAction === "create"}
                <Spinner />
                Creating…
              {:else}
                <Plus class="size-4" />
                Create service
              {/if}
            </Button>
            <Button
              disabled={submittingAction !== null}
              formaction="?/createAndDeploy"
              onclick={() => {
                submittingAction = "createAndDeploy";
              }}
              type="submit"
            >
              {#if submittingAction === "createAndDeploy"}
                <Spinner />
                Deploying…
              {:else}
                <Rocket class="size-4" />
                Create and Deploy
              {/if}
            </Button>
          {/if}
        </div>
      </div>
    </div>
  </form>
</div>
