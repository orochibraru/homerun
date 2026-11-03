<script lang="ts">
	import { enhance } from "$app/forms";
	import { refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import {
		ArrowRight,
		ArrowUp,
		Bell,
		Bug,
		CircleCheck,
		Gauge,
		RotateCcw,
		TriangleAlert,
		Unplug,
	} from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import type { Component } from "svelte";
	import { toast } from "svelte-sonner";

	import type { ActivityAlert } from "#lib/activity.js";
	import Skeleton from "#lib/components/skeleton.svelte";
	import { timeAgo } from "#lib/formatting.js";
	import {
		trialAttempts,
		type UpdateTrialStatus,
	} from "#lib/image-versions.js";
	import { can, type Permissions } from "#lib/permissions.js";
	import {
		getSetupStatus,
		reapplyTraefikConfig,
	} from "#lib/remote/setup.remote.js";
	import { enhanceToast, toastError } from "#lib/toast.js";

	interface Update {
		currentTag: string;
		foundAt: string;
		serviceId: string;
		serviceName: string;
		tag: string;
		trialAttempts: number | null;
		trialStatus: UpdateTrialStatus | null;
	}

	interface UptimeFailure {
		detail: string | null;
		kind: string;
		serviceId: string;
		serviceName: string;
		target: string | null;
	}

	interface Props {
		/** Open error issues and error logs from the live feed, unset until its first snapshot. */
		alerts: ActivityAlert[] | undefined;
		/** Resources past their hard limit, unset while it loads. */
		overCapacity: string[] | undefined;
		permissions: Permissions;
		/** Whether the viewer can open Settings. */
		readsSettings: boolean;
		/** Services with a newer image found, unset while it loads. */
		updates: Update[] | undefined;
		/** Failing uptime probes, unset while it loads. */
		uptimeDown: UptimeFailure[] | undefined;
	}

	const {
		alerts,
		overCapacity,
		permissions,
		readsSettings,
		updates,
		uptimeDown,
	}: Props = $props();

	type Tone = "danger" | "info" | "warn";
	type Action =
		| { kind: "apply" | "retry"; update: Update }
		| { href: string; kind: "link" }
		| { kind: "none" }
		| { kind: "reapply" };

	interface Item {
		action: Action;
		detail: string;
		icon: Component<{ class?: string }>;
		id: string;
		title: string;
		tone: Tone;
	}

	const VISIBLE = 4;
	const TONES: Record<Tone, string> = {
		danger: "bg-red-500/12 text-red-600 dark:bg-red-500/18 dark:text-red-400",
		info: "bg-blue-500/12 text-blue-600 dark:bg-blue-500/18 dark:text-blue-400",
		warn: "bg-amber-500/15 text-amber-700 dark:bg-amber-500/18 dark:text-amber-400",
	};

	const setup = getSetupStatus();
	const canWriteServices = $derived(can(permissions, "services", "write"));
	const canWriteSettings = $derived(can(permissions, "settings", "write"));
	const servicesHref = resolve("services");
	const settingsHref = resolve("settings");

	let expanded = $state(false);
	let busy = $state<string | null>(null);

	/** Where an alert leads: the issue's page, or the service's application errors for a logged line. */
	function alertHref(alert: ActivityAlert): string {
		const base = `${servicesHref}/${alert.serviceId}/observability/errors`;
		return alert.kind === "issue"
			? `${base}/${alert.id}`
			: `${base}/app-errors`;
	}

	/** An update's Source page, where its retry and apply actions live. */
	function sourceHref(update: Update): string {
		return resolve("/(protected)/services/[serviceId]/environments/source", {
			serviceId: update.serviceId,
		});
	}

	/** What an available update's trial says, in one line. */
	function updateDetail(update: Update): string {
		if (update.trialStatus === "running") {
			return `Trying it now, :${update.currentTag} is still serving.`;
		}
		if (update.trialStatus === "passed") {
			return "Its trial passed, ready to roll out.";
		}
		return `Found ${timeAgo(update.foundAt)}, currently on :${update.currentTag}.`;
	}

	const setupItems = $derived(
		(setup.current?.checks ?? [])
			.filter((check) => check.severity !== "ok")
			.map((check): Item => {
				const fields = setup.current?.fieldsByCheck[check.id] ?? [];
				return {
					action:
						check.action === "reapply-traefik" && canWriteSettings
							? { kind: "reapply" }
							: readsSettings && fields.length > 0
								? {
										href: `${settingsHref}?highlight=${fields.join(",")}`,
										kind: "link",
									}
								: { kind: "none" },
					detail: check.detail,
					icon: check.action === "reapply-traefik" ? Unplug : TriangleAlert,
					id: `setup:${check.id}`,
					title: check.label,
					tone: check.severity === "danger" ? "danger" : "warn",
				};
			}),
	);

	const items = $derived.by(() => {
		const failedTrials = (updates ?? []).filter(
			(update) => update.trialStatus === "failed",
		);
		const ready = (updates ?? []).filter(
			(update) => update.trialStatus !== "failed",
		);
		const down = uptimeDown ?? [];
		const list: Item[] = [
			...setupItems.filter((item) => item.tone === "danger"),
			...(overCapacity?.length
				? [
						{
							action: readsSettings
								? { href: settingsHref, kind: "link" as const }
								: { kind: "none" as const },
							detail: `${overCapacity.join(", ")}. New services are refused until usage drops back.`,
							icon: Gauge,
							id: "capacity",
							title: "Server past its hard limit",
							tone: "danger" as const,
						},
					]
				: []),
			...failedTrials.map((update): Item => ({
				action: canWriteServices
					? { kind: "retry", update }
					: { href: sourceHref(update), kind: "link" },
				detail: `:${update.tag} failed its health check (${trialAttempts(update.trialAttempts)}), :${update.currentTag} is still serving.`,
				icon: TriangleAlert,
				id: `trial:${update.serviceId}`,
				title: `${update.serviceName} trial failed`,
				tone: "danger",
			})),
			...(down.length === 1
				? [
						{
							action: {
								href: `${servicesHref}/${down[0].serviceId}/observability/uptime`,
								kind: "link" as const,
							},
							detail: down[0].detail ?? down[0].target ?? "",
							icon: Unplug,
							id: "uptime",
							title: `${down[0].serviceName} ${down[0].kind === "internal" ? "isn't answering on the network" : "isn't responding"}`,
							tone: "danger" as const,
						},
					]
				: down.length > 1
					? [
							{
								action: { href: resolve("monitoring"), kind: "link" as const },
								detail: [
									...new Set(down.map((check) => check.serviceName)),
								].join(", "),
								icon: Unplug,
								id: "uptime",
								title: `${new Set(down.map((check) => check.serviceId)).size} services aren't responding`,
								tone: "danger" as const,
							},
						]
					: []),
			...(alerts ?? []).map((alert): Item => ({
				action: { href: alertHref(alert), kind: "link" },
				detail: `${alert.title}${alert.count > 1 ? `, ${alert.count}×` : ""} · ${timeAgo(alert.at)}`,
				icon: Bug,
				id: `alert:${alert.kind}:${alert.id}`,
				title: `${alert.serviceName} is throwing`,
				tone: "danger",
			})),
			...setupItems.filter((item) => item.tone !== "danger"),
			...ready.map((update): Item => ({
				action:
					canWriteServices && update.trialStatus !== "running"
						? { kind: "apply", update }
						: { href: sourceHref(update), kind: "link" },
				detail: updateDetail(update),
				icon: ArrowUp,
				id: `update:${update.serviceId}`,
				title: `${update.serviceName} :${update.tag} is available`,
				tone: "info",
			})),
		];
		return list;
	});
	const loading = $derived(
		updates === undefined ||
			overCapacity === undefined ||
			uptimeDown === undefined,
	);
	const shown = $derived(expanded ? items : items.slice(0, VISIBLE));

	async function reapplyCallback() {
		busy = "reapply";
		try {
			await reapplyTraefikConfig();
		} finally {
			busy = null;
		}
	}

	function handleReapply() {
		return toast.promise(reapplyCallback(), {
			error: (error) =>
				toastError(error, "Couldn't re-apply the Traefik configuration."),
			loading: "Re-applying the Traefik configuration",
			success: "Traefik is back on the settings' configuration.",
		});
	}

	/** The enhance options for an update's retry-trial or apply form. */
	function updateEnhance(kind: "apply" | "retry", update: Update) {
		return enhanceToast({
			error:
				kind === "retry"
					? `Couldn't retry the trial of ${update.serviceName}.`
					: `Couldn't update ${update.serviceName}.`,
			loading:
				kind === "retry"
					? `Starting the trial of ${update.serviceName} again`
					: `Queuing the update of ${update.serviceName}`,
			onComplete: () => refreshAll(),
			onSettled: () => {
				busy = null;
			},
			onStart: () => {
				busy = `${kind}:${update.serviceId}`;
			},
			success:
				kind === "retry"
					? `Trying :${update.tag} on ${update.serviceName} again.`
					: `Deploying ${update.serviceName} on :${update.tag}.`,
		});
	}
</script>

{#snippet roundButton(Icon: Component<{ class?: string }>, label: string)}
	<Button
		class="size-7.5 shrink-0 rounded-full"
		aria-label={label}
		disabled={busy !== null}
		size="icon-sm"
		title={label}
		type="submit"
		variant="outline"
	>
		<Icon class="size-3.75" />
	</Button>
{/snippet}

<section class="panel flex min-w-0 flex-col rounded-2xl px-4.5 pt-5 pb-4.5">
	<header class="mb-2 flex items-center gap-2">
		<h2 class="text-[1.0625rem] font-semibold tracking-tight">Needs you</h2>
		{#if items.length > VISIBLE}
			<button
				class="text-text-subtle hover:text-text ml-auto text-[0.8125rem] font-semibold transition-colors"
				onclick={() => {
					expanded = !expanded;
				}}
				type="button"
			>
				{expanded ? "Show less" : `See all ${items.length}`}
			</button>
		{/if}
	</header>

	{#if items.length === 0 && loading}
		<div class="space-y-4 py-3">
			<Skeleton class="h-10 w-full" />
			<Skeleton class="h-10 w-full" />
			<Skeleton class="h-10 w-2/3" />
		</div>
	{:else if items.length === 0}
		<div
			class="text-text-muted flex flex-1 flex-col items-center justify-center gap-2 py-10 text-sm"
		>
			<CircleCheck class="size-6 text-emerald-600 dark:text-emerald-400" />
			Nothing needs you right now.
		</div>
	{:else}
		<ul class="mb-4">
			{#each shown as item (item.id)}
				{@const ItemIcon = item.icon}
				<li
					class="border-border flex items-center gap-3 py-3 not-first:border-t"
				>
					<span
						class="flex size-9.5 shrink-0 items-center justify-center rounded-full {TONES[
							item.tone
						]}"
					>
						<ItemIcon class="size-4.25" />
					</span>
					<div class="min-w-0 flex-1">
						<p class="truncate text-[0.8125rem] font-bold">{item.title}</p>
						<p
							class="text-text-subtle line-clamp-2 text-xs leading-snug wrap-break-word"
						>
							{item.detail}
						</p>
					</div>
					{#if item.action.kind === "link"}
						<Button
							class="size-7.5 shrink-0 rounded-full"
							aria-label="Open"
							href={item.action.href}
							size="icon-sm"
							variant="outline"
						>
							<ArrowRight class="size-3.75" />
						</Button>
					{:else if item.action.kind === "reapply"}
						<Button
							class="size-7.5 shrink-0 rounded-full"
							aria-label="Re-apply the Traefik configuration"
							disabled={busy !== null}
							onclick={handleReapply}
							size="icon-sm"
							title="Re-apply the Traefik configuration"
							variant="outline"
						>
							<RotateCcw class="size-3.75" />
						</Button>
					{:else if item.action.kind === "retry" || item.action.kind === "apply"}
						{@const { kind, update } = item.action}
						<form
							action="{sourceHref(update)}?/{kind === 'retry'
								? 'retryTrial'
								: 'applyUpdate'}"
							method="POST"
							use:enhance={updateEnhance(kind, update)}
						>
							{@render roundButton(
								kind === "retry" ? RotateCcw : ArrowUp,
								kind === "retry" ? "Retry trial" : "Update now",
							)}
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<Button
		class="mt-auto h-10 w-full"
		href={resolve("notifications")}
		variant="outline"
	>
		<Bell class="size-3.75" />
		Open notifications
	</Button>
</section>
