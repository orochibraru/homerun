<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import {
		Cpu,
		ExternalLink,
		FileText,
		Globe,
		HardDrive,
		Layers,
		LayoutGrid,
		Network,
		Settings,
		ShieldCheck,
		Terminal,
	} from "@lucide/svelte";
	import * as Select from "@orochibraru/ui/select";
	import { onDestroy, onMount } from "svelte";

	import CopyButton from "#lib/components/copy-button.svelte";
	import StatusBadge from "#lib/components/status-badge.svelte";
	import TabNav, { type NavTab } from "#lib/components/tab-nav.svelte";
	import TemplateIcon from "#lib/components/template-icon.svelte";
	import {
		DeployProgress,
		provideDeployProgress,
	} from "#lib/deploy-progress.svelte.js";
	import { timeAgo } from "#lib/formatting.js";
	import { syncServiceStatuses } from "#lib/remote/service-status.remote.js";
	import { primaryHostname } from "#lib/service-domains.js";
	import { hasIconImage } from "#lib/service-icon.js";
	import { internalUrl, maskUrlPassword } from "#lib/service-link.js";
	import type { ContainerStatus } from "#lib/types.js";
	import { currentHref, visibleIn } from "#lib/ui-mode.js";

	import ServiceActions from "./service-actions.svelte";

	const { data, children } = $props();

	const svc = $derived(data.service);

	const progress = provideDeployProgress(
		new DeployProgress({
			id: () => svc.id,
			name: () => svc.name,
		}),
	);

	onMount(() =>
		progress.resume(data.lastDeployment ?? undefined, svc.currentStatus),
	);

	onDestroy(() => progress.close());

	const overviewPath = $derived(
		resolve("/(protected)/services/[serviceId]", { serviceId: svc.id }),
	);

	const source = $derived(
		svc.image
			? { name: svc.image, version: svc.tag }
			: {
					name:
						svc.gitRepo ??
						(svc.gitUrl ?? "")
							.replace(/^https?:\/\//, "")
							.replace(/\.git$/, ""),
					version: svc.gitRef ?? "main",
				},
	);
	const synced = $derived(
		syncServiceStatuses(svc.containerId || svc.swarmServiceId ? [svc.id] : []),
	);
	const liveStatus = $derived(
		synced.current?.find((row) => row.id === svc.id)?.status ??
			svc.currentStatus,
	);
	const publicDomains = $derived.by(() => {
		const main = svc.dnsResolvable
			? primaryHostname(svc, data.stackSlug, data.serviceDomain)
			: null;
		return main ? [main] : [];
	});

	const DEPLOY_OUTCOME: Record<ContainerStatus, string> = {
		failed: "failed",
		missing: "lost its container",
		pending: "in progress",
		pulling: "in progress",
		running: "succeeded",
		starting: "in progress",
		stopped: "succeeded",
	};

	const compact = new Intl.NumberFormat(undefined, { notation: "compact" });

	const observabilitySummary = $derived.by(() => {
		const parts = [
			`${compact.format(data.traffic.requests)} requests`,
			`${compact.format(data.traffic.status5xx)} 5xx`,
		];
		if (data.traffic.avgResponseMs !== null) {
			parts.push(`${Math.round(data.traffic.avgResponseMs)} ms avg`);
		}
		const line = `${parts.join(" · ")} (24h)`;
		return data.openErrors > 0
			? `${data.openErrors} open ${data.openErrors === 1 ? "error" : "errors"} · ${line}`
			: line;
	});

	const securitySummary = $derived.by(() => {
		const scan = data.latestScan;
		if (!scan) {
			return "Never scanned";
		}
		if (scan.status !== "ok") {
			return `Last scan ${scan.status} · ${timeAgo(scan.at)}`;
		}
		const { critical, high, medium } = scan.counts;
		return critical + high + medium === 0
			? `No critical, high or medium findings · ${timeAgo(scan.at)}`
			: `${critical} critical · ${high} high · ${medium} medium · ${timeAgo(scan.at)}`;
	});

	interface RouteTab extends NavTab {
		exact: boolean;
		href: string;
		link?: string;
	}

	const tabs = $derived<RouteTab[]>([
		{
			exact: true,
			href: resolve("/(protected)/services/[serviceId]", { serviceId: svc.id }),
			description: "Status, live resources and recent activity",
			icon: LayoutGrid,
			id: "overview",
			label: "Overview",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/environments", {
				serviceId: svc.id,
			}),
			description: "Source, variables, revisions, previews and channels",
			hasWarning: data.lastDeployment?.status === "failed",
			icon: Layers,
			id: "environments",
			label: "Environments & Revisions",
			summary: data.lastDeployment
				? `Last deploy ${DEPLOY_OUTCOME[data.lastDeployment.status]} · ${timeAgo(data.lastDeployment.at)}`
				: "Never deployed",
			link: visibleIn(data.uiMode, "service/environments/environments")
				? undefined
				: resolve("/(protected)/services/[serviceId]/environments/source", {
						serviceId: svc.id,
					}),
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/observability", {
				serviceId: svc.id,
			}),
			description: "Logs, health, uptime, traces and errors",
			hasWarning: data.openErrors > 0,
			icon: FileText,
			id: "observability",
			label: "Observability",
			summary: observabilitySummary,
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/volumes", {
				serviceId: svc.id,
			}),
			description: "Volumes mounted into the container",
			icon: HardDrive,
			id: "volumes",
			label: "Storage",
			summary:
				data.mountCount > 0
					? `${data.mountCount} ${data.mountCount === 1 ? "volume" : "volumes"} mounted`
					: "No volumes mounted",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/networking", {
				serviceId: svc.id,
			}),
			description: "Domains, ports, TLS and routing",
			icon: Network,
			id: "networking",
			label: "Networking",
			summary: publicDomains[0] ?? "Not publicly routed",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/container", {
				serviceId: svc.id,
			}),
			description: "Resources, replicas, command and health check",
			icon: Cpu,
			id: "container",
			label: "Container",
			summary: [
				`${svc.replicas} ${svc.replicas === 1 ? "replica" : "replicas"}`,
				svc.cpuLimit ? `${svc.cpuLimit} CPU` : "no CPU limit",
				svc.memoryLimitMb ? `${svc.memoryLimitMb} MB` : "no memory limit",
			].join(" · "),
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/security", {
				serviceId: svc.id,
			}),
			description: "Image vulnerability scans and blocked paths",
			hasWarning:
				data.latestScan?.status === "failed" ||
				(data.latestScan?.counts.critical ?? 0) > 0,
			icon: ShieldCheck,
			id: "security",
			label: "Security",
			summary: securitySummary,
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/terminal", {
				serviceId: svc.id,
			}),
			description: "A shell inside the running container",
			icon: Terminal,
			id: "terminal",
			label: "Terminal",
			summary:
				svc.containerId || svc.swarmServiceId
					? undefined
					: "No container running",
		},
		{
			exact: false,
			href: resolve("/(protected)/services/[serviceId]/settings", {
				serviceId: svc.id,
			}),
			description: "Name, stack, auto-redeploy, rollback and danger zone",
			icon: Settings,
			id: "settings",
			label: "Settings",
		},
	]);

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
		tabs
			.filter(
				(tab) =>
					tab.href === currentTab ||
					visibleIn(data.uiMode, `service/${tab.id}`),
			)
			.map((tab) => ({ ...tab, href: tab.link ?? tab.href })),
	);
</script>

<div class="p-5 md:p-6">
	<div class="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
		<span
			class="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[1.125rem] text-[1.375rem] font-extrabold text-white shadow-[0_8px_20px_-10px_var(--primary)]"
			style="background: var(--tile-a)"
		>
			{#if hasIconImage(svc.icon)}
				<TemplateIcon
					category={svc.category}
					class="size-10 rounded-xl bg-white/90"
					icon={svc.icon}
				/>
			{:else}
				{svc.name.charAt(0).toUpperCase()}
			{/if}
		</span>
		<div class="min-w-48 flex-1">
			<div class="flex flex-wrap items-center gap-2.5">
				<h1
					class="text-text text-[1.75rem] leading-[1.1] font-semibold tracking-[-0.035em]"
				>
					{svc.name}
				</h1>
				<StatusBadge status={liveStatus} />
				{#if data.environments.length > 0}
					<Select.Root
						onValueChange={(id) =>
							void goto(
								page.url.pathname.replace(
									`/services/${svc.id}`,
									`/services/${id}`,
								),
							)}
						type="single"
						value={svc.id}
					>
						<Select.Trigger
							class="text-text-muted h-7.5! rounded-full! py-0 pr-2.5 pl-3 text-[0.78rem] font-semibold capitalize"
							aria-label="Environment"
						>
							<span class="inline-flex items-center gap-1.5">
								<Layers class="size-3.5" />
								{data.environments.find((env) => env.id === svc.id)?.name ??
									"production"}
							</span>
						</Select.Trigger>
						<Select.Content>
							{#each data.environments as env (env.id)}
								<Select.Item
									class="capitalize"
									label={env.name}
									value={env.id}
								/>
							{/each}
						</Select.Content>
					</Select.Root>
				{/if}
			</div>
			<p
				class="text-text-muted mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[0.78rem]"
			>
				<span
					class="inline-flex min-w-0 items-center gap-1.5 font-mono break-all"
				>
					<span>{source.name}</span>
					{#if source.version}
						<span
							class="bg-surface-2 text-text rounded-full px-1.75 py-0.5 font-semibold"
							>{source.version}</span
						>
					{/if}
				</span>
				{#each publicDomains as domain (domain)}
					<a
						class="text-accent inline-flex items-center gap-1.25 font-semibold hover:underline"
						href="{data.publicScheme}://{domain}"
						rel="noopener noreferrer"
						target="_blank"
					>
						<Globe class="size-3.25" />
						{domain}
						<ExternalLink class="size-3" />
					</a>
				{:else}
					<span class="text-text-subtle">not publicly routed</span>
				{/each}
				{#if svc.containerId || svc.swarmServiceId}
					{@const internal = internalUrl({
						command: svc.command,
						containerPort: svc.containerPort,
						envVars: svc.envVars ?? {},
						image: svc.image,
						name: svc.name,
						slug: svc.slug,
					})}
					<span
						class="inline-flex items-center gap-0.5"
						title="Internal address, reachable from the service's networks"
					>
						<span class="font-mono"
							>{maskUrlPassword(internal).replace(/^http:\/\//, "")}</span
						>
						<CopyButton class="p-0.5" label="internal URL" value={internal} />
					</span>
				{/if}
				{#if data.openErrors > 0}
					<a
						class="font-semibold text-red-600 hover:underline dark:text-red-400"
						href={resolve(
							"/(protected)/services/[serviceId]/observability/errors",
							{
								serviceId: svc.id,
							},
						)}
					>
						{data.openErrors} open {data.openErrors === 1 ? "error" : "errors"}
					</a>
				{/if}
				{#if data.lastDeployedAt}
					<span title={new Date(data.lastDeployedAt).toLocaleString()}>
						Deployed {timeAgo(data.lastDeployedAt)}{data.deployedBy
							? ` by ${data.deployedBy}`
							: ""}
					</span>
				{/if}
			</p>
		</div>
		<ServiceActions
			actionPath={overviewPath}
			canRollBack={data.canRollBack}
			{progress}
			service={svc}
		/>
	</div>

	<TabNav active={activeTabId} tabs={shownTabs}>
		{@render children()}
	</TabNav>
</div>
