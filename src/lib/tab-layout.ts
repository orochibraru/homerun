export const TAB_LAYOUTS = ["horizontal", "vertical"] as const;

export type TabLayout = (typeof TAB_LAYOUTS)[number];

export const TAB_LAYOUT_LABELS: Record<TabLayout, string> = {
	horizontal: "Above the page",
	vertical: "In a column beside the page",
};
