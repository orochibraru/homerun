import { z } from "zod";
import { resolve } from "$app/paths";
import { getRequestEvent, query } from "$app/server";
import { BuildCacheRegistryDTO } from "$lib/dto/build-cache-registry-dto";
import { CronJobDTO } from "$lib/dto/cron-job-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { NotificationChannelDTO } from "$lib/dto/notification-channel-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { S3DestinationDTO } from "$lib/dto/s3-destination-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { StatusPageDTO } from "$lib/dto/status-page-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { TemplateDTO } from "$lib/dto/template-dto";
import {
	groupResults,
	matchesSearch,
	SEARCH_GROUP_LIMIT,
	SEARCH_MAX_LENGTH,
	SEARCH_MIN_LENGTH,
	type SearchGroup,
	type SearchResult,
} from "$lib/search";
import { requireUser } from "$lib/server/remote-auth";
import { UserService } from "$lib/services/user.service";

function withQuery(path: string, q: string): string {
	return `${path}?${new URLSearchParams({ q })}`;
}

/**
 * Global search over the user's services, stacks, templates, cron jobs and
 * status pages, each mapped to a result linking to its page.
 */
async function searchWorkspace(
	userId: string,
	q: string,
	limit: number,
): Promise<SearchResult[]> {
	const [services, stacks, templates, cronJobs, statusPages] =
		await Promise.all([
			ServiceDTO.search(userId, q, limit),
			StackDTO.search(userId, q, limit),
			TemplateDTO.search(userId, q, limit),
			CronJobDTO.search(userId, q, limit),
			StatusPageDTO.search(userId, q, limit),
		]);

	return [
		...services
			.map((dto) => dto.toJSON())
			.map((row) => ({
				detail: row.customDomain ?? row.gitUrl ?? `${row.image}:${row.tag}`,
				href: resolve("/(protected)/services/[serviceId]", {
					serviceId: row.id,
				}),
				id: row.id,
				kind: "service" as const,
				label: row.name,
			})),
		...stacks
			.map((dto) => dto.toJSON())
			.map((row) => ({
				detail: row.description ?? row.slug,
				href: resolve("/(protected)/stacks/[stackId]", {
					stackId: row.id,
				}),
				id: row.id,
				kind: "stack" as const,
				label: row.name,
			})),
		...templates
			.map((dto) => dto.toJSON())
			.map((row) => ({
				detail: `${row.image}:${row.tag}`,
				href: resolve("/(protected)/templates/[templateId]", {
					templateId: row.id,
				}),
				id: row.id,
				kind: "template" as const,
				label: row.name,
			})),
		...cronJobs
			.map((dto) => dto.toJSON())
			.map((row) => ({
				detail: row.schedule,
				href: resolve("/(protected)/cron-jobs/[cronJobId]", {
					cronJobId: row.id,
				}),
				id: row.id,
				kind: "cronJob" as const,
				label: row.name,
			})),
		...statusPages
			.map((dto) => dto.toJSON())
			.map((row) => ({
				detail: `/status/${row.slug}`,
				href: resolve("/(protected)/status-pages/[statusPageId]", {
					statusPageId: row.id,
				}),
				id: row.id,
				kind: "statusPage" as const,
				label: row.name,
			})),
	];
}

/**
 * Global search over the user's remote hosts, storage volumes, S3 destinations,
 * build cache registries and notification channels, each mapped to a result
 * linking to its page.
 */
async function searchInfrastructure(
	userId: string,
	q: string,
	limit: number,
): Promise<SearchResult[]> {
	const [remoteHosts, volumes, s3Destinations, registries, channels] =
		await Promise.all([
			RemoteHostDTO.search(userId, q, limit),
			StorageVolumeDTO.search(userId, q, limit),
			S3DestinationDTO.search(userId, q, limit),
			BuildCacheRegistryDTO.search(userId, q, limit),
			NotificationChannelDTO.search(userId, q, limit),
		]);

	return [
		...remoteHosts
			.map((dto) => dto.toJSON())
			.map((row) => ({
				detail: row.agentUrl ?? row.dockerHost,
				href: resolve("/(protected)/remote-hosts/[hostId]", { hostId: row.id }),
				id: row.id,
				kind: "remoteHost" as const,
				label: row.name,
			})),
		...volumes
			.map((dto) => dto.toJSON())
			.map((row) => ({
				detail: row.source,
				href: resolve("/(protected)/storage/[volumeId]", { volumeId: row.id }),
				id: row.id,
				kind: "storageVolume" as const,
				label: row.name,
			})),
		...s3Destinations
			.map((dto) => dto.toJSON())
			.map((row) => ({
				detail: `${row.bucket} · ${row.endpoint}`,
				href: withQuery(resolve("/s3-destinations"), row.name),
				id: row.id,
				kind: "s3Destination" as const,
				label: row.name,
			})),
		...registries
			.map((dto) => dto.toJSON())
			.map((row) => ({
				detail: row.registryUrl,
				href: resolve("/(protected)/build-cache-registries/[registryId]", {
					registryId: row.id,
				}),
				id: row.id,
				kind: "buildCacheRegistry" as const,
				label: row.name,
			})),
		...channels
			.map((dto) => dto.toJSON())
			.map((row) => ({
				detail: row.kind,
				href: resolve("/notification-channels"),
				id: row.id,
				kind: "notificationChannel" as const,
				label: row.name,
			})),
	];
}

/**
 * Global search over instance-level configuration : git providers for everyone,
 * plus users and sign-in OAuth providers for admins only.
 */
async function searchInstance(
	q: string,
	limit: number,
	isAdmin: boolean,
): Promise<SearchResult[]> {
	const [users, settings] = await Promise.all([
		isAdmin ? UserService.searchUsers(q, limit) : Promise.resolve([]),
		InstanceSettingsDTO.get(),
	]);
	const oauthProviders = isAdmin ? settings.toJSON().oauthProviders : [];

	return [
		...users.map((row) => ({
			detail: row.role ? `${row.email} · ${row.role}` : row.email,
			href: withQuery(resolve("/users"), row.email),
			id: row.id,
			kind: "user" as const,
			label: row.name,
		})),
		...settings.gitProviders
			.filter((p) => matchesSearch(q, [p.name, p.kind, p.baseUrl]))
			.slice(0, limit)
			.map((p) => ({
				detail: p.baseUrl ?? p.kind,
				href: resolve("/git-providers"),
				id: p.id,
				kind: "gitProvider" as const,
				label: p.name,
			})),
		...oauthProviders
			.filter((p) => matchesSearch(q, [p.name, p.label, p.discoveryUrl]))
			.slice(0, limit)
			.map((p) => ({
				detail: p.discoveryUrl,
				href: resolve("/(protected)/authentication/[providerId]", {
					providerId: p.name,
				}),
				id: p.name,
				kind: "authProvider" as const,
				label: p.label || p.name,
			})),
	];
}

export const searchContent = query(
	z.string().trim().min(SEARCH_MIN_LENGTH).max(SEARCH_MAX_LENGTH),
	async (q): Promise<SearchGroup[]> => {
		const user = requireUser();
		const isAdmin = Boolean(getRequestEvent().locals.isAdmin);
		const groups = await Promise.all([
			searchWorkspace(user.id, q, SEARCH_GROUP_LIMIT),
			searchInfrastructure(user.id, q, SEARCH_GROUP_LIMIT),
			searchInstance(q, SEARCH_GROUP_LIMIT, isAdmin),
		]);
		return groupResults(groups.flat());
	},
);
