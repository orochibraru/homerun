<script lang="ts">
	import { LogOut, Monitor, ShieldCheck, TriangleAlert } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";

	const { data } = $props();

	onMount(() => title.set("Sessions"));

	function formatDate(value: Date | string): string {
		return new Date(value).toLocaleString();
	}
</script>

<section class="rounded-2xl border border-border bg-surface">
  <div class="flex items-center gap-3 border-b border-border px-5 py-4">
    <div class="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
      <ShieldCheck class="size-4" />
    </div>
    <div>
      <h2 class="text-sm font-semibold text-text">Sessions</h2>
      <p class="text-xs text-text-muted">
        Every device currently signed in to your account. Revoking one signs
        that device out immediately.
      </p>
    </div>
  </div>

  <div class="p-5">
    {#if data.sessions === null}
      <div class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400">
        <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
        <span>
          Couldn't load your sessions : this needs a fresh sign-in. Sign out
          and back in, then try this tab again.
        </span>
      </div>
    {:else if data.sessions.length === 0}
      <p class="text-sm text-text-muted">No active sessions found.</p>
    {:else}
      <div class="space-y-2.5">
        {#each data.sessions as s (s.id)}
          {@const isCurrent = s.id === data.currentSessionId}
          <div class="flex items-center gap-4 rounded-xl border border-border p-4">
            <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-muted">
              <Monitor class="size-4" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-text">
                {s.userAgent ?? "Unknown device"}
                {#if isCurrent}
                  <span class="ml-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                    This device
                  </span>
                {/if}
              </p>
              <p class="mt-0.5 truncate text-xs text-text-muted">
                {s.ipAddress ?? "unknown IP"}
                · signed in {formatDate(s.createdAt)}
              </p>
            </div>
            {#if !isCurrent}
              <form
                action="?/revoke"
                method="POST"
                use:enhance={() => async ({ result, update }) => {
                  if (result.type === "failure") {
                    toast.error("Couldn't revoke that session.");
                  } else if (result.type === "success") {
                    toast.success("Session revoked.");
                  }
                  await update();
                }}
              >
                <input name="sessionId" type="hidden" value={s.id}>
                <Button
                  class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
                  size="icon-sm"
                  title="Revoke session"
                  type="submit"
                  variant="ghost"
                >
                  <LogOut class="size-4" />
                </Button>
              </form>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>
