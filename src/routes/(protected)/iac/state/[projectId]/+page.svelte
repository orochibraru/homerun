<script lang="ts">
	import { FileCode2, History, Lock } from "@lucide/svelte";
	import CodeBlock from "#lib/components/code-block.svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { formatBytes, timeAgo } from "#lib/formatting.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	const { data } = $props();

	const versionCount = $derived(data.history.length);
	let confirm = $state<{
		description: string;
		form: HTMLFormElement | null;
		label: string;
		title: string;
	} | null>(null);
	let confirmOpen = $state(false);

	function requestConfirm(
		event: MouseEvent,
		next: { description: string; label: string; title: string },
	) {
		confirm = {
			...next,
			form: (event.currentTarget as HTMLElement).closest("form"),
		};
		confirmOpen = true;
	}
</script>

<div class="space-y-5">
  <section class="panel rounded-md">
    <PanelHeader
      description="Paste it into your Terraform configuration."
      icon={FileCode2}
      title="Backend block"
    />
    <div class="px-5 py-4 text-sm">
      <CodeBlock code={data.terraform.code} html={data.terraform.html} label="backend block" />
      <p class="text-text-muted mt-1.5 text-xs">
        Export an API key as <code>TF_HTTP_PASSWORD</code> (create one under
        <a class="text-accent hover:underline" href={resolve("/(protected)/iac/credentials/new")}>Credentials</a>),
        then <code>terraform init</code>. Every write is a version below, signed
        with that key's owner.
      </p>
    </div>
  </section>

  <section class="panel rounded-md">
    <PanelHeader
      description={data.lock
        ? `Taken ${timeAgo(data.lock.createdAt)}${data.lock.userName ? ` by ${data.lock.userName}` : ""}.`
        : "Unlocked. Terraform takes the lock for every plan and apply."}
      icon={Lock}
      title="Lock"
    >
      {#snippet trailing()}
        {#if data.lock}
          <form
            action="?/forceUnlock"
            method="POST"
            use:enhance={enhanceToast({
              error: "Couldn't unlock the state.",
              loading: "Unlocking the state",
              success: "State unlocked.",
            })}
          >
            <Button
              onclick={(event: MouseEvent) =>
                requestConfirm(event, {
                  description:
                    "Only do this when the Terraform that took the lock is gone. If it's still running, the next write can overwrite its work.",
                  label: "Force unlock",
                  title: "Force-unlock the state?",
                })}
              size="sm"
              type="button"
              variant="outline"
            >
              Force unlock
            </Button>
          </form>
        {/if}
      {/snippet}
    </PanelHeader>
    {#if data.lock?.info}
      <pre class="text-text-muted overflow-x-auto px-5 py-4 font-mono text-xs">{JSON.stringify(data.lock.info, null, 2)}</pre>
    {/if}
  </section>

  <section class="panel rounded-md">
    <PanelHeader
      description={versionCount === 0
        ? "Nothing written yet. Run terraform init and apply with the backend above."
        : "Newest first. Open one to see what it changed."}
      icon={History}
      title="Versions"
    />
    {#if versionCount > 0}
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
              <th class="px-4 py-3 font-medium">Serial</th>
              <th class="px-4 py-3 font-medium">Written</th>
              <th class="hidden px-4 py-3 font-medium md:table-cell">By</th>
              <th class="hidden px-4 py-3 font-medium md:table-cell">Size</th>
              <th class="px-4 py-3"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {#each data.history as version, index (version.id)}
              <tr class="border-border/60 hover:bg-surface-2 border-b last:border-0">
                <td class="px-4 py-3 tabular-nums">
                  <a
                    class="text-text hover:text-accent font-medium"
                    href={resolve(
                      "/(protected)/iac/state/[projectId]/versions/[versionId]",
                      { projectId: data.project.id, versionId: version.id },
                    )}
                  >
                    {version.serial}
                  </a>
                  {#if version.rollbackOfId}
                    <span class="text-text-subtle ml-1 text-xs">rollback</span>
                  {/if}
                  {#if index === 0}
                    <span class="text-accent ml-1 text-xs">current</span>
                  {/if}
                </td>
                <td class="text-text-muted px-4 py-3" title={new Date(version.createdAt).toLocaleString()}>
                  {timeAgo(version.createdAt)}
                </td>
                <td class="text-text-muted hidden px-4 py-3 md:table-cell">{version.userName ?? "—"}</td>
                <td class="text-text-muted hidden px-4 py-3 tabular-nums md:table-cell">{formatBytes(version.sizeBytes)}</td>
                <td class="px-4 py-3 text-right">
                  {#if index > 0}
                    <form
                      action="?/rollback"
                      method="POST"
                      use:enhance={enhanceToast({
                        error: "Couldn't roll back.",
                        loading: `Rolling back to serial ${version.serial}`,
                        success: (result) =>
                          `Rolled back: serial ${String(result?.serial ?? "")} is current.`,
                      })}
                    >
                      <input name="versionId" type="hidden" value={version.id} />
                      <Button
                        onclick={(event: MouseEvent) =>
                          requestConfirm(event, {
                            description:
                              "Writes this version back as the newest state, with a new serial. The versions after it stay in the history.",
                            label: "Roll back",
                            title: `Roll back to serial ${version.serial}?`,
                          })}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Roll back
                      </Button>
                    </form>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  confirmLabel={confirm?.label ?? "Confirm"}
  description={confirm?.description ?? ""}
  onConfirm={() => confirm?.form?.requestSubmit()}
  title={confirm?.title ?? ""}
/>
