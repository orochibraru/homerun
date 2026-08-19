import { resolve } from "$app/paths";

export const navLinks: { href: string; label: string; requiresAuth?: true }[] =
	[
		{ href: resolve("/"), label: "Feed" },
		{ href: resolve("/dashboard"), label: "Dashboard", requiresAuth: true },
	];
