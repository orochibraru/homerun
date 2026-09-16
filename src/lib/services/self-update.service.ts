import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { config } from "$lib/config";
import { JobDTO } from "$lib/dto/job-dto";
import { Logger } from "$lib/logger";
import { APP_VERSION } from "$lib/server/app-version";
import { DockerService } from "$lib/services/docker.service";
import { JobWorker } from "$lib/services/queue/worker";
import {
	type ComposeTarget,
	composeTargetFrom,
	containerIdFromMountinfo,
	UPDATER_CONTAINER_NAME,
	UPDATER_IMAGE,
	UPDATER_IMAGE_TAG,
	updaterBinds,
	updaterScript,
} from "./self-update/compose-target.ts";
import { isNewerVersion, normalizeVersion } from "./self-update/version.ts";

const RELEASES_URL =
	"https://api.github.com/repos/orochibraru/homerun/releases/latest";
const RELEASE_CACHE_MS = 60 * 60 * 1000;
const RELEASE_FAILURE_CACHE_MS = 5 * 60 * 1000;
const RELEASE_TIMEOUT_MS = 5000;

const logger = new Logger("SelfUpdate");

export interface LatestRelease {
	publishedAt: string | null;
	url: string;
	version: string;
}

export interface ReleaseStatus {
	current: string;
	latest: LatestRelease | null;
	updateAvailable: boolean;
}

export interface UpdatePreflight {
	pendingDeploys: number;
	reason: string | null;
	ready: boolean;
	runningJobs: number;
	supported: boolean;
}

interface ResolvedSelf {
	hostSocketPath: string;
	target: ComposeTarget;
}

class SelfUpdateServiceClass {
	readonly currentVersion = normalizeVersion(APP_VERSION) ?? APP_VERSION;
	#release: { expiresAt: number; value: LatestRelease | null } | null = null;
	#inFlightRelease: Promise<LatestRelease | null> | null = null;

	/**
	 * The latest GitHub release, cached in `#release` for `RELEASE_CACHE_MS`
	 * (or `RELEASE_FAILURE_CACHE_MS` after a failed check, so a GitHub outage
	 * doesn't hammer the API every call). Concurrent calls during a refresh
	 * share the same in-flight fetch via `#inFlightRelease`.
	 */
	async latestRelease(): Promise<LatestRelease | null> {
		if (this.#release && this.#release.expiresAt > Date.now()) {
			return this.#release.value;
		}
		this.#inFlightRelease ??= this.#fetchLatestRelease().finally(() => {
			this.#inFlightRelease = null;
		});
		return await this.#inFlightRelease;
	}

	/**
	 * Fetches and caches the latest GitHub release, writing to `#release`
	 * either way. Never throws: logs and caches a null result on any network
	 * error, non-2xx response, or unparseable tag.
	 */
	async #fetchLatestRelease(): Promise<LatestRelease | null> {
		try {
			const res = await fetch(RELEASES_URL, {
				headers: {
					Accept: "application/vnd.github+json",
					"User-Agent": "homerun",
				},
				signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
			});
			if (!res.ok) {
				throw new Error(`GitHub answered ${res.status}`);
			}
			const body = (await res.json()) as {
				html_url: string;
				published_at: string | null;
				tag_name: string;
			};
			const version = normalizeVersion(body.tag_name);
			if (!version) {
				throw new Error(`Unexpected release tag ${body.tag_name}`);
			}
			const value = {
				publishedAt: body.published_at,
				url: body.html_url,
				version,
			};
			this.#release = { expiresAt: Date.now() + RELEASE_CACHE_MS, value };
			return value;
		} catch (err) {
			logger.warn("Couldn't check for a newer release", err);
			this.#release = {
				expiresAt: Date.now() + RELEASE_FAILURE_CACHE_MS,
				value: null,
			};
			return null;
		}
	}

	/** The current vs. latest version and whether an update is available, for the settings page's update card. */
	async releaseStatus(): Promise<ReleaseStatus> {
		const latest = await this.latestRelease();
		return {
			current: this.currentVersion,
			latest,
			updateAvailable:
				latest !== null && isNewerVersion(latest.version, this.currentVersion),
		};
	}

	/** Candidate container ids this process might be running in: the container's own hostname, plus one recovered from `/proc/self/mountinfo` if readable, deduplicated. */
	async #ownContainerIds(): Promise<string[]> {
		const mountinfo = await readFile("/proc/self/mountinfo", "utf8").catch(
			() => "",
		);
		const fromMounts = containerIdFromMountinfo(mountinfo);
		return [
			...new Set([hostname(), fromMounts].filter((id): id is string => !!id)),
		];
	}

	/**
	 * Inspects `#ownContainerIds()`'s candidates via the Docker API and, for
	 * the first one that exists, derives its Compose target
	 * (`composeTargetFrom`) and the host path its Docker socket bind mount
	 * comes from. Returns null if no candidate inspects successfully, or the
	 * first one that does has no usable Compose labels (i.e. this process
	 * isn't running as a Compose-managed container).
	 */
	async #resolveSelf(): Promise<ResolvedSelf | null> {
		const docker = DockerService.getDocker();
		for (const id of await this.#ownContainerIds()) {
			// biome-ignore lint/performance/noAwaitInLoops: the first candidate that inspects wins, the rest are fallbacks
			const info = await docker
				.getContainer(id)
				.inspect()
				.catch(() => null);
			if (!info) {
				continue;
			}
			const target = composeTargetFrom(info.Config.Labels, info.Config.Image);
			if (!target) {
				return null;
			}
			const socketMount = info.Mounts.find(
				(mount) => mount.Destination === config.docker.socketPath,
			);
			return {
				hostSocketPath: socketMount?.Source ?? config.docker.socketPath,
				target,
			};
		}
		return null;
	}

	/**
	 * Checks whether a self-update can safely start: the app must resolve to
	 * a Compose service (`#resolveSelf`), and no deploy or job may be
	 * queued/running. Never throws: a `#resolveSelf` failure is logged and
	 * treated as "unsupported" rather than propagated.
	 */
	async preflight(): Promise<UpdatePreflight> {
		const [self, activity] = await Promise.all([
			this.#resolveSelf().catch((err) => {
				logger.warn("Couldn't inspect this app's own container", err);
				return null;
			}),
			JobDTO.activitySummary(),
		]);
		const base = {
			pendingDeploys: activity.pendingDeploys,
			runningJobs: activity.running,
			supported: self !== null,
		};
		if (!self) {
			return {
				...base,
				ready: false,
				reason:
					"Homerun isn't running as a Docker Compose service here, so it can't update itself. Pull the new image and restart it the way you started it.",
			};
		}
		if (activity.pendingDeploys > 0) {
			return {
				...base,
				ready: false,
				reason: `${activity.pendingDeploys} deployment(s) are queued or running. Wait for them to finish first.`,
			};
		}
		if (activity.running > 0) {
			return {
				...base,
				ready: false,
				reason: `${activity.running} job(s) are running. Wait for them to finish first.`,
			};
		}
		return { ...base, ready: true, reason: null };
	}

	/**
	 * Starts a self-update: holds the job worker (`JobWorker.hold()`) so no
	 * new job starts mid-update, re-checks `preflight()` and that no job is
	 * still running, then launches the updater container (`#launchUpdater`)
	 * which pulls and recreates this app's own compose service. Releases the
	 * hold and rethrows on any failure before the updater launches; once it
	 * launches, the hold is left in place (this process is about to be
	 * replaced).
	 * @throws When already on the latest release, an update is already in
	 * progress, or `preflight`/business checks fail.
	 */
	async start(): Promise<{ version: string }> {
		const status = await this.releaseStatus();
		if (!(status.latest && status.updateAvailable)) {
			throw new Error("Homerun is already on the latest release.");
		}
		if (JobWorker.held) {
			throw new Error("An update is already starting.");
		}

		JobWorker.hold();
		try {
			const check = await this.preflight();
			if (!check.ready) {
				throw new Error(check.reason ?? "Homerun can't update right now.");
			}
			if (JobWorker.busy) {
				throw new Error("A job is still running. Try again in a moment.");
			}
			const self = await this.#resolveSelf();
			if (!self) {
				throw new Error("Couldn't find this app's own compose service.");
			}
			await this.#launchUpdater(self, status.latest.version);
			logger.info(
				`Update to ${status.latest.version} started: project=${self.target.project} service=${self.target.service}`,
			);
			return { version: status.latest.version };
		} catch (err) {
			JobWorker.release();
			throw err;
		}
	}

	/**
	 * Pulls the `docker` CLI image, removes any leftover updater container
	 * from a previous run, then creates and starts a fresh one bound to the
	 * host Docker socket and compose directories, running `updaterScript` to
	 * pull and recreate this app's own service.
	 */
	async #launchUpdater(self: ResolvedSelf, version: string): Promise<void> {
		await DockerService.pullImage({
			image: UPDATER_IMAGE,
			tag: UPDATER_IMAGE_TAG,
		});
		const docker = DockerService.getDocker();
		await docker
			.getContainer(UPDATER_CONTAINER_NAME)
			.remove({ force: true })
			.catch((err: { statusCode?: number }) => {
				if (err.statusCode !== 404) {
					throw err;
				}
			});
		const container = await docker.createContainer({
			Cmd: [updaterScript(self.target, version)],
			Entrypoint: ["sh", "-c"],
			HostConfig: {
				Binds: updaterBinds(self.target, self.hostSocketPath),
				RestartPolicy: { Name: "no" },
			},
			Image: `${UPDATER_IMAGE}:${UPDATER_IMAGE_TAG}`,
			Labels: { "homerun.self-update": version },
			name: UPDATER_CONTAINER_NAME,
		});
		await container.start();
	}
}

export const SelfUpdateService = new SelfUpdateServiceClass();
