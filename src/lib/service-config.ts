import { z } from "zod";
import type { Service } from "$lib/server/db/schema";

const argv = z.array(z.string()).nullable();

export const serviceConfigSchema = z.object({
	compute: z.object({
		cpuLimit: z.string().nullable(),
		memoryLimitMb: z.number().int().nullable(),
		replicas: z.number().int(),
		restartPolicy: z.string(),
	}),
	env: z.object({
		files: z.array(z.string()),
		secretKeys: z.array(z.string()),
		vars: z.record(z.string(), z.string()),
	}),
	id: z.string(),
	name: z.string(),
	networking: z.object({
		containerPort: z.number().int(),
		customSsl: z.boolean(),
		defaultDomainEnabled: z.boolean(),
		dnsResolvable: z.boolean(),
		domainPorts: z.record(z.string(), z.number().int()),
		domains: z.array(z.string()),
		httpCacheTtl: z.number().int().nullable(),
		networkMode: z.enum(["bridge", "host"]),
		portProtocol: z.enum(["tcp", "udp", "both"]),
		primaryDomain: z.string().nullable(),
		publishedPorts: z.array(
			z.object({
				containerPort: z.number().int(),
				hostPort: z.number().int(),
				protocol: z.enum(["tcp", "udp"]),
			}),
		),
	}),
	runtime: z.object({
		capAdd: z.array(z.string()),
		command: argv,
		devices: z.array(z.string()),
		entrypoint: argv,
		healthcheckCommand: z.string().nullable(),
		labels: z.record(z.string(), z.string()),
		privileged: z.boolean(),
	}),
	security: z.object({
		allowedEmails: z.array(z.string()),
		allowedGroups: z.array(z.string()),
		allowedUserIds: z.array(z.string()),
		imageScanEnabled: z.boolean(),
		loginProviders: z.array(z.string()),
		loginRequired: z.boolean(),
	}),
	settings: z.object({
		autoRedeploy: z.object({
			enabled: z.boolean(),
			schedule: z.string().nullable(),
		}),
		autoRollback: z.boolean(),
		category: z.string().nullable(),
		icon: z.string().nullable().meta({
			description:
				'A bundled template icon file name, "uploaded" for a custom image, or null.',
		}),
		stack: z.object({ id: z.string(), name: z.string() }).nullable(),
		uptimeEnabled: z.boolean(),
	}),
	slug: z.string(),
	source: z.object({
		buildSource: z.enum(["image", "git"]),
		git: z
			.object({
				autoDeployOnPush: z.boolean(),
				bakeFile: z.string().nullable(),
				buildTarget: z.string().nullable(),
				buildCacheRegistryId: z.string().nullable(),
				buildContext: z.string().nullable(),
				buildMethod: z.string(),
				buildServerRemoteHostId: z.string().nullable(),
				dockerfilePath: z.string().nullable(),
				pollEnabled: z.boolean(),
				previewsEnabled: z.boolean(),
				ref: z.string().nullable(),
				requireStatusChecks: z.boolean(),
				requiredStatusChecks: z.array(z.string()),
				url: z.string().nullable(),
			})
			.nullable(),
		image: z.string(),
		pullPolicy: z.string(),
		registry: z.object({
			passwordSet: z.boolean(),
			url: z.string().nullable(),
			username: z.string().nullable(),
		}),
		tag: z.string(),
	}),
	volumes: z.array(
		z.object({
			containerPath: z.string(),
			kind: z.string(),
			name: z.string(),
			readOnly: z.boolean(),
			source: z.string(),
		}),
	),
});

export type ServiceConfig = z.infer<typeof serviceConfigSchema>;

export interface ServiceConfigMount {
	containerPath: string;
	kind: string;
	name: string;
	readOnly: boolean;
	source: string;
}

/**
 * A service's settings grouped the way the dashboard's tabs group them, for
 * `GET /services/{id}/config` and `homerun services config`. Secrets never
 * appear: an encrypted registry password or SSL key becomes a boolean, and an
 * uploaded icon becomes "uploaded" rather than its data URL.
 */
export function serviceConfig(
	row: Service,
	extras: {
		mounts: ServiceConfigMount[];
		stack: { id: string; name: string } | null;
	},
): ServiceConfig {
	return {
		compute: {
			cpuLimit: row.cpuLimit,
			memoryLimitMb: row.memoryLimitMb,
			replicas: row.replicas,
			restartPolicy: row.restartPolicy,
		},
		env: {
			files: row.envFiles,
			secretKeys: row.secretEnvKeys,
			vars: row.envVars ?? {},
		},
		id: row.id,
		name: row.name,
		networking: {
			containerPort: row.containerPort,
			customSsl: Boolean(row.customSslCertEnc && row.customSslKeyEnc),
			defaultDomainEnabled: row.defaultDomainEnabled,
			dnsResolvable: row.dnsResolvable,
			domainPorts: row.domainPorts,
			domains: row.domains,
			httpCacheTtl: row.httpCacheTtl,
			networkMode: row.networkMode,
			portProtocol: row.portProtocol,
			primaryDomain: row.primaryDomain,
			publishedPorts: row.publishedPorts,
		},
		runtime: {
			capAdd: row.capAdd,
			command: row.command,
			devices: row.devices,
			entrypoint: row.entrypoint,
			healthcheckCommand: row.healthcheckCommand,
			labels: row.labels,
			privileged: row.privileged,
		},
		security: {
			allowedEmails: row.authAllowedEmails,
			allowedGroups: row.authAllowedGroups,
			allowedUserIds: row.authAllowedUserIds,
			imageScanEnabled: row.imageScanEnabled,
			loginProviders: row.authProviders,
			loginRequired: row.authRequired,
		},
		settings: {
			autoRedeploy: { enabled: row.cronEnabled, schedule: row.cronSchedule },
			autoRollback: row.autoRollback,
			category: row.category,
			icon: row.icon?.startsWith("data:") ? "uploaded" : row.icon,
			stack: extras.stack,
			uptimeEnabled: row.uptimeEnabled,
		},
		slug: row.slug,
		source: {
			buildSource: row.buildSource,
			git:
				row.buildSource === "git"
					? {
							autoDeployOnPush: row.autoDeployOnPush,
							bakeFile: row.gitBakeFile,
							buildTarget: row.gitBuildTarget,
							buildCacheRegistryId: row.buildCacheRegistryId,
							buildContext: row.gitBuildContext,
							buildMethod: row.gitBuildMethod,
							buildServerRemoteHostId: row.buildServerRemoteHostId,
							dockerfilePath: row.gitDockerfilePath,
							pollEnabled: row.gitPollEnabled,
							previewsEnabled: row.previewsEnabled,
							ref: row.gitRef,
							requireStatusChecks: row.requireStatusChecks,
							requiredStatusChecks: row.requiredStatusChecks,
							url: row.gitUrl,
						}
					: null,
			image: row.image,
			pullPolicy: row.pullPolicy,
			registry: {
				passwordSet: Boolean(row.registryPasswordEnc),
				url: row.registryUrl,
				username: row.registryUsername,
			},
			tag: row.tag,
		},
		volumes: extras.mounts,
	};
}
