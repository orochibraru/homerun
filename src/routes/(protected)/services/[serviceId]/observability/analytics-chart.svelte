<script lang="ts">
	interface Point {
		at: Date;
		value: number | null;
	}

	interface Props {
		bucketSeconds: number;
		format: (value: number) => string;
		kind?: "bar" | "line";
		points: Point[];
		title: string;
		empty?: string;
	}

	const {
		bucketSeconds,
		format,
		kind = "line",
		points,
		title,
		empty = "Nothing recorded in this range yet.",
	}: Props = $props();

	let hovered = $state<number | null>(null);

	const values = $derived(points.map((point) => point.value ?? 0));
	const peak = $derived(Math.max(...values, 0) || 1);
	const average = $derived(
		values.length
			? values.reduce((sum, value) => sum + value, 0) / values.length
			: 0,
	);

	function x(index: number): number {
		return points.length <= 1 ? 50 : (index / (points.length - 1)) * 100;
	}

	function y(value: number): number {
		return 40 - (value / peak) * 36;
	}

	const line = $derived(
		points
			.map((point, index) =>
				point.value === null
					? null
					: `${x(index).toFixed(2)},${y(point.value).toFixed(2)}`,
			)
			.filter(Boolean)
			.join(" "),
	);

	function when(at: Date): string {
		const options: Intl.DateTimeFormatOptions =
			bucketSeconds >= 86_400
				? { day: "numeric", month: "short" }
				: {
						day: "numeric",
						hour: "2-digit",
						minute: "2-digit",
						month: "short",
					};
		return new Date(at).toLocaleString(undefined, options);
	}

	const shown = $derived(hovered === null ? null : points[hovered]);
</script>

<section class="panel rounded-md p-4">
  <div class="mb-3 flex items-baseline justify-between gap-2">
    <h3 class="text-text text-sm font-medium">{title}</h3>
    <span class="text-text-subtle text-xs tabular-nums">
      {#if shown}
        {when(shown.at)} · {shown.value === null ? "—" : format(shown.value)}
      {:else if points.length}
        peak {format(peak)} · avg {format(average)}
      {/if}
    </span>
  </div>
  {#if points.length === 0}
    <p class="text-text-subtle flex h-28 items-center justify-center text-xs">
      {empty}
    </p>
  {:else}
    <svg
      aria-label={title}
      class="text-accent h-28 w-full overflow-visible"
      onmouseleave={() => (hovered = null)}
      preserveAspectRatio="none"
      role="img"
      viewBox="0 0 100 40"
    >
      {#if kind === "bar"}
        {#each points as point, index (point.at)}
          {@const width = Math.max(100 / points.length - 0.6, 0.4)}
          <rect
            class="transition-opacity"
            fill="currentColor"
            height={40 - y(point.value ?? 0)}
            onmouseenter={() => (hovered = index)}
            opacity={hovered === null || hovered === index ? 0.85 : 0.35}
            role="presentation"
            rx="0.4"
            width={width}
            x={(index / points.length) * 100 + 0.3}
            y={y(point.value ?? 0)}
          />
        {/each}
      {:else}
        <polyline
          fill="none"
          points={line}
          stroke="currentColor"
          stroke-linejoin="round"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
        />
        {#each points as point, index (point.at)}
          <rect
            fill="transparent"
            height="40"
            onmouseenter={() => (hovered = index)}
            role="presentation"
            width={100 / points.length}
            x={(index / points.length) * 100}
            y="0"
          />
        {/each}
        {#if shown && shown.value !== null && hovered !== null}
          <line
            stroke="currentColor"
            stroke-opacity="0.3"
            vector-effect="non-scaling-stroke"
            x1={x(hovered)}
            x2={x(hovered)}
            y1="0"
            y2="40"
          />
        {/if}
      {/if}
    </svg>
    <div class="text-text-subtle mt-1 flex justify-between text-[0.6875rem]">
      <span>{when(points[0]?.at ?? new Date())}</span>
      <span>{when(points.at(-1)?.at ?? new Date())}</span>
    </div>
  {/if}
</section>
