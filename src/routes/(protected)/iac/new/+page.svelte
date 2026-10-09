<script lang="ts">
	import { ArrowLeft, FileCode2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import IacScopePicker from "#lib/components/iac-scope-picker.svelte";
	import IacToolPicker from "#lib/components/iac-tool-picker.svelte";
	import ObjectStoreSelect from "#lib/components/object-store-select.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import type { IacTool } from "#lib/iac/tools.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	const { data } = $props();

	onMount(() => title.set("New IaC project"));

	let tool = $state<IacTool>("terraform");
	let scope = $state("");
	let name = $state("");
	let nameEdited = $state(false);
	let storeId = $derived(data.stores[0]?.id ?? "");
	let creating = $state(false);

	const scopeName = $derived(
		data.scopes.find((option) => option.value === scope)?.name ?? "",
	);
	const shownName = $derived(nameEdited ? name : scopeName);
</script>

<div class="p-5 md:p-6">
  <div class="space-y-5">
    <a
      class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm"
      href={resolve("iac")}
    >
      <ArrowLeft class="size-4" />
      All IaC projects
    </a>

    <section class="panel rounded-md">
      <PanelHeader
        description="A project picks a tool, keeps its state in a bucket you choose (created if it doesn't exist) and covers a stack or a service."
        icon={FileCode2}
        title="New IaC project"
      >
        {#snippet trailing()}
          <SaveButton
            disabled={data.stores.length === 0}
            form="new-iac-project"
            label="Create"
            pending={creating}
          />
        {/snippet}
      </PanelHeader>
      {#if data.stores.length === 0}
        <p class="text-text-muted px-5 py-4 text-sm">
          <a class="text-accent hover:underline" href={resolve("object-storage/built-in")}>Turn on the built-in store or connect one</a>
          first: the state lives in one of its buckets.
        </p>
      {:else}
        <form
          id="new-iac-project"
          class="space-y-5 px-5 py-4"
          action="?/create"
          method="POST"
          use:enhance={enhanceToast({
            error: "Couldn't create the project.",
            loading: "Creating the project",
            onSettled: () => {
              creating = false;
            },
            onStart: () => {
              creating = true;
            },
            onSuccess: (result) => {
              if (typeof result?.projectId === "string") {
                void goto(
                  resolve("/(protected)/iac/[projectId]", {
                    projectId: result.projectId,
                  }),
                );
              }
            },
            success: "Project created.",
          })}
        >
          <div>
            <p class={labelClass}>Tool</p>
            <IacToolPicker name="tool" bind:value={tool} />
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class={labelClass} for="iac-scope">What it manages</label>
              <IacScopePicker
                id="iac-scope"
                allowNone
                name="scope"
                scopes={data.scopes}
                bind:value={scope}
              />
            </div>
            <div>
              <label class={labelClass} for="iac-name">Name</label>
              <input
                id="iac-name"
                class={inputClass}
                autocomplete="off"
                name="name"
                oninput={(event) => {
                  name = event.currentTarget.value;
                  nameEdited = true;
                }}
                placeholder="homelab"
                required
                value={shownName}
              >
            </div>
            <div>
              <label class={labelClass} for="iac-store">Store</label>
              <ObjectStoreSelect
                id="iac-store"
                name="storeId"
                stores={data.stores}
                bind:value={storeId}
              />
            </div>
            <div>
              <label class={labelClass} for="iac-bucket">Bucket</label>
              <input
                id="iac-bucket"
                class={inputClass}
                autocomplete="off"
                name="bucket"
                placeholder={tool === "pulumi" ? "pulumi-state" : "tfstate"}
                required
              >
            </div>
            <div>
              <label class={labelClass} for="iac-prefix">Folder in the bucket</label>
              <input
                id="iac-prefix"
                class={inputClass}
                autocomplete="off"
                name="prefix"
                placeholder="Optional, e.g. iac"
              >
            </div>
          </div>
        </form>
      {/if}
    </section>
  </div>
</div>
