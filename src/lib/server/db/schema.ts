import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ContainerStatus } from "$lib/types";

export const user = pgTable("user", {
	banExpires: timestamp("ban_expires", { mode: "date" }),
	banned: boolean("banned").default(false),
	banReason: text("ban_reason"),
	createdAt: timestamp("created_at", { mode: "date" }).notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").default(false).notNull(),
	id: text("id").primaryKey(),
	image: text("image"),
	name: text("name").notNull(),
	role: text("role"),
	updatedAt: timestamp("updated_at", { mode: "date" })
		.$onUpdate(() => new Date())
		.notNull(),
});

export const session = pgTable(
	"session",
	{
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
		id: text("id").primaryKey(),
		impersonatedBy: text("impersonated_by"),
		ipAddress: text("ip_address"),
		token: text("token").notNull().unique(),
		updatedAt: timestamp("updated_at", { mode: "date" })
			.$onUpdate(() => new Date())
			.notNull(),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
	"account",
	{
		accessToken: text("access_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at", {
			mode: "date",
		}),
		accountId: text("account_id").notNull(),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		id: text("id").primaryKey(),
		idToken: text("id_token"),
		issuer: text("issuer").notNull(),
		password: text("password"),
		providerId: text("provider_id").notNull(),
		refreshToken: text("refresh_token"),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
			mode: "date",
		}),
		scope: text("scope"),
		updatedAt: timestamp("updated_at", { mode: "date" })
			.$onUpdate(() => new Date())
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("account_issuer_accountId_uidx").on(
			table.issuer,
			table.accountId,
		),
		index("account_userId_idx").on(table.userId),
	],
);

export const verification = pgTable(
	"verification",
	{
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		updatedAt: timestamp("updated_at", { mode: "date" })
			.$onUpdate(() => new Date())
			.notNull(),
		value: text("value").notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const apikey = pgTable(
	"apikey",
	{
		configId: text("config_id").default("default").notNull(),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		enabled: boolean("enabled").default(true),
		expiresAt: timestamp("expires_at", { mode: "date" }),
		id: text("id").primaryKey(),
		key: text("key").notNull(),
		lastRefillAt: timestamp("last_refill_at", { mode: "date" }),
		lastRequest: timestamp("last_request", { mode: "date" }),
		metadata: text("metadata"),
		name: text("name"),
		permissions: text("permissions"),
		prefix: text("prefix"),
		rateLimitEnabled: boolean("rate_limit_enabled").default(true),
		rateLimitMax: integer("rate_limit_max").default(10),
		rateLimitTimeWindow: integer("rate_limit_time_window").default(86_400_000),
		referenceId: text("reference_id").notNull(),
		refillAmount: integer("refill_amount"),
		refillInterval: integer("refill_interval"),
		remaining: integer("remaining"),
		requestCount: integer("request_count").default(0),
		start: text("start"),
		updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
	},
	(table) => [
		index("apikey_configId_idx").on(table.configId),
		index("apikey_referenceId_idx").on(table.referenceId),
		index("apikey_key_idx").on(table.key),
	],
);

export const passkey = pgTable(
	"passkey",
	{
		aaguid: text("aaguid"),
		backedUp: boolean("backed_up").notNull(),
		counter: integer("counter").notNull(),
		createdAt: timestamp("created_at", { mode: "date" }),
		credentialID: text("credential_id").notNull(),
		deviceType: text("device_type").notNull(),
		id: text("id").primaryKey(),
		name: text("name"),
		publicKey: text("public_key").notNull(),
		transports: text("transports"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("passkey_userId_idx").on(table.userId),
		index("passkey_credentialID_idx").on(table.credentialID),
	],
);

// ─── PaaS Domain ────────────────────────────────────────────────────────────

export const project = pgTable(
	"project",
	{
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		description: text("description"),
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		// DNS-safe prefix applied to every member service's container name and
		// subdomain (e.g. "<projectSlug>-<serviceSlug>.<baseDomain>") : see
		// docker/service.ts's containerName() and docker/labels.ts.
		slug: text("slug").notNull().unique(),
		updatedAt: timestamp("updated_at", { mode: "date" })
			.$onUpdate(() => new Date())
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("project_userId_idx").on(table.userId)],
);

export const remoteHost = pgTable(
	"remote_host",
	{
		// AES-256-GCM ciphertext, same scheme as service.registryPasswordEnc :
		// only set when kind = "agent". The bearer token this app presents to
		// the remote Homerun Agent's HTTP API (see agent/README.md).
		agentTokenEnc: text("agent_token_enc"),
		// "http://host:7420" or "https://host:7420", the Homerun Agent's own
		// reachable base URL : only set when kind = "agent". Distinct from
		// dockerHost, which speaks the raw Docker Engine API directly instead
		// of going through an agent's HTTP surface.
		agentUrl: text("agent_url"),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		// "tcp://host:2376" (optionally TLS-secured with the ca/cert/key
		// below) or "ssh://user@host" : passed to dockerode's constructor
		// as-is, parsed by docker/client.ts's getDocker(). Never a bare
		// "unix://..." : the local socket is always the implicit default
		// (remoteHostId: null on a service), not a row in this table. Only
		// set when kind = "docker".
		dockerHost: text("docker_host"),
		id: text("id").primaryKey(),
		// Opt-in : whether this host can be picked as a service's *build
		// server* (Source tab, git mode), separate from being picked as a
		// deploy target. Off by default, same "background/cross-cutting
		// capability defaults inert" posture as autoscaleEligible. Either
		// kind : a "docker" build server runs a raw dockerode `buildImage()`
		// (docker/git-build.ts), an "agent" one calls its own `POST /v1/build`
		// (agent-client.service.ts), see RemoteHostDTO.listBuildServers.
		isBuildServer: boolean("is_build_server").default(false).notNull(),
		// "docker" (the original/default, a raw tcp://ssh:// Docker Engine
		// connection) or "agent" (a registered Homerun Agent, see agent/README.md
		// : token-authenticated HTTP instead of a raw Docker socket/TLS cert).
		// Both kinds are real deploy targets and build servers :
		// RemoteHostDTO.resolveTarget resolves either one into a
		// `RemoteExecutionTarget`, which deploy.service.ts and
		// service-lifecycle.service.ts branch on to route through
		// DockerService (docker) or AgentClientService (agent).
		kind: text("kind", { enum: ["docker", "agent"] })
			.default("docker")
			.notNull(),
		name: text("name").notNull(),
		// AES-256-GCM ciphertext, same scheme as service.registryPasswordEnc
		// : only set when dockerHost uses TLS-secured tcp://.
		tlsCaEnc: text("tls_ca_enc"),
		tlsCertEnc: text("tls_cert_enc"),
		tlsKeyEnc: text("tls_key_enc"),
		updatedAt: timestamp("updated_at", { mode: "date" })
			.$onUpdate(() => new Date())
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("remoteHost_userId_idx").on(table.userId)],
);

// A named Docker registry used as a *build cache* for git-based builds (see
// docker/git-build.ts), not a deploy target : buildFromGit pulls
// `<registryUrl>/<cacheRepository>:cache-<slug>` as a `--cache-from` source
// before building and pushes the fresh layers back after, so a repeat build
// of the same service reuses unchanged layers instead of rebuilding from
// scratch. Picked per-service on the Source tab (git mode only), same
// "reusable named profile, not duplicated per-service creds" shape as
// s3Destination.
export const buildCacheRegistry = pgTable(
	"build_cache_registry",
	{
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		// AES-256-GCM ciphertext, same scheme as service.registryPasswordEnc.
		passwordEnc: text("password_enc").notNull(),
		// "registry.example.com" or "ghcr.io" : no scheme, matches how
		// dockerode's authconfig.serveraddress and image ref prefixes are
		// both written.
		registryUrl: text("registry_url").notNull(),
		updatedAt: timestamp("updated_at", { mode: "date" })
			.$onUpdate(() => new Date())
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		username: text("username").notNull(),
	},
	(table) => [index("buildCacheRegistry_userId_idx").on(table.userId)],
);

// Singleton row (id is always "default") holding DB overrides for
// instance-level config that otherwise defaults from env vars (see
// $lib/config.ts's envDefaults + applyInstanceSettings()). Every column is
// nullable : null means "fall back to the env default", a non-null value
// overrides it. Secrets (smtpPasswordEnc, each oauth provider's
// clientSecretEnc) use the same AES-256-GCM scheme as
// service.registryPasswordEnc.
export const instanceSettings = pgTable("instance_settings", {
	authCheckUrl: text("auth_check_url"),
	authCrossSubdomainCookies: boolean("auth_cross_subdomain_cookies"),
	authOrigin: text("auth_origin"),
	// Opt-in, off by default : same "background automation that touches
	// live containers must default to inert" posture as cronEnabled/
	// backupEnabled elsewhere in this app. When on, CronService's autoscale
	// tick migrates autoscale-eligible services (service.autoscaleEligible)
	// off the local host onto autoscaleOverflowRemoteHostId whenever host
	// CPU or memory crosses its threshold : see $lib/services/cron.service.ts
	// and the Settings page's Autoscaling section.
	autoscaleCpuThresholdPercent: integer("autoscale_cpu_threshold_percent")
		.notNull()
		.default(80),
	autoscaleEnabled: boolean("autoscale_enabled").notNull().default(false),
	autoscaleMemoryThresholdPercent: integer("autoscale_memory_threshold_percent")
		.notNull()
		.default(80),
	// Nullable FK to remote_host : where an over-threshold service gets
	// migrated to. Not a hard requirement at the schema level (autoscaling
	// is simply a no-op with this unset) since Postgres FKs aren't the
	// enforcement mechanism this app leans on for row-cleanup anyway (see
	// the Postgres-vs-SQLite FK note above).
	autoscaleOverflowRemoteHostId: text(
		"autoscale_overflow_remote_host_id",
	).references(() => remoteHost.id, { onDelete: "set null" }),
	baseDomain: text("base_domain"),
	// Cloudflare API token (Zone:DNS:Edit scope) + the zone id `baseDomain`
	// lives in : when both are set, a deployed service with `dnsResolvable`
	// gets its `<slug>.<baseDomain>` hostname auto-created/updated as a
	// CNAME record pointing at `baseDomain` itself (see
	// $lib/services/cloudflare.service.ts), instead of the admin adding one
	// by hand for every new service. Unset (the default) : no-op, same
	// "background automation defaults inert" posture as autoscaling/backups.
	// AES-256-GCM ciphertext, same scheme as service.registryPasswordEnc.
	cloudflareApiTokenEnc: text("cloudflare_api_token_enc"),
	cloudflareZoneId: text("cloudflare_zone_id"),
	createdAt: timestamp("created_at", { mode: "date" }).notNull(),
	dockerNetworkName: text("docker_network_name"),
	dockerSocketPath: text("docker_socket_path"),
	// {id, kind, name, baseUrl, clientId, clientSecretEnc, enabled}[] : OAuth
	// App registrations for git-hosting providers (see the Git Providers
	// page and $lib/services/git-provider.service.ts), separate from
	// oauthProviders above (those are for signing *into* Homerun itself via
	// an OIDC provider; these are for connecting *out* to GitHub/GitLab/
	// Gitea/Bitbucket to browse a user's repos when creating a git-based
	// service). Deliberately not part of applyInstanceSettings()'s merge :
	// same reasoning as onboardingCompletedAt, this isn't an env-default-
	// backed config value.
	gitProviders: jsonb("git_providers")
		.$type<GitProviderConfig[]>()
		.notNull()
		.default([]),
	id: text("id").primaryKey(),
	// {name, clientId, clientSecretEnc, discoveryUrl, enabled, pkce, scopes}[]
	// : see genericOAuth's config shape in $lib/services/auth.ts.
	oauthProviders: jsonb("oauth_providers")
		.$type<InstanceOauthProvider[]>()
		.notNull()
		.default([]),
	// Non-null once the onboarding wizard has been completed : gates every
	// (protected)/ route (see (protected)/+layout.server.ts). Unlike every
	// other column here, not part of the config-override merge in
	// $lib/config.ts : this is onboarding-flow state, not an instance config
	// value.
	onboardingCompletedAt: timestamp("onboarding_completed_at", {
		mode: "date",
	}),
	// "standalone" (default, dockerode createContainer, one container per
	// service, this app's original model) | "swarm" (dockerode
	// createService against a Docker Swarm : replicas, rolling force-update
	// restarts, overlay networking). Opt-in, off by default : same
	// "background automation defaults inert" posture as autoscaling. The
	// host's own daemon must already be swarm-active (`docker swarm init`,
	// the admin's own one-time step, this app never runs that itself) before
	// switching this on. See $lib/services/docker/swarm.ts.
	orchestrationMode: text("orchestration_mode").$type<"standalone" | "swarm">(),
	// Self-hosted Pangolin (https://api.pangolin.net/v1/docs/, a tunnel/
	// reverse-proxy manager, not a plain DNS API) : an alternative to the
	// Cloudflare integration above for instances that front themselves with
	// Pangolin instead of a DNS provider Traefik can ACME against directly.
	// When all four are set, a deployed service with `dnsResolvable` gets a
	// Pangolin Resource (subdomain under one of the org's registered Pangolin
	// domains) + a Target auto-created, pointing at this host's own Traefik
	// entrypoint through pangolinMainSiteName's tunnel, instead of the admin
	// wiring one up by hand for every service (see
	// $lib/services/pangolin.service.ts). Unset (the default) : no-op, same
	// "background automation defaults inert" posture as Cloudflare/
	// autoscaling/backups. Both integrations can be configured at once, each
	// runs independently in the deploy pipeline.
	pangolinApiBaseUrl: text("pangolin_api_base_url"),
	// AES-256-GCM ciphertext, same scheme as cloudflareApiTokenEnc.
	pangolinApiTokenEnc: text("pangolin_api_token_enc"),
	// The Pangolin "site" (tunnel agent) a created Resource's Target routes
	// to : must already exist in Pangolin, matched by name, this app never
	// creates a site itself.
	pangolinMainSiteName: text("pangolin_main_site_name"),
	pangolinOrgId: text("pangolin_org_id"),
	// Local port a Resource's Target forwards to on pangolinMainSiteName's
	// host, null defaults to 80 (this app's own Traefik entrypoint, assumed
	// to be running on the same host as the Pangolin site agent, HTTP-only :
	// Pangolin terminates the public TLS connection itself, same "DNS/edge
	// layer owns TLS, Traefik doesn't need to" posture as the Cloudflare
	// integration's plain, unproxied CNAME).
	pangolinTargetPort: integer("pangolin_target_port"),
	smtpEnabled: boolean("smtp_enabled"),
	smtpFrom: text("smtp_from"),
	smtpHost: text("smtp_host"),
	smtpPasswordEnc: text("smtp_password_enc"),
	smtpPort: integer("smtp_port"),
	smtpSecure: boolean("smtp_secure"),
	smtpUser: text("smtp_user"),
	traefikAcmeEmail: text("traefik_acme_email"),
	traefikCertResolver: text("traefik_cert_resolver"),
	traefikDynamicConfigDir: text("traefik_dynamic_config_dir"),
	traefikEntrypoint: text("traefik_entrypoint"),
	updatedAt: timestamp("updated_at", { mode: "date" })
		.$onUpdate(() => new Date())
		.notNull(),
});

export interface InstanceOauthProvider {
	clientId: string;
	clientSecretEnc: string;
	discoveryUrl: string;
	enabled: boolean;
	name: string;
	pkce: boolean;
	scopes: string[];
}

export type GitProviderKind = "github" | "gitlab" | "gitea" | "bitbucket";

export interface GitProviderConfig {
	// Referenced by git_connection.providerId and the /api/v1/git-providers/
	// [providerId]/* routes : not a DB FK since these live inside the
	// instance_settings JSON column, not their own table.
	baseUrl: string | null;
	clientId: string;
	clientSecretEnc: string;
	enabled: boolean;
	id: string;
	kind: GitProviderKind;
	name: string;
}

// A pending admin-sent invite to create an account : see InvitationDTO and
// the Users page's "Send invite" action. Accepting one (at
// /auth/accept-invite/[token]) creates the user directly via
// auth.api.createUser and sets acceptedAt; there's no separate account
// row until then.
export const invitation = pgTable(
	"invitation",
	{
		acceptedAt: timestamp("accepted_at", { mode: "date" }),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		email: text("email").notNull(),
		expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
		id: text("id").primaryKey(),
		invitedByUserId: text("invited_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role").notNull(),
		token: text("token").notNull().unique(),
	},
	(table) => [index("invitation_email_idx").on(table.email)],
);

export const template = pgTable(
	"template",
	{
		category: text("category"), // "database" | "cache" | "monitoring" | "automation" | "other"
		containerPort: integer("container_port").notNull(),
		cpuLimit: text("cpu_limit"),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		description: text("description"),
		envVars: jsonb("env_vars").$type<Record<string, string>>().default({}),
		icon: text("icon"), // lucide icon name, looked up the same way SERVICE_STATUS_CONFIG maps a key to an icon component
		id: text("id").primaryKey(),
		image: text("image").notNull(),
		memoryLimitMb: integer("memory_limit_mb"),
		name: text("name").notNull(),
		// null = built-in (seeded), immutable : not owned by any user
		ownerId: text("owner_id").references(() => user.id, {
			onDelete: "cascade",
		}),
		restartPolicy: text("restart_policy").default("unless-stopped").notNull(),
		sourceUrl: text("source_url"),
		tag: text("tag").default("latest").notNull(),
		updatedAt: timestamp("updated_at", { mode: "date" })
			.$onUpdate(() => new Date())
			.notNull(),
		websiteUrl: text("website_url"),
	},
	(table) => [index("template_ownerId_idx").on(table.ownerId)],
);

export const templateLink = pgTable(
	"template_link",
	{
		alias: text("alias").notNull(),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		id: text("id").primaryKey(),
		linkedTemplateId: text("linked_template_id")
			.notNull()
			.references(() => template.id, { onDelete: "cascade" }),
		templateId: text("template_id")
			.notNull()
			.references(() => template.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("templateLink_templateId_idx").on(table.templateId),
		uniqueIndex("templateLink_templateId_alias_uidx").on(
			table.templateId,
			table.alias,
		),
	],
);

export const service = pgTable(
	"service",
	{
		// When true, a Traefik forwardAuth middleware gatekeeps this service
		// behind this app's own login (any provider, including a configured
		// OIDC one) : see docker/labels.ts and /api/v1/auth-check.
		authRequired: boolean("auth_required").default(false).notNull(),
		// Opt-in, off by default (Compute tab) : whether CronService's
		// autoscale tick is allowed to migrate this service onto
		// instanceSettings.autoscaleOverflowRemoteHostId when the local
		// host is over its configured resource threshold. No effect unless
		// autoscaling is also enabled instance-wide.
		autoscaleEligible: boolean("autoscale_eligible").default(false).notNull(),
		// Registry to use as a git-build layer cache (git mode only, see
		// docker/git-build.ts) : null means no cache-from/cache-to, every
		// build is from scratch, same as before this existed.
		buildCacheRegistryId: text("build_cache_registry_id").references(
			() => buildCacheRegistry.id,
			{ onDelete: "set null" },
		),
		// A remote host (must have isBuildServer=true) to run the git-build
		// step on instead of the deploy target (null : build on whatever
		// daemon deployService would build on anyway, remoteHostId or local,
		// same as before this existed). When set to a host *different* from
		// the deploy target, the built image only exists on the build
		// server's own daemon, so deployService requires buildCacheRegistryId
		// too in that case : it pushes the final image there and pulls it on
		// the deploy target before starting the container. See
		// deploy.service.ts.
		buildServerRemoteHostId: text("build_server_remote_host_id").references(
			() => remoteHost.id,
			{ onDelete: "set null" },
		),
		// "image" (bring-your-own, the original/default) | "git" (clone +
		// build a Dockerfile locally : see $lib/services/docker/git-build.ts).
		// When "git", `image`/`tag` are overwritten after each successful
		// build with the resulting local tag, not user-editable directly.
		buildSource: text("build_source")
			.$type<"image" | "git">()
			.default("image")
			.notNull(),
		containerId: text("container_id"),
		containerPort: integer("container_port").notNull(),
		cpuLimit: text("cpu_limit"),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		// Standard 5-field cron expression ("min hour day month weekday"),
		// evaluated in the server's local time : see $lib/services/cron.service.ts.
		// Null/disabled unless the user opts in via the Overview tab.
		cronEnabled: boolean("cron_enabled").default(false).notNull(),
		cronLastRunAt: timestamp("cron_last_run_at", { mode: "date" }),
		cronSchedule: text("cron_schedule"),
		// pending | pulling | starting | running | stopped | failed
		currentStatus: text("current_status")
			.$type<ContainerStatus>()
			.default("pending")
			.notNull(),
		// Optional second hostname routed to this service (its own DNS A/CNAME
		// must already point at this host : the app doesn't manage that).
		// Only takes effect when dnsResolvable is true.
		customDomain: text("custom_domain").unique(),
		// AES-256-GCM ciphertext (PEM), same scheme as registryPasswordEnc.
		// Only take effect together, and only when customDomain is set : see
		// $lib/services/docker/custom-ssl.ts. Requires the admin's own opt-in
		// (TRAEFIK_DYNAMIC_CONFIG_DIR + a Traefik file-provider config
		// change, see compose.yaml) to actually be picked up by Traefik.
		customSslCertEnc: text("custom_ssl_cert_enc"),
		customSslKeyEnc: text("custom_ssl_key_enc"),
		// running | stopped : the user's intent
		desiredState: text("desired_state")
			.$type<"running" | "stopped">()
			.default("stopped")
			.notNull(),
		// When false, no Traefik router/service labels are attached at deploy
		// time : the container never gets a public <slug>.<baseDomain>, only
		// reachable over the internal network(s) it's attached to (the shared
		// network by slug alias, plus its project's network if any).
		dnsResolvable: boolean("dns_resolvable").default(true).notNull(),
		envVars: jsonb("env_vars").$type<Record<string, string>>().default({}),
		// Relative to gitBuildContext. Defaults to "Dockerfile" when unset.
		gitBuildContext: text("git_build_context"),
		gitDockerfilePath: text("git_dockerfile_path"),
		// Branch or tag : see $lib/services/docker/git-build.ts (a bare commit
		// SHA needs a full, non-shallow clone, not supported here).
		gitRef: text("git_ref"),
		gitUrl: text("git_url"),
		id: text("id").primaryKey(),
		// e.g. "ghcr.io/acme/api"
		image: text("image").notNull(),
		memoryLimitMb: integer("memory_limit_mb"),
		name: text("name").notNull(),
		// "bridge" (default : the shared homerun + project network,
		// Traefik-routed) | "host" (shares the host's network namespace
		// directly, e.g. for mDNS/SSDP-dependent apps like Home Assistant :
		// no Traefik routing, no internal slug alias, not on any Docker
		// network at all; Docker doesn't allow combining host mode with
		// other network attachments). Forces dnsResolvable false server-side
		// regardless of what's submitted : see docker/containers.ts.
		networkMode: text("network_mode")
			.$type<"bridge" | "host">()
			.default("bridge")
			.notNull(),
		// "tcp" | "udp" | "both" : which protocol(s) containerPort is exposed
		// under (Docker's ExposedPorts declaration). Informational only in
		// bridge mode (this app never publishes a host port : see the
		// Networking tab's own copy); the container's actual host-visible
		// port(s) in host mode, since there's no publish/mapping step there.
		portProtocol: text("port_protocol")
			.$type<"tcp" | "udp" | "both">()
			.default("tcp")
			.notNull(),
		// nullable : grouping is opt-in, ungrouped services stay valid
		projectId: text("project_id").references(() => project.id, {
			onDelete: "set null",
		}),
		// AES-256-GCM ciphertext : see $lib/services/secrets
		registryPasswordEnc: text("registry_password_enc"),
		registryUrl: text("registry_url"),
		registryUsername: text("registry_username"),
		// Null = the local Docker socket (the default, and the only option
		// before remote hosts existed). See docker/client.ts's getDocker().
		remoteHostId: text("remote_host_id").references(() => remoteHost.id, {
			onDelete: "set null",
		}),
		// Desired replica count, swarm-mode only (instanceSettings.orchestrationMode
		// = "swarm") : ignored entirely in standalone mode, always 1 container.
		// Editable on the Compute tab.
		replicas: integer("replicas").default(1).notNull(),
		// no | always | on-failure | unless-stopped
		restartPolicy: text("restart_policy").default("unless-stopped").notNull(),
		// subdomain: <slug>.<baseDomain>
		slug: text("slug").notNull().unique(),
		// Swarm mode's equivalent of `containerId` : the Docker Swarm service
		// id backing this Homerun service, when deployed under
		// orchestrationMode="swarm". `containerId` stays null in that case
		// (there's no single container, dockerode's Task API resolves the
		// live container id per-task when one's needed, e.g. the Terminal
		// tab : see docker/swarm.ts).
		swarmServiceId: text("swarm_service_id"),
		tag: text("tag").default("latest").notNull(),
		updatedAt: timestamp("updated_at", { mode: "date" })
			.$onUpdate(() => new Date())
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("service_userId_idx").on(table.userId),
		index("service_slug_idx").on(table.slug),
		index("service_projectId_idx").on(table.projectId),
	],
);

export const deployment = pgTable(
	"deployment",
	{
		containerId: text("container_id"),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		errorMessage: text("error_message"),
		finishedAt: timestamp("finished_at", { mode: "date" }),
		id: text("id").primaryKey(),
		imageDigest: text("image_digest"),
		// Progress lines appended live during deploy ("Pulling image...",
		// "Starting container...") : polled by the Overview tab while a deploy
		// is in flight, kept around after for a lightweight audit trail.
		log: text("log").default(""),
		serviceId: text("service_id")
			.notNull()
			.references(() => service.id, { onDelete: "cascade" }),
		startedAt: timestamp("started_at", { mode: "date" }),
		// pending | pulling | starting | running | failed | stopped
		status: text("status")
			.$type<ContainerStatus>()
			.default("pending")
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("deployment_serviceId_idx").on(table.serviceId),
		index("deployment_userId_idx").on(table.userId),
	],
);

// A named, reusable S3-compatible backup destination (bucket/endpoint/region
// + credentials), configured once on the S3 Destinations page and picked by
// id from any number of volumes, instead of every volume duplicating its own
// copy of the same bucket/keys (the old shape : see storageVolume's
// s3DestinationId below).
export const s3Destination = pgTable(
	"s3_destination",
	{
		accessKeyId: text("access_key_id").notNull(),
		bucket: text("bucket").notNull(),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		// S3-compatible endpoint, e.g. "https://s3.us-east-1.amazonaws.com" or
		// a self-hosted MinIO URL.
		endpoint: text("endpoint").notNull(),
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		region: text("region").notNull(),
		// AES-256-GCM ciphertext, same scheme as service.registryPasswordEnc.
		secretAccessKeyEnc: text("secret_access_key_enc").notNull(),
		updatedAt: timestamp("updated_at", { mode: "date" })
			.$onUpdate(() => new Date())
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("s3Destination_userId_idx").on(table.userId)],
);

export const storageVolume = pgTable(
	"storage_volume",
	{
		// Cron expression for scheduled backups, evaluated by the same
		// scheduler tick as service redeploys : see $lib/services/cron.service.ts.
		backupEnabled: boolean("backup_enabled").default(false).notNull(),
		backupLastRunAt: timestamp("backup_last_run_at", { mode: "date" }),
		// Object key prefix within the destination's bucket, e.g.
		// "backups/my-app" : per-volume, even when several volumes share one
		// destination.
		backupPrefix: text("backup_prefix"),
		backupSchedule: text("backup_schedule"),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		description: text("description"),
		id: text("id").primaryKey(),
		// Docker Binds source: either a bind-mount host path ("/mnt/data/foo")
		// or a Docker-managed named volume ("homerun-vol-xyz") : same field,
		// Docker's Binds syntax tells them apart by whether it looks like a
		// path. `kind` just drives which the create form asks for.
		// "bind" | "volume"
		kind: text("kind").notNull(),
		name: text("name").notNull(),
		s3DestinationId: text("s3_destination_id").references(
			() => s3Destination.id,
			{ onDelete: "set null" },
		),
		source: text("source").notNull(),
		updatedAt: timestamp("updated_at", { mode: "date" })
			.$onUpdate(() => new Date())
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("storageVolume_userId_idx").on(table.userId)],
);

// One storage volume can be mounted into several services : that's what
// makes it "shared" across a project, no separate project-level concept
// needed (see TODO.md).
export const serviceVolume = pgTable(
	"service_volume",
	{
		containerPath: text("container_path").notNull(),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		id: text("id").primaryKey(),
		readOnly: boolean("read_only").default(false).notNull(),
		serviceId: text("service_id")
			.notNull()
			.references(() => service.id, { onDelete: "cascade" }),
		volumeId: text("volume_id")
			.notNull()
			.references(() => storageVolume.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("serviceVolume_serviceId_idx").on(table.serviceId),
		index("serviceVolume_volumeId_idx").on(table.volumeId),
	],
);

// One row per backup attempt (scheduled or manual "Run now"), the run log
// backing the dedicated Backups page : `storage_volume.backupLastRunAt`
// alone only ever remembered the *last* timestamp, not whether it succeeded
// or a history to look back at. Inserted/finalized from
// BackupService.runBackup() (the one place both the scheduler and the
// manual action funnel through), not duplicated at each call site.
export const backupRun = pgTable(
	"backup_run",
	{
		error: text("error"),
		finishedAt: timestamp("finished_at", { mode: "date" }),
		id: text("id").primaryKey(),
		sizeBytes: integer("size_bytes"),
		startedAt: timestamp("started_at", { mode: "date" }).notNull(),
		// null while the run is still in progress (startedAt set, finishedAt
		// not yet), true/false once finalized.
		success: boolean("success"),
		volumeId: text("volume_id")
			.notNull()
			.references(() => storageVolume.id, { onDelete: "cascade" }),
	},
	(table) => [index("backupRun_volumeId_idx").on(table.volumeId)],
);

// Persisted warn/error-level application log entries, captured by
// $lib/logger.ts's Logger.warn()/error() (best-effort, never blocks the
// caller) so the per-service Errors tab can show app-level failures
// alongside deployment failures, not just deploy failures : see TODO.md.
// serviceId is populated heuristically (message text scanned for a
// "service=<uuid>" token most call sites already include, e.g. deploy/Docker
// logs) rather than threaded explicitly through every one of the ~40
// existing Logger call sites : null means "not attributable to one service",
// still shown on a future instance-wide log view, just not on any one
// service's Errors tab.
export const appLog = pgTable(
	"app_log",
	{
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		id: text("id").primaryKey(),
		level: text("level").$type<"warn" | "error">().notNull(),
		message: text("message").notNull(),
		// JSON-stringified extra args passed to logger.warn()/error(), if any.
		metadata: text("metadata"),
		scope: text("scope"),
		serviceId: text("service_id").references(() => service.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		index("appLog_createdAt_idx").on(table.createdAt),
		index("appLog_serviceId_idx").on(table.serviceId),
	],
);

// The bell-icon feed's backing rows : one per user-facing lifecycle event
// (new deployment, cron auto-redeploy, start/stop, deploy failure, new
// service). Separate from appLog above : appLog is app-internal warn/error
// logging (the Errors tab), this is a curated, user-scoped notification
// feed, written explicitly at each event site rather than derived from logs.
export const notification = pgTable(
	"notification",
	{
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		id: text("id").primaryKey(),
		message: text("message").notNull(),
		readAt: timestamp("read_at", { mode: "date" }),
		serviceId: text("service_id").references(() => service.id, {
			onDelete: "cascade",
		}),
		type: text("type")
			.$type<
				| "deploy_success"
				| "deploy_failure"
				| "service_created"
				| "service_started"
				| "service_stopped"
				| "auto_redeploy"
				| "app_runtime_error"
			>()
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("notification_userId_createdAt_idx").on(
			table.userId,
			table.createdAt,
		),
	],
);

// One user's OAuth connection to one configured git provider (see
// instanceSettings.gitProviders) : the access/refresh token that lets
// $lib/services/git-provider.service.ts list that user's repos and check
// for a Dockerfile when creating a git-based service. providerId references
// a GitProviderConfig.id (not a DB FK, same reasoning as appLog.serviceId
// vs. the JSON-embedded provider configs : see gitProviders' docstring).
export const gitConnection = pgTable(
	"git_connection",
	{
		accessTokenEnc: text("access_token_enc").notNull(),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		// Null for providers whose tokens don't expire (classic GitHub OAuth
		// Apps) : present for GitLab/Gitea/Bitbucket, which do issue
		// short-lived tokens with a refresh token.
		expiresAt: timestamp("expires_at", { mode: "date" }),
		id: text("id").primaryKey(),
		providerId: text("provider_id").notNull(),
		providerKind: text("provider_kind").$type<GitProviderKind>().notNull(),
		// The connected account's own username on that provider : shown in
		// the UI so it's obvious *which* account is connected.
		providerUsername: text("provider_username").notNull(),
		refreshTokenEnc: text("refresh_token_enc"),
		updatedAt: timestamp("updated_at", { mode: "date" })
			.$onUpdate(() => new Date())
			.notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		// One connection per user per provider : reconnecting replaces it
		// rather than accumulating duplicates.
		uniqueIndex("gitConnection_userId_providerId_uidx").on(
			table.userId,
			table.providerId,
		),
	],
);

// One row per user, the Appearance tab's backing store (/profile/appearance)
// : dashboard-only cosmetic preferences, distinct from instanceSettings
// (instance-wide, admin-only config) above. userId is the primary key itself
// rather than a separate id + unique index, since this is genuinely a 1:1
// extension of one user row, same reasoning as a join table's composite key.
export const userPreferences = pgTable("user_preferences", {
	// Nullable hex string ("#rrggbb") overriding the built-in --color-accent
	// CSS var app-wide within (protected)/ : null means "use the built-in
	// default", see (protected)/+layout.svelte.
	accentColor: text("accent_color"),
	createdAt: timestamp("created_at", { mode: "date" }).notNull(),
	// "colorful" (default, today's behavior : each sidebar nav category gets
	// its own distinct color) | "accent" (every category collapses to the one
	// shared accent color instead) : see (protected)/+layout.svelte's
	// categoryColors map.
	sidebarColorIntensity: text("sidebar_color_intensity")
		.$type<"colorful" | "accent">()
		.default("colorful")
		.notNull(),
	// "system" (default, off the OS's own light/dark preference) | "light" |
	// "dark" : applied via the mode-watcher package already mounted in the
	// root layout (src/routes/+layout.svelte), this table is just its
	// account-level persistence layer so the choice follows the user across
	// browsers/devices instead of staying purely in one browser's localStorage.
	theme: text("theme")
		.$type<"light" | "dark" | "system">()
		.default("system")
		.notNull(),
	updatedAt: timestamp("updated_at", { mode: "date" })
		.$onUpdate(() => new Date())
		.notNull(),
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
});

// ─── Relations ─────────────────────────────────────────────────────────────

export const userRelations = relations(user, ({ many }) => ({
	accounts: many(account),
	deployments: many(deployment),
	passkeys: many(passkey),
	projects: many(project),
	services: many(service),
	sessions: many(session),
	storageVolumes: many(storageVolume),
	templates: many(template),
}));

export const projectRelations = relations(project, ({ one, many }) => ({
	services: many(service),
	user: one(user, { fields: [project.userId], references: [user.id] }),
}));

export const templateRelations = relations(template, ({ one, many }) => ({
	owner: one(user, { fields: [template.ownerId], references: [user.id] }),
	links: many(templateLink, { relationName: "templateLinks" }),
}));

export const templateLinkRelations = relations(templateLink, ({ one }) => ({
	linkedTemplate: one(template, {
		fields: [templateLink.linkedTemplateId],
		references: [template.id],
	}),
	template: one(template, {
		fields: [templateLink.templateId],
		references: [template.id],
		relationName: "templateLinks",
	}),
}));

export const serviceRelations = relations(service, ({ one, many }) => ({
	deployments: many(deployment),
	project: one(project, {
		fields: [service.projectId],
		references: [project.id],
	}),
	user: one(user, { fields: [service.userId], references: [user.id] }),
	volumeMounts: many(serviceVolume),
}));

export const deploymentRelations = relations(deployment, ({ one }) => ({
	service: one(service, {
		fields: [deployment.serviceId],
		references: [service.id],
	}),
	user: one(user, { fields: [deployment.userId], references: [user.id] }),
}));

export const storageVolumeRelations = relations(
	storageVolume,
	({ one, many }) => ({
		mounts: many(serviceVolume),
		user: one(user, { fields: [storageVolume.userId], references: [user.id] }),
	}),
);

export const serviceVolumeRelations = relations(serviceVolume, ({ one }) => ({
	service: one(service, {
		fields: [serviceVolume.serviceId],
		references: [service.id],
	}),
	volume: one(storageVolume, {
		fields: [serviceVolume.volumeId],
		references: [storageVolume.id],
	}),
}));

export type UserRole = "user" | "admin";
export type Project = typeof project.$inferSelect;
export type Template = typeof template.$inferSelect;
export type TemplateLink = typeof templateLink.$inferSelect;
export type Service = typeof service.$inferSelect;
export type Deployment = typeof deployment.$inferSelect;
export type InstanceSettings = typeof instanceSettings.$inferSelect;
export type StorageVolume = typeof storageVolume.$inferSelect;
export type S3Destination = typeof s3Destination.$inferSelect;
export type ServiceVolume = typeof serviceVolume.$inferSelect;
export type BackupRun = typeof backupRun.$inferSelect;
export type RemoteHost = typeof remoteHost.$inferSelect;
export type BuildCacheRegistry = typeof buildCacheRegistry.$inferSelect;
export type AppLog = typeof appLog.$inferSelect;
export type Notification = typeof notification.$inferSelect;
export type GitConnection = typeof gitConnection.$inferSelect;
export type UserPreferences = typeof userPreferences.$inferSelect;
export type InvitationBase = typeof invitation.$inferSelect;
export type InvitationRefactored = Omit<InvitationBase, "role">;
export type Invitation = InvitationRefactored & {
	role: UserRole;
};
export type User = typeof user.$inferSelect;

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id],
	}),
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id],
	}),
}));

export const passkeyRelations = relations(passkey, ({ one }) => ({
	user: one(user, {
		fields: [passkey.userId],
		references: [user.id],
	}),
}));
