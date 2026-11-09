<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import {
		Ban,
		Container,
		Globe,
		Lock,
		Mail,
		MoveRight,
		Network,
		TriangleAlert,
	} from "@lucide/svelte";
	import { onMount } from "svelte";

	import TabNav, { type NavTab } from "#lib/components/tab-nav.svelte";
	import { getSetupStatus } from "#lib/remote/setup.remote.js";
	import { title } from "#lib/store/title.js";
	import { currentHref, visibleIn } from "#lib/ui-mode.js";

	const { data, children } = $props();

	const setup = getSetupStatus();
	const issuesByField = $derived(setup.current?.issuesByField ?? {});

	const highlighted = $derived(
		new Set(
			(page.url.searchParams.get("highlight") ?? "").split(",").filter(Boolean),
		),
	);

	onMount(() => {
		title.set("Settings");
		const [first] = highlighted;
		if (first) {
			document
				.getElementById(first)
				?.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	});

	const FIELD_TAB: Record<string, string> = {
		authCheckUrl: "general",
		authCrossSubdomainCookies: "general",
		baseDomain: "general",
		dockerNetworkName: "docker",
		dockerSocketPath: "docker",
		smtpFrom: "email",
		smtpHost: "email",
		smtpPassword: "email",
		smtpPort: "email",
		smtpUser: "email",
		traefikDynamicConfigDir: "networking",
	};

	interface RouteTab extends NavTab {
		exact: boolean;
		href: string;
	}

	const effective = $derived({
		baseDomain: data.settings.baseDomain ?? data.envDefaults.baseDomain,
		dockerNetworkName:
			data.settings.dockerNetworkName ?? data.envDefaults.dockerNetworkName,
		smtpEnabled: data.settings.smtpEnabled ?? data.envDefaults.smtpEnabled,
		smtpHost: data.settings.smtpHost ?? data.envDefaults.smtpHost,
		traefikEntrypoint:
			data.settings.traefikEntrypoint ?? data.envDefaults.traefikEntrypoint,
	});

	const tabs = $derived<RouteTab[]>(
		[
			{
				description: "Base domain, interface mode, resource limits and updates",
				exact: true,
				href: resolve("settings"),
				icon: Globe,
				id: "general",
				label: "General",
				summary: effective.baseDomain || "No base domain set",
			},
			{
				exact: false,
				description: "Daemon, network, orchestration and image scanning",
				href: resolve("settings/docker"),
				icon: Container,
				id: "docker",
				label: "Docker",
				summary: `${data.settings.orchestrationMode === "swarm" ? "Swarm" : "Standalone"} · ${effective.dockerNetworkName}`,
			},
			{
				exact: false,
				description: "Traefik's entrypoint, cert resolver and ACME email",
				href: resolve("settings/networking"),
				icon: Network,
				id: "networking",
				label: "Networking",
				summary: `Entrypoint ${effective.traefikEntrypoint}`,
			},
			{
				exact: false,
				description: "A certificate of your own for the whole instance",
				href: resolve("settings/tls"),
				icon: Lock,
				id: "tls",
				label: "TLS",
			},
			{
				exact: false,
				description: "What visitors see when a service is down or missing",
				href: resolve("settings/error-pages"),
				icon: TriangleAlert,
				id: "error-pages",
				label: "Error pages",
			},
			{
				exact: false,
				description: "Banning abusive clients, and CrowdSec",
				href: resolve("settings/ip-bans"),
				icon: Ban,
				id: "ip-bans",
				label: "IP bans",
			},
			{
				exact: false,
				description: "The SMTP server Homerun sends its email through",
				href: resolve("settings/email"),
				icon: Mail,
				id: "email",
				label: "Email",
				summary:
					effective.smtpEnabled && effective.smtpHost
						? effective.smtpHost
						: "Not sending email",
			},
			{
				exact: false,
				description: "Bring projects over from another PaaS",
				href: resolve("settings/migrate"),
				icon: MoveRight,
				id: "migrate",
				label: "Migrate",
			},
		].map((tab) => ({
			...tab,
			hasWarning: Object.keys(issuesByField).some(
				(field) => FIELD_TAB[field] === tab.id,
			),
		})),
	);

	function isActive(href: string, exact: boolean): boolean {
		if (exact) {
			return page.url.pathname === href;
		}
		return page.url.pathname.startsWith(href);
	}

	const activeTabId = $derived(
		tabs.find((tab) => isActive(tab.href, tab.exact))?.id ?? "",
	);

	const currentTab = $derived(
		currentHref(
			page.url.pathname,
			tabs.map((tab) => tab.href),
		),
	);

	const shownTabs = $derived(
		tabs.filter(
			(tab) =>
				tab.hasWarning ||
				tab.href === currentTab ||
				visibleIn(data.uiMode, `settings/${tab.id}`),
		),
	);
</script>

<div class="p-5 md:p-6">
	<div class="mb-8">
		<h1 class="text-text text-lg font-semibold tracking-tight max-md:hidden">
			Settings
		</h1>
		<p class="text-text-muted mt-1 text-sm">
			Instance-wide configuration : stored in the database and applied live, no
			restart needed. Leave a field blank to fall back to its env-var default
			(shown as the placeholder); env vars still work for anyone bootstrapping
			via docker-compose before ever visiting this page.
		</p>
	</div>

	<TabNav active={activeTabId} tabs={shownTabs}>
		{@render children()}
	</TabNav>
</div>
