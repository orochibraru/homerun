import {
	Activity,
	Clock,
	Container,
	Database,
	FolderKanban,
	GitBranch,
	HardDrive,
	KeyRound,
	LayoutGrid,
	Network,
	Send,
	Server,
	User,
} from "@lucide/svelte";
import type { Component } from "svelte";

import type { SearchResultKind } from "#lib/search.js";

export const SEARCH_KIND_ICONS: Record<SearchResultKind, Component> = {
	authProvider: KeyRound,
	buildCacheRegistry: Container,
	cronJob: Clock,
	gitProvider: GitBranch,
	notificationChannel: Send,
	stack: FolderKanban,
	remoteHost: Network,
	s3Destination: Database,
	service: Server,
	statusPage: Activity,
	storageVolume: HardDrive,
	template: LayoutGrid,
	user: User,
};
