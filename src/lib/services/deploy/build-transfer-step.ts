import type { DeploymentDTO } from "$lib/dto/deployment-dto";
import { AgentClientService } from "../agent-client.service.ts";
import { DockerService } from "../docker.service.ts";
import { registryAuth } from "./helpers.ts";
import {
	type CacheRegistryCredentials,
	type GitBuildPlan,
	unreachable,
} from "./plan.ts";

type CrossHostBuildPlan = Extract<
	GitBuildPlan,
	{ kind: "docker-build" | "agent-build" }
>;

export interface BuiltImage {
	image: string;
	tag: string;
}

/** The registry ref a cross-host build publishes `built` under, e.g. `registry.example.com/homerun-build-api:abc`. */
export function publishedImageRef(
	registry: CacheRegistryCredentials,
	built: BuiltImage,
): BuiltImage {
	return { image: `${registry.registryUrl}/${built.image}`, tag: built.tag };
}

/**
 * Brings an image built on a build server onto this host, so the deploy can
 * run it. With a cache registry: a Docker connection's image is pushed from
 * the build server (an agent already pushed it during its build), then pulled
 * here under its published ref. Without one: the image is streamed straight
 * from the build server's daemon (`docker save`, through the agent for an
 * agent host) into this daemon's `docker load`, keeping its local build tag.
 *
 * @returns The image ref the deploy should run.
 * @throws When the push, pull, save or load fails.
 */
export async function transferBuiltImage(
	dep: DeploymentDTO,
	plan: CrossHostBuildPlan,
	built: BuiltImage,
): Promise<BuiltImage> {
	const ref = `${built.image}:${built.tag}`;
	const onProgress = (line: string) => dep.appendLog(line);
	if (!plan.registry) {
		await dep.appendLog(
			`Streaming the built image from build server ${plan.server.hostId} to this host...`,
		);
		switch (plan.kind) {
			case "docker-build":
				await DockerService.copyImageFromRemote(ref, plan.server.connection);
				break;
			case "agent-build":
				await DockerService.loadImageArchive(
					await AgentClientService.saveImage(plan.server.connection, ref),
				);
				break;
			default:
				return unreachable(plan);
		}
		await dep.appendLog(`Loaded ${ref} onto this host.`);
		return built;
	}

	const published = publishedImageRef(plan.registry, built);
	if (plan.kind === "docker-build") {
		await dep.appendLog(
			`Publishing built image to ${plan.registry.registryUrl}...`,
		);
		await DockerService.pushImage(
			ref,
			`${published.image}:${published.tag}`,
			registryAuth(plan.registry),
			plan.server.connection,
		);
	}
	await dep.appendLog("Pulling published image onto this host...");
	await DockerService.pullImage({
		auth: registryAuth(plan.registry),
		image: published.image,
		onProgress,
		tag: published.tag,
	});
	return published;
}
