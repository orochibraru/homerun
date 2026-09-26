<script lang="ts">
	import { ArrowUpCircle, CircleCheck, RefreshCw } from "@lucide/svelte";
	import { onDestroy } from "svelte";
	import { toast } from "svelte-sonner";
	import Alert from "$lib/components/alert.svelte";
	import AsyncBlock from "$lib/components/async-block.svelte";
	import Skeleton from "$lib/components/skeleton.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Spinner } from "$lib/components/ui/spinner/index.js";
	import {
		checkForUpdates,
		getAppVersion,
		getReleaseStatus,
		getUpdatePreflight,
		startSelfUpdate,
	} from "$lib/remote/self-update.remote";
	import { toastError } from "$lib/toast";

	const { admin }: { admin: boolean } = $props();

	const POLL_MS = 3000;
	const RELEASE_POLL_MS = 10 * 60 * 1000;

	const version = getAppVersion();
	const release = $derived(admin ? getReleaseStatus() : null);
	const latest = $derived(
		release?.current?.updateAvailable ? release.current.latest : null,
	);

	let open = $state(false);
	let checking = $state(false);
	let starting = $state(false);
	let updatingTo = $state<string | null>(null);
	let timer: ReturnType<typeof setInterval> | null = null;

	const preflight = $derived(
		open && latest && !updatingTo ? getUpdatePreflight() : null,
	);
	const status = $derived(release?.current ?? null);

	$effect(() => {
		if (!release) {
			return;
		}
		const releaseTimer = setInterval(() => {
			release.refresh().catch(() => undefined);
		}, RELEASE_POLL_MS);
		return () => clearInterval(releaseTimer);
	});

	function waitForNewVersion(from: string | undefined) {
		timer = setInterval(async () => {
			try {
				await version.refresh();
			} catch {
				return;
			}
			if (version.current && version.current !== from) {
				location.reload();
			}
		}, POLL_MS);
	}

	onDestroy(() => {
		if (timer) {
			clearInterval(timer);
		}
	});

	async function updateCallback() {
		starting = true;
		try {
			const result = await startSelfUpdate();
			updatingTo = result.version;
			waitForNewVersion(version.current);
			return result;
		} catch (error) {
			await preflight?.refresh();
			throw error;
		} finally {
			starting = false;
		}
	}

	async function checkCallback() {
		checking = true;
		try {
			const result = await checkForUpdates();
			if (!result.latest) {
				throw new Error(
					`Couldn't reach GitHub to look up the newest ${result.channel} release.`,
				);
			}
			return result;
		} finally {
			checking = false;
		}
	}

	function handleCheck() {
		return toast.promise(checkCallback(), {
			error: (error) => toastError(error, "Couldn't check for updates"),
			loading: "Checking for updates",
			success: (result) =>
				result.updateAvailable && result.latest
					? `v${result.latest.version} is available`
					: `v${result.current} is the newest ${result.channel} release`,
		});
	}

	function handleUpdate() {
		return toast.promise(updateCallback(), {
			error: (error) => toastError(error, "Couldn't start the update"),
			loading: "Starting the update",
			success: (result) => `Updating to v${result.version}`,
		});
	}
</script>

<div class="space-y-1.5 px-3 py-2">
  {#if latest}
    <button
      class="border-accent/30 bg-accent-light text-accent hover:bg-accent-light/70 flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-colors"
      onclick={() => {
        open = true;
      }}
      type="button"
    >
      <ArrowUpCircle class="size-4 shrink-0" />
      <span class="truncate">v{latest.version} is available</span>
    </button>
  {/if}
  {#if admin}
    <button
      class="text-text-subtle hover:text-text font-mono text-[0.6875rem] transition-colors"
      onclick={() => {
        open = true;
      }}
      title="Update status"
      type="button"
    >
      {#if version.current}
        v{version.current}
      {:else}
        &nbsp;
      {/if}
    </button>
  {:else}
    <p class="text-text-subtle font-mono text-[0.6875rem]">
      {#if version.current}
        v{version.current}
      {:else}
        &nbsp;
      {/if}
    </p>
  {/if}
</div>

{#if admin}
  <Dialog.Root bind:open>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>
          {latest ? `Update to v${latest.version}` : `Homerun v${version.current ?? ""}`}
        </Dialog.Title>
        <Dialog.Description>
          {#if latest}
            You're on v{version.current}.
            <a class="text-accent underline" href={latest.url} rel="noreferrer" target="_blank">
              Release notes
            </a>
          {:else if status}
            Following the {status.channel} channel.
            {#if status.checkedAt}
              Last checked {new Date(status.checkedAt).toLocaleString()}.
            {/if}
          {/if}
        </Dialog.Description>
      </Dialog.Header>

      {#if !latest}
        {#if release?.error}
          <Alert title="Couldn't load the update status" variant="warning">
            Try checking again.
          </Alert>
        {:else if !status}
          <Skeleton class="h-10 w-full" />
        {:else if status.latest}
          <p class="text-text-muted flex items-center gap-2 text-sm">
            <CircleCheck class="text-accent size-4 shrink-0" />
            Up to date: v{status.latest.version} is the newest {status.channel} release.
          </p>
        {:else}
          <Alert title="Couldn't reach GitHub" variant="warning">
            The newest {status.channel} release couldn't be looked up. Check again in a moment.
          </Alert>
        {/if}
      {:else if updatingTo}
        <Alert title="Updating to v{updatingTo}" variant="info">
          <span class="flex items-center gap-2">
            <Spinner class="size-3.5" />
            Pulling the new image and restarting Homerun. This page reloads once it's back.
          </span>
          <span class="mt-1 block">
            Nothing after a few minutes? Check <code>docker logs homerun-updater</code> on the host.
          </span>
        </Alert>
      {:else if preflight}
        <AsyncBlock errorTitle="Couldn't check whether Homerun can update." query={preflight}>
          {#snippet pending()}
            <Skeleton class="h-16 w-full" />
          {/snippet}
          {#snippet children(check)}
            {#if !check.supported}
              <Alert title="Not available here" variant="info">{check.reason}</Alert>
            {:else if !check.ready}
              <Alert title="Not right now" variant="warning">
                {check.reason}
                {#snippet actions()}
                  <Button onclick={() => preflight.refresh()} size="sm" variant="outline">
                    Check again
                  </Button>
                {/snippet}
              </Alert>
            {:else}
              <p class="text-text-muted text-sm">
                No new deployments or jobs start while the update runs. A helper container pulls
                the new image and recreates the Homerun container, so the dashboard is unavailable
                for a moment.
              </p>
            {/if}
          {/snippet}
        </AsyncBlock>
      {/if}

      <Dialog.Footer>
        <Button
          onclick={() => {
            open = false;
          }}
          type="button"
          variant="outline"
        >
          Close
        </Button>
        {#if !updatingTo}
          <Button
            disabled={checking}
            onclick={handleCheck}
            type="button"
            variant={latest ? "outline" : "default"}
          >
            {#if checking}
              <Spinner class="size-4" />
            {:else}
              <RefreshCw class="size-4" />
            {/if}
            Check for updates
          </Button>
        {/if}
        {#if !updatingTo && latest && preflight?.current?.ready}
          <Button disabled={starting} onclick={handleUpdate} type="button">
            {#if starting}
              <Spinner class="size-4" />
            {/if}
            Update now
          </Button>
        {/if}
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
