// Shared client-safe types. $lib/services/docker/containers.ts imports
// dockerode/node:crypto and can't be imported from client-reachable code
// (SvelteKit blocks it) — so status-adjacent types that both server logic
// and UI components need live here instead.
export type ContainerStatus =
	| "pending"
	| "pulling"
	| "starting"
	| "running"
	| "stopped"
	| "failed";
