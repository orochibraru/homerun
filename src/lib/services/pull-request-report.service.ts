import { config } from "#lib/config.js";
import type { DeploymentDTO } from "#lib/dto/deployment-dto.js";
import { GitConnectionDTO } from "#lib/dto/git-connection-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { StackDTO } from "#lib/dto/stack-dto.js";
import { Logger } from "#lib/logger.js";
import type { GitProviderConfig } from "#lib/server/db/schema.js";
import { primaryHostname, serviceHostnames } from "#lib/service-domains.js";
import {
	enabledGitProvider,
	GitProviderService,
} from "./git-provider.service.ts";

const logger = new Logger("PullRequestReport");

interface ReportTarget {
	connection: GitConnectionDTO;
	number: number;
	provider: GitProviderConfig;
	repo: string;
}

export const PREVIEW_COMMENT_MARKER = "<!-- homerun-preview -->";

/** The comment a preview's pull request gets for a deploy's outcome: its URLs and commit on success, a pointer to the log either way. */
export function previewCommentBody(outcome: {
	commit: string | null;
	logUrl: string | null;
	ok: boolean;
	urls: string[];
}): string {
	const commit = outcome.commit
		? ` from \`${outcome.commit.slice(0, 7)}\``
		: "";
	const lines = [
		outcome.ok
			? `✅ **Preview deployed**${commit}.`
			: `❌ **Preview failed to deploy**${commit}.`,
	];
	if (outcome.ok && outcome.urls.length > 0) {
		lines.push("", ...outcome.urls.map((url) => `- ${url}`));
	}
	if (outcome.logUrl) {
		lines.push("", `[Deployment log](${outcome.logUrl})`);
	}
	return lines.join("\n");
}

/**
 * Reports pull request previews back to GitHub, when the previewed service
 * has `previewReportGithub` on and its repo was picked from a connected
 * GitHub provider: a comment on the pull request with the preview's URLs,
 * updated in place on every deploy, and a deployment to a transient
 * environment named after the preview's slug, deactivated and deleted with
 * the preview. Calls go out as the parent service's owner. Everything here
 * is fire-and-forget: a failure is logged, never thrown into a deploy.
 */
class PullRequestReportServiceClass {
	/** Reports a finished deploy of `preview` on its pull request. Does nothing for a service that isn't a preview. */
	deployed(preview: ServiceDTO, deployment: DeploymentDTO, ok: boolean): void {
		const parentId = preview.toJSON().previewParentId;
		if (!parentId) {
			return;
		}
		this.#deployed(parentId, preview, deployment, ok).catch((err) => {
			logger.warn(
				`Couldn't report the preview deploy to GitHub: service=${preview.id}`,
				err,
			);
		});
	}

	/** Marks a removed preview's pull request comment and GitHub environment as gone. */
	closed(parent: ServiceDTO, preview: ServiceDTO): void {
		this.#closed(parent, preview).catch((err) => {
			logger.warn(
				`Couldn't report the preview removal to GitHub: service=${preview.id}`,
				err,
			);
		});
	}

	/** Posts the comment and the deployment for one finished deploy. */
	async #deployed(
		parentId: string,
		preview: ServiceDTO,
		deployment: DeploymentDTO,
		ok: boolean,
	): Promise<void> {
		const parent = await ServiceDTO.get(parentId);
		const target = parent ? await this.#target(parent, preview) : null;
		if (!target) {
			return;
		}
		const row = preview.toJSON();
		const stack = row.stackId ? await StackDTO.get(row.stackId) : null;
		const scheme = config.traefik.entrypoint === "web" ? "http" : "https";
		const urls = row.dnsResolvable
			? serviceHostnames(row, stack?.slug, config.baseDomain).map(
					(hostname) => `${scheme}://${hostname}`,
				)
			: [];
		const primary = row.dnsResolvable
			? primaryHostname(row, stack?.slug, config.baseDomain)
			: null;
		const commit = deployment.toJSON().gitCommit ?? null;
		const logUrl = config.auth.origin
			? `${config.auth.origin.replace(/\/+$/, "")}/services/${preview.id}/deployments/${deployment.id}`
			: null;

		await this.#comment(
			target,
			previewCommentBody({ commit, logUrl, ok, urls }),
		);
		await this.#deployment(target, {
			description: ok ? "Homerun preview" : "Homerun preview failed to deploy",
			environment: preview.slug,
			logUrl,
			ref: commit ?? preview.gitRef ?? row.previewBranch ?? "HEAD",
			state: ok ? "success" : "failure",
			url: primary ? `${scheme}://${primary}` : null,
		});
		logger.info(
			`Reported preview deploy to GitHub: service=${preview.id} pr=${target.number} ok=${ok}`,
		);
	}

	/** Rewrites the comment to say the preview is gone and closes its environment. */
	async #closed(parent: ServiceDTO, preview: ServiceDTO): Promise<void> {
		const target = await this.#target(parent, preview);
		if (!target) {
			return;
		}
		await this.#comment(target, "Preview removed.");
		await this.#closeEnvironment(target, preview.slug);
	}

	/** Calls GitHub's REST API as the target's connection. */
	async #github(
		target: ReportTarget,
		path: string,
		init: { body?: Record<string, unknown>; method?: string } = {},
	): Promise<Response> {
		return await GitProviderService.api(
			target.provider,
			target.connection,
			`/repos/${target.repo}${path}`,
			init,
		);
	}

	/** Edits Homerun's comment on the pull request (the one carrying `PREVIEW_COMMENT_MARKER` among its first 100), or posts it. */
	async #comment(target: ReportTarget, text: string): Promise<void> {
		const res = await this.#github(
			target,
			`/issues/${target.number}/comments?per_page=100`,
		);
		const existing = (
			(await res.json()) as Array<{ body?: string; id: number }>
		).find((entry) => entry.body?.includes(PREVIEW_COMMENT_MARKER));
		const body = { body: `${PREVIEW_COMMENT_MARKER}\n${text}` };
		if (existing) {
			await this.#github(target, `/issues/comments/${existing.id}`, {
				body,
				method: "PATCH",
			});
			return;
		}
		await this.#github(target, `/issues/${target.number}/comments`, {
			body,
			method: "POST",
		});
	}

	/**
	 * Creates a deployment of `deployment.ref` to the transient environment
	 * `deployment.environment` and sets its outcome as its status. No required
	 * contexts, so pending checks on the commit don't refuse it.
	 *
	 * @throws When GitHub refuses either call or answers without a deployment id.
	 */
	async #deployment(
		target: ReportTarget,
		deployment: {
			description: string;
			environment: string;
			logUrl: string | null;
			ref: string;
			state: "failure" | "success";
			url: string | null;
		},
	): Promise<void> {
		const { description, environment } = deployment;
		const created = (await (
			await this.#github(target, "/deployments", {
				body: {
					auto_merge: false,
					description,
					environment,
					production_environment: false,
					ref: deployment.ref,
					required_contexts: [],
					transient_environment: true,
				},
				method: "POST",
			})
		).json()) as { id?: number; message?: string };
		if (!created.id) {
			throw new Error(
				`GitHub didn't create the deployment: ${created.message ?? "no id in its answer"}`,
			);
		}
		await this.#github(target, `/deployments/${created.id}/statuses`, {
			body: {
				description,
				...(deployment.url ? { environment_url: deployment.url } : {}),
				...(deployment.logUrl ? { log_url: deployment.logUrl } : {}),
				state: deployment.state,
			},
			method: "POST",
		});
	}

	/**
	 * Marks every deployment to `environment` inactive, then deletes the
	 * environment. Deleting needs admin rights on the repo, so a refusal there
	 * is only logged: the deployments are already inactive.
	 */
	async #closeEnvironment(
		target: ReportTarget,
		environment: string,
	): Promise<void> {
		const name = encodeURIComponent(environment);
		const deployments = (await (
			await this.#github(
				target,
				`/deployments?environment=${name}&per_page=100`,
			)
		).json()) as Array<{ id: number }>;
		await Promise.all(
			deployments.map((entry) =>
				this.#github(target, `/deployments/${entry.id}/statuses`, {
					body: { state: "inactive" },
					method: "POST",
				}),
			),
		);
		try {
			await this.#github(target, `/environments/${name}`, { method: "DELETE" });
		} catch (err) {
			logger.info(
				`Deactivated the GitHub environment ${environment} but couldn't delete it (needs admin on the repo): ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	/** The GitHub repo, pull request and credentials to report `preview` with, null when reporting is off or impossible. */
	async #target(
		parent: ServiceDTO,
		preview: ServiceDTO,
	): Promise<ReportTarget | null> {
		const number = preview.toJSON().previewPrNumber;
		if (!(parent.toJSON().previewReportGithub && parent.gitRepo && number)) {
			return null;
		}
		const provider = await enabledGitProvider(parent.gitProviderId);
		if (provider?.kind !== "github") {
			return null;
		}
		const connection = await GitConnectionDTO.getForUserAndProvider(
			parent.userId,
			provider.id,
		);
		if (!connection) {
			logger.warn(
				`Can't report preview to GitHub, the owner isn't connected to ${provider.name}: service=${parent.id}`,
			);
			return null;
		}
		return { connection, number, provider, repo: parent.gitRepo };
	}
}

export const PullRequestReportService = new PullRequestReportServiceClass();
