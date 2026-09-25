<script lang="ts">
	import { Link2 } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import CheckBox from "$lib/components/check-box.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import ResponsiveDialog from "$lib/components/responsive-dialog.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import { enhanceToast } from "$lib/toast";

	interface LinkableService {
		id: string;
		image: string;
		name: string;
		stackId: string | null;
	}

	interface Props {
		/** Path of the route whose form actions handle this dialog, e.g. `/services`; empty for the current route. */
		actionBase?: string;
		service: LinkableService | null;
		services: LinkableService[];
		stacks: { id: string; name: string }[];
	}

	const { actionBase = "", service, services, stacks }: Props = $props();

	let open = $state(false);
	let linkTargetId = $state("");
	let linkFormat = $state<"url" | "jdbc" | "vars">("url");
	let alsoGroup = $state(true);

	const groupHint = $derived.by(() => {
		const target = services.find((svc) => svc.id === linkTargetId);
		const existingId = service?.stackId ?? target?.stackId ?? null;
		if (existingId) {
			const name =
				stacks.find((stack) => stack.id === existingId)?.name ?? "that stack";
			return `Moves both into ${name}, where they reach each other by slug.`;
		}
		return service
			? `Creates a stack named "${service.name}" and moves both into it, so they reach each other by slug.`
			: "They only reach each other by slug once they share a stack network.";
	});

	const linkCandidates = $derived(
		services.filter((svc) => svc.id !== service?.id),
	);

	/** Opens the dialog with the target and format picks cleared. */
	export function show(): void {
		linkTargetId = "";
		linkFormat = "url";
		open = true;
	}
</script>

<ResponsiveDialog
  description="Writes the connection variables for the service you pick into this service's own environment. Takes effect on its next deploy."
  size="sm"
  title="Link {service?.name ?? 'service'}"
  bind:open
>
  <form
    action="{actionBase}?/link"
    class="space-y-4"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't link the services.",
      loading: "Linking",
      onSuccess: () => {
        open = false;
      },
      success: (result) => {
        const data = result as
          | { grouped?: boolean; linked?: string[] }
          | undefined;
        const keys = data?.linked ?? [];
        const vars = keys.length > 0 ? `Added ${keys.join(", ")}` : "Linked";
        return data?.grouped ? `${vars}, and grouped them.` : `${vars}.`;
      },
    })}
  >
    <input name="serviceId" type="hidden" value={service?.id ?? ""}>
    <div>
      <label class={label} for="targetId">Link to</label>
      <SelectRoot name="targetId" type="single" bind:value={linkTargetId}>
        <SelectTrigger class="w-full" id="targetId">
          {linkCandidates.find((svc) => svc.id === linkTargetId)?.name
          ?? "Select a service"}
        </SelectTrigger>
        <SelectContent>
          {#each linkCandidates as svc (svc.id)}
            <SelectItem label="{svc.name} ({svc.image})" value={svc.id} />
          {/each}
        </SelectContent>
      </SelectRoot>
    </div>
    <div>
      <label class={label} for="format">Inject as</label>
      <SelectRoot name="format" type="single" bind:value={linkFormat}>
        <SelectTrigger class="w-full" id="format">
          {linkFormat === "jdbc"
          ? "JDBC URL"
          : linkFormat === "vars"
            ? "Separate variables"
            : "Connection URL"}
        </SelectTrigger>
        <SelectContent>
          <SelectItem label="Connection URL" value="url" />
          <SelectItem label="JDBC URL" value="jdbc" />
          <SelectItem label="Separate variables" value="vars" />
        </SelectContent>
      </SelectRoot>
    </div>
    <CheckBox
      helperText={groupHint}
      id="alsoGroup"
      label="Also put them in the same stack"
      name="alsoGroup"
      bind:checked={alsoGroup}
    />

    <div class="flex justify-end gap-2">
      <Button disabled={!linkTargetId} type="submit">
        <Link2 class="size-4" />
        Link
      </Button>
    </div>
  </form>
</ResponsiveDialog>
