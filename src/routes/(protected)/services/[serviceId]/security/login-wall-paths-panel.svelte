<script lang="ts">
	import { Route } from "@lucide/svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import * as Select from "#lib/components/ui/select/index.js";
	import { Textarea } from "#lib/components/ui/textarea/index.js";
	import type { AuthPathsMode } from "#lib/path-patterns.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	interface Props {
		authPaths: string[];
		authPathsMode: AuthPathsMode;
		authRequired: boolean;
	}

	const { authPaths, authPathsMode, authRequired }: Props = $props();

	const MODES: { description: string; label: string; value: AuthPathsMode }[] =
		[
			{
				description: "The whole app is behind the login wall.",
				label: "Every path",
				value: "all",
			},
			{
				description:
					"Only paths matching a pattern ask for a login; the rest is public.",
				label: "Only these paths",
				value: "only",
			},
			{
				description:
					"Everything asks for a login except paths matching a pattern, like a public API or a health check.",
				label: "Every path except these",
				value: "except",
			},
		];

	let saving = $state(false);
	let mode = $derived<string>(authPathsMode);
	const selected = $derived(
		MODES.find((entry) => entry.value === mode) ?? MODES[0],
	);
</script>

<section class="panel rounded-md">
  <PanelHeader
    description={authRequired
      ? "Which paths of this app the login wall covers."
      : "Applies once the login wall above is on."}
    icon={Route}
    title="Login wall paths"
  >
    {#snippet trailing()}
      <SaveButton form="login-wall-paths" pending={saving} />
    {/snippet}
  </PanelHeader>

  <form
    id="login-wall-paths"
    action="?/updateAuthPaths"
    class="space-y-4 p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't save the login wall paths.",
      loading: "Saving login wall paths",
      onSettled: () => {
        saving = false;
      },
      onStart: () => {
        saving = true;
      },
      success: (data) =>
        (data as { redeploying?: boolean } | undefined)?.redeploying
          ? "Login wall paths saved. Redeploying so Traefik picks them up."
          : "Login wall paths saved.",
    })}
  >
    <div>
      <div class={label}>Covers</div>
      <Select.Root name="authPathsMode" type="single" bind:value={mode}>
        <Select.Trigger class="w-full sm:w-72">
          {selected.label}
        </Select.Trigger>
        <Select.Content>
          {#each MODES as entry (entry.value)}
            <Select.Item label={entry.label} value={entry.value} />
          {/each}
        </Select.Content>
      </Select.Root>
      <p class="text-text-subtle mt-1.5 text-xs">{selected.description}</p>
    </div>

    <div hidden={mode === "all"}>
      <label class={label} for="authPaths">Patterns</label>
      <Textarea
        id="authPaths"
        name="authPaths"
        placeholder={mode === "only" ? "/admin\n/dashboard" : "/api\n/health"}
        rows={5}
        value={authPaths.join("\n")}
      />
      <p class="text-text-subtle mt-1.5 text-xs">
        One per line, same syntax as blocked paths: a pattern matches whole
        path segments anywhere in the path, a leading <code>/</code>
        anchors it at the root, <code>*</code> matches anything. The login
        wall's own sign-in callback always stays behind it.
      </p>
    </div>
  </form>
</section>
