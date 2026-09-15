<script lang="ts">
	import {
		getPasswordStrength,
		getPasswordStrengthMeta,
	} from "$lib/formatting";

	interface Props {
		password: string;
	}

	const { password }: Props = $props();

	const strength = $derived(getPasswordStrength(password));
	const meta = $derived(getPasswordStrengthMeta(strength));
</script>

{#if password}
  <div class="mt-2.5">
    <div class="flex gap-1">
      {#each [1, 2, 3, 4] as level (level)}
        <div
          class="h-1 flex-1 rounded-full transition-all duration-300 {level
          <= strength
            ? meta.bar
            : 'bg-surface-3'}"
        >
        </div>
      {/each}
    </div>
    <p class="text-text-subtle mt-1.5 flex justify-between text-[0.65rem] tracking-wide uppercase">
      <span>{password.length} chars</span>
      <span class={meta.text}>{meta.label}</span>
    </p>
  </div>
{/if}
