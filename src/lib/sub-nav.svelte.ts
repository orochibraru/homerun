import { getContext, setContext } from "svelte";
import type { NavTab } from "#lib/components/tab-nav.svelte";

export interface SubNavEntry {
	active: string;
	onSelect?: (id: string) => void;
	owner: object;
	tabs: NavTab[];
}

/** The page's tabs, when the account shows them as a column beside the sidebar instead of above the page. */
export class SubNav {
	current = $state<SubNavEntry | null>(null);
}

const KEY = Symbol("sub-nav");

/** Creates the sub-navigation slot the protected layout renders beside its sidebar, for the pages below it. */
export function provideSubNav(): SubNav {
	return setContext(KEY, new SubNav());
}

/** The sub-navigation slot of the enclosing protected layout, if there is one. */
export function useSubNav(): SubNav | undefined {
	return getContext<SubNav | undefined>(KEY);
}
