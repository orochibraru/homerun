<script lang="ts">
    import { CATEGORY_LABELS, CATEGORY_COLORS } from "$lib/constants";
    interface Props {
        category: string;
        size?: "sm" | "md";
    }

    const { category, size = "sm" }: Props = $props();

    const colorClass = $derived(
        CATEGORY_COLORS[category.toLowerCase()] ??
            "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
    );
    const sizeClass = $derived(
        size === "md" ? "px-3 py-1 text-xs" : "px-2.5 py-0.5 text-[0.7rem]",
    );
</script>

<span
    class="inline-flex items-center rounded-full font-medium capitalize {colorClass} {sizeClass}"
>
    {category}
</span>
