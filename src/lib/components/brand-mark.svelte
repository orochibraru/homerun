<script lang="ts">
	interface Props {
		class?: string;
		size?: "lg" | "sm";
	}

	let { size = "sm", class: className = "" }: Props = $props();
	const maskId = $props.id();
</script>

<span class="inline-flex items-center gap-2 {className}">
  <svg
    class="text-accent shrink-0 {size === 'lg' ? 'size-6' : 'size-5'}"
    aria-hidden="true"
    viewBox="0 0 32 32"
  >
    <mask id={maskId}>
      <rect width="32" height="32" fill="#fff" />
      <path
        fill="none"
        stroke="#000"
        stroke-linecap="round"
        stroke-width="2.6"
        d="M9 24.5Q12 12 25 8"
      />
    </mask>
    <path
      fill="currentColor"
      stroke="currentColor"
      stroke-linejoin="round"
      stroke-width="1.5"
      d="M16 3.5 28 13.5V26a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V13.5Z"
      mask="url(#{maskId})"
    />
    <circle cx="27" cy="5" r="2.6" fill="currentColor" />
  </svg>
  <span
    class="text-text font-semibold tracking-tight {size === 'lg'
      ? 'text-lg'
      : 'text-[0.95rem]'}"
  >
    homerun
  </span>
</span>
