<script lang="ts">
	import { Cpu } from "@lucide/svelte";
	import { Input } from "@orochibraru/ui/input";
	import {
		Select as SelectRoot,
		SelectContent,
		SelectItem,
		SelectTrigger,
	} from "@orochibraru/ui/select";
	import { untrack } from "svelte";

	import AdvancedDisclosure from "#lib/components/advanced-disclosure.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import type { DetectedConfig } from "#lib/image-config.js";
	import { PULL_POLICIES } from "#lib/pull-policy.js";
	import { joinShellWords } from "#lib/shell-words.js";

	import { Autofill } from "./autofill";
	import DetectedHint from "./detected-hint.svelte";
	import { errorClass, label } from "./field-classes";
	import type { WizardTemplate } from "./wizard-types";

	interface Props {
		buildSource: "git" | "image";
		collapsible: boolean;
		detected: DetectedConfig | null;
		errors?: Record<string, string[]>;
		hidden: boolean;
		swarm: boolean;
		template: WizardTemplate | null;
		values?: Record<string, string>;
	}

	const {
		buildSource,
		collapsible,
		detected,
		errors,
		hidden,
		swarm,
		template,
		values,
	}: Props = $props();

	let restartPolicy = $derived(
		values?.restartPolicy ?? template?.restartPolicy ?? "unless-stopped",
	);
	let pullPolicy = $derived(values?.pullPolicy ?? "always");
	let replicas = $derived(values?.replicas ?? "");
	let cpuLimit = $derived(values?.cpuLimit ?? template?.cpuLimit ?? "");
	let memoryLimitMb = $derived(
		values?.memoryLimitMb ?? String(template?.memoryLimitMb ?? ""),
	);
	let command = $derived(values?.command ?? "");
	let runAsUser = $derived(values?.runAsUser ?? "");
	let healthcheckCommand = $derived(values?.healthcheckCommand ?? "");

	const restartPolicyOptions: [string, string][] = [
		["unless-stopped", "Unless stopped"],
		["always", "Always"],
		["on-failure", "On failure"],
		["no", "Never"],
	];
	const restartPolicyLabel = $derived(
		restartPolicyOptions.find(([val]) => val === restartPolicy)?.[1] ??
			"Unless stopped",
	);
	const pullPolicyOption = $derived(
		PULL_POLICIES.find((opt) => opt.value === pullPolicy) ?? PULL_POLICIES[0],
	);

	const autofill = new Autofill();

	$effect(() => {
		const prefill = detected?.prefill ?? {};
		untrack(() => {
			restartPolicy = autofill.pick(
				"restartPolicy",
				restartPolicy,
				prefill.restartPolicy,
				"unless-stopped",
			);
			pullPolicy = autofill.pick(
				"pullPolicy",
				pullPolicy,
				prefill.pullPolicy,
				"always",
			);
			replicas = autofill.pick(
				"replicas",
				replicas,
				prefill.replicas === undefined ? null : String(prefill.replicas),
				"",
			);
			cpuLimit = autofill.pick("cpuLimit", cpuLimit, prefill.cpuLimit, "");
			memoryLimitMb = autofill.pick(
				"memoryLimitMb",
				memoryLimitMb,
				prefill.memoryLimitMb === undefined
					? null
					: String(prefill.memoryLimitMb),
				"",
			);
		});
	});

	const anyDetected = $derived(
		autofill.holds("restartPolicy", restartPolicy) ||
			autofill.holds("cpuLimit", cpuLimit) ||
			autofill.holds("memoryLimitMb", memoryLimitMb) ||
			autofill.holds("replicas", replicas),
	);

	const imageCommand = $derived([
		...(detected?.entrypoint ?? []),
		...(detected?.command ?? []),
	]);
	const imageHealthcheck = $derived(
		detected?.healthcheck && detected.healthcheck !== "NONE"
			? detected.healthcheck
			: null,
	);
</script>

<section class="panel rounded-md" class:hidden>
	<PanelHeader
		description="How the container starts, restarts and what it may use."
		icon={Cpu}
		title="Runtime"
	/>
	<div class="space-y-5 p-5">
		{#if collapsible && !anyDetected}
			<p class="text-text-muted text-sm">
				Restart policy {restartPolicyLabel.toLowerCase()}, CPU
				{cpuLimit ? `${cpuLimit} cores` : "unlimited"}, memory
				{memoryLimitMb ? `${memoryLimitMb} MB` : "unlimited"}, the image's own
				command{imageHealthcheck ? " and healthcheck" : ""}. Change it here or
				later on the service's Container tab.
			</p>
		{/if}
		<AdvancedDisclosure
			collapsible={collapsible && !anyDetected}
			description="Restart, limits, command and healthcheck"
		>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label class={label} for="restartPolicy">
						Restart policy
						<DetectedHint
							show={autofill.holds("restartPolicy", restartPolicy)}
						/>
					</label>
					<SelectRoot
						name="restartPolicy"
						type="single"
						bind:value={restartPolicy}
					>
						<SelectTrigger class="w-full" id="restartPolicy">
							{restartPolicyLabel}
						</SelectTrigger>
						<SelectContent>
							{#each restartPolicyOptions as [val, lbl] (val)}
								<SelectItem label={lbl} value={val} />
							{/each}
						</SelectContent>
					</SelectRoot>
				</div>
				{#if buildSource === "image"}
					<div>
						<label class={label} for="pullPolicy">
							Pull policy
							<DetectedHint show={autofill.holds("pullPolicy", pullPolicy)} />
						</label>
						<SelectRoot name="pullPolicy" type="single" bind:value={pullPolicy}>
							<SelectTrigger class="w-full" id="pullPolicy">
								{pullPolicyOption.label}
							</SelectTrigger>
							<SelectContent>
								{#each PULL_POLICIES as option (option.value)}
									<SelectItem label={option.label} value={option.value} />
								{/each}
							</SelectContent>
						</SelectRoot>
						<p class="text-text-subtle mt-1 text-xs">
							{pullPolicyOption.description}
						</p>
					</div>
				{/if}
			</div>

			<div class="grid gap-3 {swarm ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}">
				<div>
					<label class={label} for="cpuLimit">
						CPU limit
						<DetectedHint show={autofill.holds("cpuLimit", cpuLimit)} />
					</label>
					<Input
						id="cpuLimit"
						name="cpuLimit"
						placeholder="e.g. 0.5 (cores)"
						type="text"
						bind:value={cpuLimit}
					/>
					{#if errors?.cpuLimit}
						<p class={errorClass}>{errors.cpuLimit[0]}</p>
					{/if}
				</div>
				<div>
					<label class={label} for="memoryLimitMb">
						Memory limit (MB)
						<DetectedHint
							show={autofill.holds("memoryLimitMb", memoryLimitMb)}
						/>
					</label>
					<Input
						id="memoryLimitMb"
						min="1"
						name="memoryLimitMb"
						placeholder="e.g. 512"
						type="number"
						bind:value={memoryLimitMb}
					/>
					{#if errors?.memoryLimitMb}
						<p class={errorClass}>{errors.memoryLimitMb[0]}</p>
					{/if}
				</div>
				{#if swarm}
					<div>
						<label class={label} for="replicas">
							Replicas
							<DetectedHint show={autofill.holds("replicas", replicas)} />
						</label>
						<Input
							id="replicas"
							max="50"
							min="0"
							name="replicas"
							placeholder="1"
							type="number"
							bind:value={replicas}
						/>
						{#if errors?.replicas}
							<p class={errorClass}>{errors.replicas[0]}</p>
						{/if}
					</div>
				{/if}
			</div>
			<p class="text-text-subtle text-xs">Leave limits blank for unlimited.</p>

			<div>
				<label class={label} for="command">Start command</label>
				<Input
					class="font-mono"
					id="command"
					name="command"
					placeholder={imageCommand.length > 0
						? joinShellWords(imageCommand)
						: "The image's own command"}
					type="text"
					bind:value={command}
				/>
				<p class="text-text-subtle mt-1 text-xs">
					Overrides the image's command, shell-style. Blank keeps the image's.
				</p>
				{#if errors?.command}
					<p class={errorClass}>{errors.command[0]}</p>
				{/if}
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label class={label} for="runAsUser">Run as user</label>
					<Input
						class="font-mono"
						id="runAsUser"
						name="runAsUser"
						placeholder={detected?.user ?? "The image's own user"}
						type="text"
						bind:value={runAsUser}
					/>
					<p class="text-text-subtle mt-1 text-xs">
						uid, uid:gid, name or name:group.
					</p>
					{#if errors?.runAsUser}
						<p class={errorClass}>{errors.runAsUser[0]}</p>
					{/if}
				</div>
				<div>
					<label class={label} for="healthcheckCommand">Healthcheck</label>
					<Input
						class="font-mono"
						id="healthcheckCommand"
						name="healthcheckCommand"
						placeholder={imageHealthcheck ?? "curl -f http://localhost:3000/"}
						type="text"
						bind:value={healthcheckCommand}
					/>
					<p class="text-text-subtle mt-1 text-xs">
						{imageHealthcheck
							? "Blank keeps the image's own healthcheck."
							: "Run inside the container; a new revision only gets traffic once it passes."}
					</p>
					{#if errors?.healthcheckCommand}
						<p class={errorClass}>{errors.healthcheckCommand[0]}</p>
					{/if}
				</div>
			</div>
		</AdvancedDisclosure>
	</div>
</section>
