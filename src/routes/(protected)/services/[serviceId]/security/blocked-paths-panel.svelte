<script lang="ts">
	import { Plus, ShieldBan } from "@lucide/svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Textarea } from "#lib/components/ui/textarea/index.js";
	import {
		PATH_PATTERN_PRESETS,
		parsePathPatterns,
	} from "#lib/path-patterns.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	interface Props {
		blockedPageAvailable: boolean;
		blockedPaths: string[];
		dnsResolvable: boolean;
	}

	const { blockedPageAvailable, blockedPaths, dnsResolvable }: Props = $props();

	let saving = $state(false);
	let text = $derived(blockedPaths.join("\n"));

	function addPreset(patterns: string[]) {
		text = [...new Set([...parsePathPatterns(text), ...patterns])].join("\n");
	}
</script>

<section class="panel rounded-md">
  <PanelHeader
    description="Requests whose path matches one of these patterns get a 403 from Traefik and never reach the app."
    icon={ShieldBan}
    title="Blocked paths"
  >
    {#snippet trailing()}
      {#if dnsResolvable}
        <SaveButton form="blocked-paths" pending={saving} />
      {/if}
    {/snippet}
  </PanelHeader>

  {#if !dnsResolvable}
    <p class="text-text-muted p-5 text-sm">
      Not applicable : this service isn't publicly routed, so there's no
      Traefik router to filter.
    </p>
  {:else}
    <form
      id="blocked-paths"
      action="?/updateBlockedPaths"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the blocked paths.",
        loading: "Saving blocked paths",
        onSettled: () => {
          saving = false;
        },
        onStart: () => {
          saving = true;
        },
        success: (data) =>
          (data as { redeploying?: boolean } | undefined)?.redeploying
            ? "Blocked paths saved. Redeploying so Traefik picks them up."
            : "Blocked paths saved. They apply on the next deploy.",
      })}
    >
      <div class="flex flex-wrap gap-2">
        {#each PATH_PATTERN_PRESETS as preset (preset.id)}
          <Button
            onclick={() => addPreset(preset.patterns)}
            size="sm"
            title={preset.description}
            type="button"
            variant="outline"
          >
            <Plus class="size-4" />
            {preset.label}
          </Button>
        {/each}
      </div>

      <div>
        <label class={label} for="blockedPaths">Patterns</label>
        <Textarea
          id="blockedPaths"
          name="blockedPaths"
          placeholder={".env\n.git\n/admin\n*.sql"}
          rows={8}
          bind:value={text}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          One per line, case-insensitive. A pattern matches whole path
          segments anywhere in the path (<code>.git</code> blocks
          <code>/.git/config</code> and <code>/app/.git</code>, not
          <code>/.github</code>); start it with <code>/</code> to match from
          the root only. <code>*</code> matches anything, slashes included,
          <code>?</code> one character.
        </p>
      </div>

      <p class="text-text-subtle text-xs">
        {#if blockedPageAvailable}
          Visitors get the Blocked path page from

          <a
            class="text-accent underline"
            href={resolve("settings/error-pages")}
          >Settings → Error pages</a>

          , and an address that keeps hitting blocked paths is banned
          instance-wide, see

          <a
            class="text-accent underline"
            href={resolve("settings/ip-bans")}
          >Settings → IP bans</a>

          .
        {:else}
          The error pages aren't published to Traefik (Settings →
          Networking → Dynamic config directory), so Traefik answers a bare
          403 and repeated attempts aren't counted towards an IP ban.
        {/if}
      </p>
    </form>
  {/if}
</section>
