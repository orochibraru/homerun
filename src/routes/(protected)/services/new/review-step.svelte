<script lang="ts">
	import { ClipboardCheck, Pencil } from "@lucide/svelte";

	import { BUILD_METHOD_LABELS, isBuildMethod } from "#lib/build-methods.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { HOST_VOLUME_PREFIX } from "#lib/constants.js";
	import { PULL_POLICIES } from "#lib/pull-policy.js";
	import { defaultHostname } from "#lib/service-domains.js";

	import type { WizardVolume } from "./wizard-types";

	interface Props {
		form: HTMLFormElement | undefined;
		hidden: boolean;
		onedit: (step: number) => void;
		serviceDomain: string;
		stackSlug: string | null;
		volumes: WizardVolume[];
	}

	const { form, hidden, onedit, serviceDomain, stackSlug, volumes }: Props =
		$props();

	interface Row {
		label: string;
		mono?: boolean;
		value: string | null;
	}

	interface Group {
		rows: Row[];
		step: number;
		tags?: string[];
		title: string;
	}

	const RESTART_LABELS: Record<string, string> = {
		always: "Always",
		no: "Never",
		"on-failure": "On failure",
		"unless-stopped": "Unless stopped",
	};

	let snapshot = $state<FormData | null>(null);

	$effect(() => {
		if (!hidden && form) {
			snapshot = new FormData(form);
		}
	});

	/** One submitted field, trimmed; null when blank or absent. */
	function field(data: FormData, name: string): string | null {
		const value = data.get(name);
		return typeof value === "string" && value.trim() ? value.trim() : null;
	}

	/** Where the wizard's git fields point: the provider repository or the URL, at its ref. */
	function gitSource(data: FormData): string | null {
		const repo = field(data, "gitRepo") ?? field(data, "gitUrl");
		return repo ? `${repo} @ ${field(data, "gitRef") ?? "main"}` : null;
	}

	/** The volume a Volumes row mounts, by name. */
	function volumeName(id: string, newName: string, slug: string): string {
		if (id === "new") {
			return `${newName || `${slug}-data`} (new)`;
		}
		if (id.startsWith(HOST_VOLUME_PREFIX)) {
			return `${id.slice(HOST_VOLUME_PREFIX.length)} (from this host)`;
		}
		return volumes.find((v) => v.id === id)?.name ?? id;
	}

	/** The source and service identity rows. */
	function sourceGroup(data: FormData, slug: string): Group {
		const git = field(data, "buildSource") === "git";
		const method = field(data, "gitBuildMethod");
		return {
			rows: [
				{ label: "Name", value: field(data, "name") },
				{
					label: "Address",
					mono: true,
					value: slug ? defaultHostname(slug, stackSlug, serviceDomain) : null,
				},
				git
					? { label: "Repository", mono: true, value: gitSource(data) }
					: {
							label: "Image",
							mono: true,
							value: field(data, "image")
								? `${field(data, "image")}:${field(data, "tag") ?? "latest"}`
								: null,
						},
				...(git
					? [
							{
								label: "Build",
								value: isBuildMethod(method)
									? BUILD_METHOD_LABELS[method]
									: "Dockerfile",
							},
							{
								label: "Auto deploy",
								value: data.get("autoDeployOnPush") ? "On push" : "Off",
							},
						]
					: []),
			],
			step: 0,
			title: "Source",
		};
	}

	/** The port, routing and login rows. */
	function networkGroup(data: FormData): Group {
		const routed = !!data.get("dnsResolvable");
		const port = field(data, "containerPort");
		return {
			rows: [
				{
					label: "Port",
					mono: true,
					value: port
						? `${port}/${field(data, "portProtocol") ?? "tcp"}`
						: null,
				},
				{
					label: "Routing",
					value: routed ? "Public route" : "Private, other services only",
				},
				...(routed
					? [
							{ label: "Domain", mono: true, value: field(data, "domain") },
							{
								label: "Login wall",
								value: data.get("authRequired") ? "Required" : "Off",
							},
						]
					: []),
				{
					label: "Network mode",
					value: field(data, "networkMode") === "host" ? "Host" : "Bridge",
				},
			],
			step: 1,
			title: "Networking",
		};
	}

	/** The env variable names, values left out on purpose. */
	function envGroup(data: FormData): Group {
		const keys = data
			.getAll("envKey")
			.map(String)
			.map((key) => key.trim())
			.filter(Boolean);
		return {
			rows:
				keys.length === 0
					? [{ label: "Variables", value: "None" }]
					: [{ label: "Variables", value: String(keys.length) }],
			step: 2,
			tags: keys,
			title: "Environment",
		};
	}

	/** One row per volume mount. */
	function volumeGroup(data: FormData, slug: string): Group {
		const ids = data.getAll("volumeId").map(String);
		const names = data.getAll("volumeNewName").map(String);
		const paths = data.getAll("volumeContainerPath").map(String);
		const rows = ids.flatMap((id, i) =>
			id && paths[i]?.trim()
				? [
						{
							label: paths[i].trim(),
							mono: true,
							value: volumeName(id, (names[i] ?? "").trim(), slug),
						},
					]
				: [],
		);
		return {
			rows: rows.length > 0 ? rows : [{ label: "Mounts", value: "None" }],
			step: 3,
			title: "Volumes",
		};
	}

	/** The restart, pull, limits, command and healthcheck rows. */
	function runtimeGroup(data: FormData): Group {
		const pull = field(data, "pullPolicy");
		const cpu = field(data, "cpuLimit");
		const memory = field(data, "memoryLimitMb");
		return {
			rows: [
				{
					label: "Restart",
					value:
						RESTART_LABELS[field(data, "restartPolicy") ?? "unless-stopped"],
				},
				...(pull && field(data, "buildSource") !== "git"
					? [
							{
								label: "Pull",
								value:
									PULL_POLICIES.find((p) => p.value === pull)?.label ?? pull,
							},
						]
					: []),
				{
					label: "Limits",
					value: `${cpu ? `${cpu} CPU` : "Unlimited CPU"}, ${memory ? `${memory} MB` : "unlimited memory"}`,
				},
				...(field(data, "replicas")
					? [{ label: "Replicas", value: field(data, "replicas") }]
					: []),
				{
					label: "Command",
					mono: true,
					value: field(data, "command") ?? "The image's own",
				},
				...(field(data, "runAsUser")
					? [{ label: "User", mono: true, value: field(data, "runAsUser") }]
					: []),
				{
					label: "Healthcheck",
					mono: true,
					value: field(data, "healthcheckCommand") ?? "The image's own",
				},
			],
			step: 4,
			title: "Runtime",
		};
	}

	const groups = $derived.by((): Group[] => {
		if (!snapshot) {
			return [];
		}
		const slug = field(snapshot, "slug") ?? "";
		return [
			sourceGroup(snapshot, slug),
			networkGroup(snapshot),
			envGroup(snapshot),
			volumeGroup(snapshot, slug),
			runtimeGroup(snapshot),
		];
	});
</script>

<section class="panel rounded-md" class:hidden>
	<PanelHeader
		description="Check everything once more, then create it."
		icon={ClipboardCheck}
		title="Review"
	/>
	<div class="grid gap-4 p-5 lg:grid-cols-2">
		{#each groups as group (group.title)}
			<div class="border-border rounded-md border">
				<div
					class="border-border flex items-center justify-between border-b px-4 py-2"
				>
					<h3 class="text-text text-sm font-medium">{group.title}</h3>
					<Button
						class="h-auto p-0 text-xs"
						onclick={() => onedit(group.step)}
						variant="link"
					>
						<Pencil class="size-3" />
						Edit
					</Button>
				</div>
				<dl
					class="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-sm"
				>
					{#each group.rows as row, i (i)}
						<dt class="text-text-muted truncate">{row.label}</dt>
						<dd
							class="break-all {row.value
								? 'text-text'
								: 'text-text-subtle'} {row.mono
								? 'font-mono text-xs leading-5'
								: ''}"
						>
							{row.value ?? "Not set"}
						</dd>
					{/each}
				</dl>
				{#if group.tags && group.tags.length > 0}
					<div class="flex flex-wrap gap-1.5 px-4 pb-3">
						{#each group.tags as tag, i (i)}
							<span
								class="bg-surface-2 text-text-muted rounded px-1.5 py-0.5 font-mono text-xs"
								>{tag}</span
							>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</section>
