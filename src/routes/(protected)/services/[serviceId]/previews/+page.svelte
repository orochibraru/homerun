<script lang="ts">
	import {
		Check,
		ExternalLink,
		GitPullRequest,
		Globe,
		RotateCw,
		Trash2,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import CheckBox from "$lib/components/check-box.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Previews`));

	const label = "block mb-1.5 text-sm font-medium text-text";
	const errorClass = "mt-1.5 text-xs text-red-500";

	const values = $derived(
		(form && "values" in form
			? (form.values as Record<string, string>)
			: undefined) ?? {
			previewDefaultDomain: svc.previewDefaultDomain ? "on" : "",
			previewDomainTemplate: svc.previewDomainTemplate ?? "",
			previewsEnabled: svc.previewsEnabled ? "on" : "",
		},
	);
	const errors = $derived(
		form && "errors" in form
			? (form.errors as Record<string, string[]>)
			: undefined,
	);

	let previewsEnabled = $derived(values.previewsEnabled === "on");
	let previewDefaultDomain = $derived(values.previewDefaultDomain === "on");
	let submitting = $state(false);
	let pendingId = $state<string | null>(null);
	let deleteTarget = $state<{ id: string; label: string } | null>(null);
	let deleteOpen = $state(false);
	let deleteForm = $state<HTMLFormElement>();
</script>

{#if svc.previewParentId}
  <EmptyState
    icon={GitPullRequest}
    subtitle="Previews are managed on the service this one previews."
    title="This service is itself a preview"
  >
    <Button
      href={resolve("/(protected)/services/[serviceId]/previews", {
        serviceId: svc.previewParentId,
      })}
      variant="outline"
    >
      Open the parent's previews
    </Button>
  </EmptyState>
{:else if svc.buildSource !== "git"}
  <EmptyState
    icon={GitPullRequest}
    subtitle="Pull request previews build from a repository. Switch the source to a git repo first."
    title="Previews need a service built from git"
  >
    <Button
      href={resolve("/(protected)/services/[serviceId]/source", {
        serviceId: svc.id,
      })}
      variant="outline"
    >
      Open Source
    </Button>
  </EmptyState>
{:else}
  <div class="space-y-6">
    <section class="panel rounded-md">
      <PanelHeader
        description="Every pull request opened on the repo gets its own service, built from its head, redeployed on every push to it and removed when it's closed or merged. Pull requests from forks are never previewed."
        icon={GitPullRequest}
        title="Pull request previews"
      />
      <form
        action="?/updatePreviews"
        class="space-y-5 p-5"
        method="POST"
        use:enhance={enhanceToast({
          error: "Check the form for errors.",
          loading: "Saving preview settings",
          onSettled: () => {
            submitting = false;
          },
          onStart: () => {
            submitting = true;
          },
          success: "Saved.",
        })}
      >
        {#if form && "error" in form && form.error}
          <Alert>{form.error}</Alert>
        {/if}

        <CheckBox
          helperText={`Each preview is a service named ${svc.slug}-pr-<number>. Needs the repository webhook, see below.`}
          id="previewsEnabled"
          label="Enable pull request previews"
          name="previewsEnabled"
          bind:checked={previewsEnabled}
        />

        <div class="space-y-5 transition-opacity {previewsEnabled ? '' : 'opacity-50'}">
          <div>
            <label class={label} for="previewDomainTemplate">
              Domain template
            </label>
            <Input
              id="previewDomainTemplate"
              name="previewDomainTemplate"
              placeholder="pr-{'{pr}'}.preview.example.com"
              type="text"
              value={values.previewDomainTemplate}
            />
            <p class="text-text-subtle mt-1.5 text-xs">
              Gives every preview its own domain: <code>{"{pr}"}</code> is the
              pull request number, <code>{"{branch}"}</code> its branch as one
              DNS label (<code>feat/login</code> becomes
              <code>feat-login</code>), <code>{"{slug}"}</code> this service's
              slug. Point a wildcard DNS record at this host, or let the DNS
              automation create each record. Saving re-applies it to every open
              preview and redeploys them.
            </p>
            {#if errors?.previewDomainTemplate}
              <p class={errorClass}>{errors.previewDomainTemplate[0]}</p>
            {/if}
          </div>

          <CheckBox
            helperText={`Also route ${data.defaultPreviewHostname}. Kept regardless when there's no template, a preview needs at least one domain.`}
            id="previewDefaultDomain"
            label="Keep the default hostname"
            name="previewDefaultDomain"
            bind:checked={previewDefaultDomain}
          />
        </div>

        {#if data.pushWebhook}
          <p class="text-xs {data.pushWebhook.registered ? 'text-emerald-600' : 'text-amber-600'}">
            {#if data.pushWebhook.registered}
              Webhook registered on {data.pushWebhook.providerName ??
                "the provider"}, pull request events included.
            {:else}
              The webhook isn't registered yet, so no pull request reaches
              Homerun. Its URL and secret are on the
              <a
                class="underline"
                href={resolve("/(protected)/services/[serviceId]/source", {
                  serviceId: svc.id,
                })}
              >
                Source
              </a>
              tab.
            {/if}
          </p>
        {/if}

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

    <section class="panel rounded-md">
      <PanelHeader
        description="Open pull requests with a preview, newest first."
        icon={Globe}
        title="Open previews"
      />
      {#if data.previews.length === 0}
        <p class="text-text-subtle p-5 text-sm">
          {svc.previewsEnabled
            ? "No open pull request has a preview yet."
            : "Previews are off."}
        </p>
      {:else}
        <ul class="divide-border divide-y">
          {#each data.previews as preview (preview.id)}
            <li class="flex flex-wrap items-center gap-3 px-5 py-3">
              <div class="min-w-0 flex-1">
                <a
                  class="text-text text-sm font-medium hover:underline"
                  href={resolve("/(protected)/services/[serviceId]", {
                    serviceId: preview.id,
                  })}
                >
                  #{preview.prNumber} {preview.title ?? preview.name}
                </a>
                <p class="text-text-muted truncate font-mono text-xs">
                  {preview.branch ?? preview.gitRef}
                </p>
                {#if preview.hostnames.length > 0}
                  <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {#each preview.hostnames as hostname (hostname)}
                      <a
                        class="text-accent inline-flex items-center gap-1 text-xs hover:underline"
                        href="{data.publicScheme}://{hostname}"
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {hostname}
                        <ExternalLink class="size-3" />
                      </a>
                    {/each}
                  </div>
                {/if}
              </div>
              <StatusBadge status={preview.status} />
              <div class="flex items-center gap-1">
                <Button
                  href={resolve("/(protected)/services/[serviceId]/networking", {
                    serviceId: preview.id,
                  })}
                  size="sm"
                  variant="ghost"
                >
                  <Globe class="size-4" />
                  Domains
                </Button>
                <form
                  action="?/redeploy"
                  method="POST"
                  use:enhance={enhanceToast({
                    error: "Couldn't redeploy the preview.",
                    loading: `Redeploying #${preview.prNumber}`,
                    onSettled: () => {
                      pendingId = null;
                    },
                    onStart: () => {
                      pendingId = preview.id;
                    },
                    success: "Redeploy queued.",
                  })}
                >
                  <input name="previewId" type="hidden" value={preview.id}>
                  <Button
                    disabled={pendingId === preview.id}
                    size="sm"
                    type="submit"
                    variant="ghost"
                  >
                    <RotateCw class="size-4" />
                    Redeploy
                  </Button>
                </form>
                <Button
                  class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
                  disabled={pendingId === preview.id}
                  onclick={() => {
                    deleteTarget = {
                      id: preview.id,
                      label: `#${preview.prNumber}`,
                    };
                    deleteOpen = true;
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 class="size-4" />
                  Delete
                </Button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  <form
    bind:this={deleteForm}
    action="?/delete"
    class="hidden"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't delete the preview.",
      loading: `Deleting preview ${deleteTarget?.label ?? ""}`,
      onSettled: () => {
        pendingId = null;
      },
      onStart: () => {
        pendingId = deleteTarget?.id ?? null;
      },
      success: "Preview deleted.",
    })}
  >
    <input name="previewId" type="hidden" value={deleteTarget?.id ?? ""}>
  </form>

  <ConfirmDialog
    confirmLabel="Delete"
    description="Removes its container, domains and DNS records. The next push to the pull request creates it again."
    onConfirm={() => deleteForm?.requestSubmit()}
    title="Delete preview {deleteTarget?.label ?? ''}?"
    bind:open={deleteOpen}
  />
{/if}
