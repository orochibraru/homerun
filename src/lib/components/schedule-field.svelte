<script lang="ts">
	import { untrack } from "svelte";
	import { labelClass } from "$lib/components/form-styles";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import {
		describeSchedule,
		type ScheduleMode,
		scheduleFromCron,
		scheduleToCron,
		WEEKDAYS,
	} from "$lib/schedule";

	interface Props {
		id: string;
		label?: string;
		name: string;
		value: string | null;
	}

	const { id, label = "Schedule", name, value }: Props = $props();

	let schedule = $state(untrack(() => scheduleFromCron(value)));

	const MODES: { label: string; value: ScheduleMode }[] = [
		{ label: "Every hour", value: "hourly" },
		{ label: "Every day", value: "daily" },
		{ label: "Every week", value: "weekly" },
		{ label: "Every month", value: "monthly" },
		{ label: "Custom (cron)", value: "custom" },
	];

	const cron = $derived(scheduleToCron(schedule));
</script>

<div>
  <label class={labelClass} for={id}>{label}</label>
  <input {name} type="hidden" value={cron}>
  <div class="flex flex-wrap items-center gap-2">
    <SelectRoot type="single" bind:value={schedule.mode}>
      <SelectTrigger class="w-44" {id}>
        {MODES.find((m) => m.value === schedule.mode)?.label}
      </SelectTrigger>
      <SelectContent>
        {#each MODES as mode (mode.value)}
          <SelectItem label={mode.label} value={mode.value} />
        {/each}
      </SelectContent>
    </SelectRoot>

    {#if schedule.mode === "hourly"}
      <span class="text-text-muted text-sm">at minute</span>
      <Input
        class="w-20"
        aria-label="Minute past the hour"
        max="59"
        min="0"
        type="number"
        bind:value={schedule.minute}
      />
    {:else if schedule.mode === "custom"}
      <Input
        class="w-56 font-mono"
        aria-label="Cron expression"
        placeholder="0 3 * * *"
        spellcheck="false"
        type="text"
        bind:value={schedule.custom}
      />
    {:else}
      {#if schedule.mode === "weekly"}
        <span class="text-text-muted text-sm">on</span>
        <SelectRoot
          type="single"
          bind:value={
            () => String(schedule.weekday),
            (v) => {
              schedule.weekday = Number(v);
            }
          }
        >
          <SelectTrigger class="w-36" aria-label="Day of the week">
            {WEEKDAYS[schedule.weekday]}
          </SelectTrigger>
          <SelectContent>
            {#each WEEKDAYS as day, index (day)}
              <SelectItem label={day} value={String(index)} />
            {/each}
          </SelectContent>
        </SelectRoot>
      {:else if schedule.mode === "monthly"}
        <span class="text-text-muted text-sm">on day</span>
        <Input
          class="w-20"
          aria-label="Day of the month"
          max="31"
          min="1"
          type="number"
          bind:value={schedule.dayOfMonth}
        />
      {/if}
      <span class="text-text-muted text-sm">at</span>
      <Input
        class="w-32"
        aria-label="Time of day"
        required
        type="time"
        bind:value={schedule.time}
      />
    {/if}
  </div>
  <p class="text-text-subtle mt-1.5 text-xs">
    {describeSchedule(schedule)}, server time.
    {#if schedule.mode === "custom"}
      Five fields: minute hour day month weekday.
    {/if}
  </p>
</div>
