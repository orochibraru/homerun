<script lang="ts">
	import { ArrowRight, Server, Unlink } from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import { Button } from "$lib/components/ui/button/index.js";
	import UnlinkDialog, {
		type UnlinkTarget,
	} from "$lib/components/unlink-dialog.svelte";

	interface Node {
		id: string;
		/** The env vars carrying the link: in this service for a dependency, in the other one for a consumer. */
		keys: string[];
		name: string;
		slug: string;
	}

	interface Props {
		dependsOn: Node[];
		name: string;
		serviceId: string;
		usedBy: Node[];
	}

	const { name, dependsOn, serviceId, usedBy }: Props = $props();

	let unlinkOpen = $state(false);
	let unlink = $state<UnlinkTarget | null>(null);

	function askUnlink(item: Node, direction: "dependsOn" | "usedBy") {
		const self = { id: serviceId, name };
		const other = { id: item.id, name: item.name };
		unlink =
			direction === "dependsOn"
				? { from: self, keys: item.keys, to: other }
				: { from: other, keys: item.keys, to: self };
		unlinkOpen = true;
	}
</script>

{#snippet node(item: Node, direction: "dependsOn" | "usedBy")}
    <div
        class="border-border bg-surface-2 hover:border-accent/50 flex items-center gap-1 rounded-lg border pr-1 transition-colors"
    >
        <a
            class="flex min-w-0 flex-1 items-center gap-2 px-3 py-2"
            href="{resolve('/services')}/{item.id}"
            title={item.keys.length > 0
                ? `Through ${item.keys.join(", ")}`
                : "Dependency only, no env vars"}
        >
            <Server class="text-text-subtle size-3.5 shrink-0" />
            <span class="min-w-0">
                <span class="text-text block truncate text-xs font-medium"
                    >{item.name}</span
                >
                <span class="text-text-subtle block truncate text-[0.6875rem]"
                    >{item.slug}</span
                >
            </span>
        </a>
        <Button
            aria-label="Unlink {item.name}"
            class="text-text-subtle hover:text-red-500 shrink-0"
            onclick={() => askUnlink(item, direction)}
            size="icon-sm"
            title="Unlink"
            variant="ghost"
        >
            <Unlink class="size-3.5" />
        </Button>
    </div>
{/snippet}

<section class="panel rounded-xl">
    <div class="border-border flex flex-col items-start border-b px-4 py-3">
        <h2 class="eyebrow">Connections</h2>
        <span class="text-text-subtle text-[0.6875rem]">
            Derived from environment variables pointing at another service's
            slug
        </span>
    </div>

    {#if dependsOn.length === 0 && usedBy.length === 0}
        <p class="text-text-muted px-4 py-6 text-center text-xs">
            Nothing links to this service, and it references nothing else.
        </p>
    {:else}
        <div
            class="grid items-center gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]"
        >
            <div class="space-y-2">
                {#if dependsOn.length > 0}
                    <p class="text-text-subtle text-[0.6875rem] font-medium">
                        Needs
                    </p>
                    {#each dependsOn as item (item.id)}
                        {@render node(item, "dependsOn")}
                    {/each}
                {/if}
            </div>

            <ArrowRight
                class="text-text-subtle mx-auto size-4 {dependsOn.length === 0
                    ? 'invisible'
                    : ''} hidden md:block"
            />

            <div
                class="border-accent/50 bg-accent-light rounded-lg border px-3 py-2.5"
            >
                <p class="text-text truncate text-xs font-semibold">{name}</p>
                <p class="text-accent text-[0.6875rem]">this service</p>
            </div>

            <ArrowRight
                class="text-text-subtle mx-auto size-4 {usedBy.length === 0
                    ? 'invisible'
                    : ''} hidden md:block"
            />

            <div class="space-y-2">
                {#if usedBy.length > 0}
                    <p class="text-text-subtle text-[0.6875rem] font-medium">
                        Used by
                    </p>
                    {#each usedBy as item (item.id)}
                        {@render node(item, "usedBy")}
                    {/each}
                {/if}
            </div>
        </div>
    {/if}
</section>

<UnlinkDialog link={unlink} bind:open={unlinkOpen} />
