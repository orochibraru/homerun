<script lang="ts">
	import { untrack } from "svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "#lib/components/ui/select/index.js";
	import { DNS_RECORD_TYPES } from "#lib/services/dns-providers/types.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	interface Props {
		domainName: string;
		onDone: () => void;
		record: {
			content: string;
			id: string;
			priority: number | null;
			ttl: number | null;
			type: string;
		} | null;
		shortName: string;
	}

	const { domainName, onDone, record, shortName }: Props = $props();

	let type = $state(untrack(() => record?.type ?? "A"));
</script>

<form
  action="?/saveRecord"
  class="border-border grid gap-3 border-b p-5 sm:grid-cols-[1fr_8rem_2fr_6rem_6rem_auto] sm:items-end"
  method="POST"
  use:enhance={enhanceToast({
    error: "Couldn't save the record.",
    loading: "Saving the record",
    onSuccess: onDone,
    success: "Record saved.",
  })}
>
  <input name="recordId" type="hidden" value={record?.id ?? ""}>
  <div>
    <label class={labelClass} for="record-name">Name</label>
    <input class="{inputClass} font-mono text-xs" id="record-name" name="name" placeholder="@ or app" value={shortName}>
    <p class="text-text-subtle mt-1 truncate text-[0.6875rem]">.{domainName}</p>
  </div>
  <div>
    <p class={labelClass}>Type</p>
    <SelectRoot name="type" type="single" bind:value={type}>
      <SelectTrigger aria-label="Type">{type}</SelectTrigger>
      <SelectContent>
        {#each DNS_RECORD_TYPES as option (option)}
          <SelectItem label={option} value={option} />
        {/each}
      </SelectContent>
    </SelectRoot>
  </div>
  <div>
    <label class={labelClass} for="record-content">Value</label>
    <input class="{inputClass} font-mono text-xs" id="record-content" name="content" placeholder={type === "A" ? "203.0.113.10" : type === "CNAME" ? "target.example.com" : ""} required value={record?.content ?? ""}>
  </div>
  <div>
    <label class={labelClass} for="record-ttl">TTL</label>
    <input class={inputClass} id="record-ttl" min="60" name="ttl" placeholder="auto" type="number" value={record?.ttl ?? ""}>
  </div>
  <div>
    {#if type === "MX"}
      <label class={labelClass} for="record-priority">Priority</label>
      <input class={inputClass} id="record-priority" min="0" name="priority" placeholder="10" type="number" value={record?.priority ?? ""}>
    {/if}
  </div>
  <div class="flex gap-2">
    <Button onclick={onDone} type="button" variant="ghost">Cancel</Button>
    <Button type="submit">{record ? "Save" : "Add"}</Button>
  </div>
</form>
