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
        stroke-width="2.8"
        d="M9.5 21Q12 12 25 8.5"
      />
    </mask>
    <path
      fill="currentColor"
      stroke="currentColor"
      stroke-linejoin="round"
      stroke-width="1.5"
      d="M4 10.5a1.5 1.5 0 0 1 1.5-1.5h19a1.5 1.5 0 0 1 1.5 1.5V19l-11 9.5L4 19Z"
      mask="url(#{maskId})"
    />
    <circle cx="27.5" cy="6" r="2.6" fill="currentColor" />
  </svg>
  <span
    class="text-text font-semibold tracking-tight {size === 'lg'
      ? 'text-lg'
      : 'text-[0.95rem]'}"
  >
    homerun
  </span>
</span>
