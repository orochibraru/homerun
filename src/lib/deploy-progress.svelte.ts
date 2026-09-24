import { toast } from "svelte-sonner";
import { goto, refreshAll } from "$app/navigation";
import { resolve } from "$app/paths";
import { randomId } from "$lib/random-id";
import { enhanceToast } from "$lib/toast";

const IN_FLIGHT_STATUSES = new Set(["pending", "pulling", "starting"]);

const MAX_CONSECUTIVE_MISSES = 30;

export interface DeployProgressService {
	id: () => string;
	name: () => string;
}

export class DeployProgress {
	readonly #service: DeployProgressService;
	pendingAction = $state<string | null>(null);
	progressLines = $state<string[]>([]);
	progressStatus = $state("pending");
	#progressSource: EventSource | null = null;
	#pollGeneration = 0;

	/**
	 * Drives the live deploy progress view of one service's overview page.
	 *
	 * @param service Getters for the service's current id and name, read lazily so a
	 * page navigation to another service is picked up.
	 */
	constructor(service: DeployProgressService) {
		this.#service = service;
	}

	/**
	 * Picks the progress view back up when the page arrives mid-deploy (a reload,
	 * or a deploy queued elsewhere: a template quick-deploy, the create wizard,
	 * cron), since nothing else tells the client when it's done.
	 */
	resume(
		latest: { id: string; status: string } | undefined,
		serviceStatus: string,
	): void {
		if (!latest) {
			return;
		}
		if (
			IN_FLIGHT_STATUSES.has(latest.status) ||
			IN_FLIGHT_STATUSES.has(serviceStatus)
		) {
			this.pendingAction = "deploy";
			this.watchProgress(latest.id);
		}
	}

	/** Closes the live progress stream, if one is open. */
	close(): void {
		this.#progressSource?.close();
		this.#progressSource = null;
	}

	/** Link to the revisions tab with `deploymentId` opened. */
	revisionHref(deploymentId: string): string {
		return `${resolve("/(protected)/services/[serviceId]/revisions", {
			serviceId: this.#service.id(),
		})}?deployment=${deploymentId}`;
	}

	/**
	 * One poll tick: stores the deployment's log and status and returns the
	 * status, or undefined on a missed tick (including the 404 a tick gets when it
	 * races ahead of the deployment row being created).
	 */
	async fetchProgress(deploymentId: string): Promise<string | undefined> {
		try {
			const res = await fetch(
				resolve(
					"/(protected)/services/[serviceId]/deployments/[deploymentId]/progress",
					{ deploymentId, serviceId: this.#service.id() },
				),
			);
			if (res.ok) {
				const body = (await res.json()) as { log: string; status: string };
				this.progressLines = body.log.split("\n").filter(Boolean);
				this.progressStatus = body.status;
				return body.status;
			}
		} catch {
			return undefined;
		}
	}

	/**
	 * Polls once a second until the deployment reaches a terminal status (or 30
	 * ticks in a row miss), then settles it. Refreshes the page's data on every
	 * status transition. Superseded by any later watch or poll.
	 */
	async pollProgress(deploymentId: string): Promise<void> {
		this.#pollGeneration += 1;
		const myGeneration = this.#pollGeneration;
		let status = await this.fetchProgress(deploymentId);
		let lastStatus = status;
		let misses = 0;
		while (myGeneration === this.#pollGeneration) {
			if (status) {
				misses = 0;
				if (status !== lastStatus) {
					lastStatus = status;
					void refreshAll();
				}
				if (!IN_FLIGHT_STATUSES.has(status)) {
					break;
				}
			} else if (++misses >= MAX_CONSECUTIVE_MISSES) {
				break;
			}
			// oxlint-disable-next-line no-await-in-loop -- progress polling is sequential by definition
			await new Promise((r) => setTimeout(r, 1000));
			if (myGeneration !== this.#pollGeneration) {
				return;
			}
			// oxlint-disable-next-line no-await-in-loop -- progress is polled one request at a time
			status = await this.fetchProgress(deploymentId);
		}
		if (myGeneration === this.#pollGeneration) {
			this.settleDeploy(deploymentId, status ?? "");
		}
	}

	/**
	 * Ends the progress view once a deploy reaches a terminal status. A failed
	 * deploy opens its revision instead of refreshing: `refreshAll` claims the
	 * navigation token a microtask later than `goto`, so running both cancels
	 * the navigation.
	 */
	settleDeploy(deploymentId: string, status: string): void {
		this.pendingAction = null;
		if (status !== "failed") {
			void refreshAll();
			return;
		}
		toast.error(`${this.#service.name()} failed to deploy.`, {
			action: {
				label: "See why",
				onClick: () => goto(this.revisionHref(deploymentId)),
			},
			description: "Opening the revision that failed.",
		});
		void goto(this.revisionHref(deploymentId));
	}

	/**
	 * Streams live deploy progress over server-sent events, refreshing the page's
	 * data on each status transition. Falls back to pollProgress if the stream
	 * can't be held open (a buffering proxy, a dropped connection mid-deploy).
	 */
	watchProgress(deploymentId: string): void {
		this.#pollGeneration += 1;
		this.close();

		const source = new EventSource(
			resolve(
				"/(protected)/services/[serviceId]/deployments/[deploymentId]/events",
				{ deploymentId, serviceId: this.#service.id() },
			),
		);
		this.#progressSource = source;
		let lastStatus = "";

		source.addEventListener("progress", (event) => {
			const body = JSON.parse((event as MessageEvent).data) as {
				log: string;
				status: string;
			};
			this.progressLines = body.log.split("\n").filter(Boolean);
			this.progressStatus = body.status;
			if (body.status !== lastStatus) {
				lastStatus = body.status;
				void refreshAll();
			}
		});

		source.addEventListener("done", (event) => {
			this.close();
			const body = JSON.parse((event as MessageEvent).data) as {
				status: string;
			};
			this.settleDeploy(deploymentId, body.status);
		});

		source.addEventListener("error", () => {
			this.close();
			void this.pollProgress(deploymentId);
		});
	}

	/**
	 * `use:enhance` handler for the deploy form: stamps a client-generated
	 * deployment id so progress can be watched before the POST even lands, and
	 * switches to the server's id if it answered with a different one.
	 */
	deployEnhance(): ReturnType<typeof enhanceToast> {
		const name = this.#service.name();
		let submittedDeploymentId: string | null = null;
		return enhanceToast({
			error: `Couldn't queue a deploy for ${name}.`,
			loading: `Queueing a deploy for ${name}`,
			onComplete: () => refreshAll(),
			onStart: () => {
				this.pendingAction = "deploy";
				this.progressLines = [];
				this.progressStatus = "pending";
			},
			onSubmit: ({ formData }) => {
				submittedDeploymentId = randomId();
				formData.set("deploymentId", submittedDeploymentId);
				this.watchProgress(submittedDeploymentId);
			},
			onSuccess: (data) => {
				const actual = data?.deploymentId;
				if (typeof actual === "string" && actual !== submittedDeploymentId) {
					this.watchProgress(actual);
				}
			},
			success: `${name} is queued for deploy.`,
		});
	}
}
