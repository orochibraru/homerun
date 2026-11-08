<script lang="ts">
	import { CircleAlert, CircleCheck, CircleX } from "@lucide/svelte";

	import type { MailCheck } from "#lib/mail-doveadm.js";

	interface Props {
		checks: MailCheck[];
	}

	const { checks }: Props = $props();
</script>

<ul class="divide-border divide-y">
	{#each checks as check (check.id)}
		<li class="flex items-start gap-3 px-5 py-3">
			{#if check.state === "ok"}
				<CircleCheck class="mt-0.5 size-4 shrink-0 text-emerald-500" />
			{:else if check.state === "warn"}
				<CircleAlert class="mt-0.5 size-4 shrink-0 text-amber-500" />
			{:else}
				<CircleX class="mt-0.5 size-4 shrink-0 text-red-500" />
			{/if}
			<div class="min-w-0">
				<p class="text-text text-sm font-medium">{check.label}</p>
				<p class="text-text-muted text-xs wrap-break-word">{check.detail}</p>
			</div>
		</li>
	{/each}
</ul>
