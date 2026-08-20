import { eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import {
	type GitProviderConfig,
	type GitProviderKind,
	type InstanceOauthProvider,
	type InstanceSettings,
	instanceSettings,
} from "$lib/server/db/schema";
import { decryptSecret, encryptSecret } from "$lib/services/secrets";
import { BaseDTO } from "./base-dto";

/** Fixed id — this table only ever holds one row. */
const SINGLETON_ID = "default";

export interface InstanceSettingsCoreInput {
	authCheckUrl: string | null;
	authCrossSubdomainCookies: boolean | null;
	authOrigin: string | null;
	baseDomain: string | null;
}

export interface InstanceSettingsDockerInput {
	dockerNetworkName: string | null;
	dockerSocketPath: string | null;
}

export interface InstanceSettingsTraefikInput {
	traefikCertResolver: string | null;
	traefikDynamicConfigDir: string | null;
	traefikEntrypoint: string | null;
}

export interface InstanceSettingsAutoscaleInput {
	autoscaleCpuThresholdPercent: number;
	autoscaleEnabled: boolean;
	autoscaleMemoryThresholdPercent: number;
	autoscaleOverflowRemoteHostId: string | null;
}

export interface InstanceSettingsSmtpInput {
	smtpEnabled: boolean | null;
	smtpFrom: string | null;
	smtpHost: string | null;
	/** Blank/undefined means "keep the currently stored password". */
	smtpPassword?: string;
	smtpPort: number | null;
	smtpSecure: boolean | null;
	smtpUser: string | null;
}

/** A git provider row coming off the Git Providers form — plaintext secret, blank means "keep existing" on an edit. */
export interface GitProviderInput {
	baseUrl?: string | null;
	clientId: string;
	clientSecret?: string;
	enabled: boolean;
	/** Present when editing an existing provider; absent when adding a new one. */
	id?: string;
	kind: GitProviderKind;
	name: string;
}

/** A provider row coming off the settings form — plaintext secret, blank means "keep existing". */
export interface OauthProviderInput {
	clientId: string;
	clientSecret?: string;
	discoveryUrl: string;
	enabled: boolean;
	name: string;
	pkce: boolean;
	scopes: string[];
}

/** The plain-value shape $lib/config.ts's applyInstanceSettings() merges over env defaults. */
export interface InstanceSettingsOverride {
	authCheckUrl?: string | null;
	authCrossSubdomainCookies?: boolean | null;
	authOrigin?: string | null;
	baseDomain?: string | null;
	dockerNetworkName?: string | null;
	dockerSocketPath?: string | null;
	oauthProviders?: Array<{
		clientId: string;
		clientSecret: string;
		discoveryUrl: string;
		enabled: boolean;
		name: string;
		pkce: boolean;
		scopes: string[];
	}>;
	smtpEnabled?: boolean | null;
	smtpFrom?: string | null;
	smtpHost?: string | null;
	smtpPassword?: string | null;
	smtpPort?: number | null;
	smtpSecure?: boolean | null;
	smtpUser?: string | null;
	traefikCertResolver?: string | null;
	traefikDynamicConfigDir?: string | null;
	traefikEntrypoint?: string | null;
}

/**
 * Wraps the singleton `instance_settings` row — DB overrides for
 * instance-level config that otherwise defaults from env vars (see
 * $lib/config.ts). Unlike every other DTO this isn't user-scoped: there's
 * exactly one row, shared across the whole (single-user) instance.
 */
export class InstanceSettingsDTO extends BaseDTO<InstanceSettings> {
	/** Selects the singleton row, creating a blank default one on first read. */
	static async get(): Promise<InstanceSettingsDTO> {
		const [existing] = await db
			.select()
			.from(instanceSettings)
			.where(eq(instanceSettings.id, SINGLETON_ID))
			.limit(1);
		if (existing) {
			return new InstanceSettingsDTO(existing);
		}

		const now = new Date();
		const row: InstanceSettings = {
			authCheckUrl: null,
			authCrossSubdomainCookies: null,
			authOrigin: null,
			autoscaleCpuThresholdPercent: 80,
			autoscaleEnabled: false,
			autoscaleMemoryThresholdPercent: 80,
			autoscaleOverflowRemoteHostId: null,
			baseDomain: null,
			createdAt: now,
			dockerNetworkName: null,
			dockerSocketPath: null,
			gitProviders: [],
			id: SINGLETON_ID,
			oauthProviders: [],
			onboardingCompletedAt: null,
			smtpEnabled: null,
			smtpFrom: null,
			smtpHost: null,
			smtpPasswordEnc: null,
			smtpPort: null,
			smtpSecure: null,
			smtpUser: null,
			traefikCertResolver: null,
			traefikDynamicConfigDir: null,
			traefikEntrypoint: null,
			updatedAt: now,
		};
		await db.insert(instanceSettings).values(row).onConflictDoNothing();
		return new InstanceSettingsDTO(row);
	}

	/** Whether the onboarding wizard has been completed on this instance. */
	get onboardingComplete(): boolean {
		return this.row.onboardingCompletedAt !== null;
	}

	async markOnboardingComplete(): Promise<void> {
		await this.persist({ onboardingCompletedAt: new Date() });
	}

	async updateCore(input: InstanceSettingsCoreInput): Promise<void> {
		await this.persist(input);
	}

	async updateDocker(input: InstanceSettingsDockerInput): Promise<void> {
		await this.persist(input);
	}

	get autoscale(): InstanceSettingsAutoscaleInput {
		return {
			autoscaleCpuThresholdPercent: this.row.autoscaleCpuThresholdPercent,
			autoscaleEnabled: this.row.autoscaleEnabled,
			autoscaleMemoryThresholdPercent: this.row.autoscaleMemoryThresholdPercent,
			autoscaleOverflowRemoteHostId: this.row.autoscaleOverflowRemoteHostId,
		};
	}

	async updateAutoscale(input: InstanceSettingsAutoscaleInput): Promise<void> {
		await this.persist(input);
	}

	async updateTraefik(input: InstanceSettingsTraefikInput): Promise<void> {
		await this.persist(input);
	}

	async updateSmtp(input: InstanceSettingsSmtpInput): Promise<void> {
		const { smtpPassword, ...rest } = input;
		await this.persist({
			...rest,
			// Blank password field means "leave unchanged" — same convention as
			// service.registryPasswordEnc (never overwrite a stored credential
			// with nothing just because the admin didn't retype it).
			...(smtpPassword ? { smtpPasswordEnc: encryptSecret(smtpPassword) } : {}),
		});
	}

	get gitProviders(): GitProviderConfig[] {
		return this.row.gitProviders;
	}

	async updateGitProviders(providers: GitProviderInput[]): Promise<void> {
		const existingById = new Map(this.row.gitProviders.map((p) => [p.id, p]));
		const rows: GitProviderConfig[] = providers.map((p) => ({
			baseUrl: p.baseUrl?.trim() || null,
			clientId: p.clientId,
			clientSecretEnc: p.clientSecret
				? encryptSecret(p.clientSecret)
				: (existingById.get(p.id ?? "")?.clientSecretEnc ?? ""),
			enabled: p.enabled,
			id: p.id ?? crypto.randomUUID(),
			kind: p.kind,
			name: p.name,
		}));
		await this.persist({ gitProviders: rows });
	}

	async updateOauthProviders(providers: OauthProviderInput[]): Promise<void> {
		const existingByName = new Map(
			this.row.oauthProviders.map((p) => [p.name, p]),
		);
		const rows: InstanceOauthProvider[] = providers.map((p) => ({
			clientId: p.clientId,
			clientSecretEnc: p.clientSecret
				? encryptSecret(p.clientSecret)
				: (existingByName.get(p.name)?.clientSecretEnc ?? ""),
			discoveryUrl: p.discoveryUrl,
			enabled: p.enabled,
			name: p.name,
			pkce: p.pkce,
			scopes: p.scopes,
		}));
		await this.persist({ oauthProviders: rows });
	}

	private async persist(
		input: Partial<Omit<InstanceSettings, "createdAt" | "id" | "updatedAt">>,
	): Promise<void> {
		await db
			.update(instanceSettings)
			.set(input)
			.where(eq(instanceSettings.id, this.row.id));
		Object.assign(this.row, input);
	}

	/** Decrypts every stored secret into the plain-value shape config.ts needs. */
	toConfigOverride(): InstanceSettingsOverride {
		return {
			authCheckUrl: this.row.authCheckUrl,
			authCrossSubdomainCookies: this.row.authCrossSubdomainCookies,
			authOrigin: this.row.authOrigin,
			baseDomain: this.row.baseDomain,
			dockerNetworkName: this.row.dockerNetworkName,
			dockerSocketPath: this.row.dockerSocketPath,
			oauthProviders: this.row.oauthProviders.map((p) => ({
				clientId: p.clientId,
				clientSecret: p.clientSecretEnc
					? (decryptSecret(p.clientSecretEnc) ?? "")
					: "",
				discoveryUrl: p.discoveryUrl,
				enabled: p.enabled,
				name: p.name,
				pkce: p.pkce,
				scopes: p.scopes,
			})),
			smtpEnabled: this.row.smtpEnabled,
			smtpFrom: this.row.smtpFrom,
			smtpHost: this.row.smtpHost,
			smtpPassword: this.row.smtpPasswordEnc
				? decryptSecret(this.row.smtpPasswordEnc)
				: null,
			smtpPort: this.row.smtpPort,
			smtpSecure: this.row.smtpSecure,
			smtpUser: this.row.smtpUser,
			traefikCertResolver: this.row.traefikCertResolver,
			traefikDynamicConfigDir: this.row.traefikDynamicConfigDir,
			traefikEntrypoint: this.row.traefikEntrypoint,
		};
	}
}
