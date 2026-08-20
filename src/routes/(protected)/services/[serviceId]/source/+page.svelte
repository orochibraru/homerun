<script lang="ts">
	import {
		Check,
		ChevronDown,
		Container,
		GitBranch,
		Lock,
		TriangleAlertIcon,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";

	const { data, form } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Source`));

	const label = "block mb-1.5 text-sm font-medium text-text";
	const errorClass = "mt-1.5 text-xs text-red-500";

	const values = $derived(
		(form?.values as Record<string, string> | undefined) ?? {
			buildSource: svc.buildSource,
			gitBuildContext: svc.gitBuildContext ?? "",
			gitDockerfilePath: svc.gitDockerfilePath ?? "",
			gitRef: svc.gitRef ?? "main",
			gitUrl: svc.gitUrl ?? "",
			image: svc.image,
			registryUrl: svc.registryUrl ?? "",
			registryUsername: svc.registryUsername ?? "",
			tag: svc.tag,
		},
	);
	const errors = $derived(form?.errors as Record<string, string[]> | undefined);

	let submitting = $state(false);
	let showRegistry = $derived(!!svc.registryUsername);

	let buildSource = $derived<"image" | "git">(
		(values.buildSource as "image" | "git") ?? "image",
	);
	let image = $derived(values.image);
	let tag = $derived(values.tag);
	let registryUrl = $derived(values.registryUrl);
	let gitUrl = $derived(values.gitUrl);
	let gitRef = $derived(values.gitRef);
	let imageCheck = $state<{ checked: boolean; exists: boolean } | null>(null);
	let imageCheckTimer: ReturnType<typeof setTimeout> | undefined;

	// "Browse repos" : only shown when the user has at least one connected
	// git provider (see the Git Providers page). Picking a repo autofills
	// gitUrl/gitRef below rather than requiring a pasted URL, and checks for
	// a Dockerfile at the picked ref so there's a heads-up before deploying
	// fails on a repo that doesn't have one.
	let browseProviderId = $state(data.connectedGitProviders[0]?.id ?? "");
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
				`/api/v1/git-providers/${browseProviderId}/dockerfile?repo=${encodeURIComponent(fullName)}&ref=${encodeURIComponent(repo.defaultBranch)}`,
			);
			if (res.ok) {
				const body = (await res.json()) as { exists: boolean };
				dockerfileCheck = { checked: true, exists: body.exists };
			}
		} catch {
			// Best-effort : not finding out doesn't block picking the repo.
		}
	}

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

<section class="border-border bg-surface rounded-2xl border">
  <div class="border-border flex items-center gap-3 border-b px-5 py-4">
    <div
      class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
    >
      <Container class="size-4" />
    </div>
    <div>
      <h2 class="text-text text-sm font-semibold">Source</h2>
      <p class="text-text-muted text-xs">
        What gets deployed. Changes take effect on the next deploy.
      </p>
    </div>
  </div>

  <form
    action="?/updateSource"
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
      <p class="text-text-subtle mt-1.5 text-xs">
        Switching this doesn't redeploy by itself : save, then redeploy from
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
            wasn't found in its registry. You can still save : this doesn't
            block deploying.
          </span>
        </div>
      {/if}
    {:else}
      {#if data.connectedGitProviders.length > 0}
        <div class="border-border rounded-xl border p-4">
          <p class={label}>Browse repos</p>
          <div class="flex flex-wrap gap-2">
            {#if data.connectedGitProviders.length > 1}
              <select
                bind:value={browseProviderId}
                class="border-border bg-surface rounded-lg border px-3 py-2 text-sm"
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
              class="border-border bg-surface mt-3 w-full rounded-lg border px-3 py-2 text-sm"
              onchange={(e) => pickRepo(e.currentTarget.value)}
            >
              <option value="">Select a repo…</option>
              {#each repos as repo (repo.fullName)}
                <option value={repo.fullName}
                  >{repo.fullName}{repo.private ? " (private)" : ""}</option
                >
              {/each}
            </select>
            {#if dockerfileCheck?.checked}
              <p
                class="mt-2 text-xs {dockerfileCheck.exists
                  ? 'text-emerald-600'
                  : 'text-amber-600'}"
              >
                {dockerfileCheck.exists
                  ? "✓ Dockerfile found at the repo root."
                  : "⚠ No Dockerfile found at the repo root on this branch : the build will fail unless one exists at the path you set below."}
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

    <div class="border-border rounded-xl border">
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
          class="text-text-muted size-4 transition-transform {showRegistry
            ? 'rotate-180'
            : ''}"
        />
      </Button>
      {#if showRegistry}
        <div class="border-border space-y-4 border-t p-4">
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
