import { relations } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { ContainerStatus } from "$lib/types";

export const user = sqliteTable("user", {
  banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  id: text("id").primaryKey(),
  image: text("image"),
  name: text("name").notNull(),
  role: text("role"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = sqliteTable(
  "session",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    impersonatedBy: text("impersonated_by"),
    ipAddress: text("ip_address"),
    token: text("token").notNull().unique(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
);

export const account = sqliteTable(
  "account",
  {
    accessToken: text("access_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    accountId: text("account_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    idToken: text("id_token"),
    issuer: text("issuer").notNull(),
    password: text("password"),
    providerId: text("provider_id").notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("account_issuer_accountId_uidx").on(
      table.issuer,
      table.accountId
    ),
    index("account_userId_idx").on(table.userId),
  ]
);

export const verification = sqliteTable(
  "verification",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    value: text("value").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

export const apikey = sqliteTable(
  "apikey",
  {
    configId: text("config_id").default("default").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).default(true),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    lastRefillAt: integer("last_refill_at", { mode: "timestamp_ms" }),
    lastRequest: integer("last_request", { mode: "timestamp_ms" }),
    metadata: text("metadata"),
    name: text("name"),
    permissions: text("permissions"),
    prefix: text("prefix"),
    rateLimitEnabled: integer("rate_limit_enabled", {
      mode: "boolean",
    }).default(true),
    rateLimitMax: integer("rate_limit_max").default(10),
    rateLimitTimeWindow: integer("rate_limit_time_window").default(86_400_000),
    referenceId: text("reference_id").notNull(),
    refillAmount: integer("refill_amount"),
    refillInterval: integer("refill_interval"),
    remaining: integer("remaining"),
    requestCount: integer("request_count").default(0),
    start: text("start"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("apikey_configId_idx").on(table.configId),
    index("apikey_referenceId_idx").on(table.referenceId),
    index("apikey_key_idx").on(table.key),
  ]
);

export const passkey = sqliteTable(
  "passkey",
  {
    aaguid: text("aaguid"),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
    counter: integer("counter").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
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
  ]
);

// ─── PaaS Domain ────────────────────────────────────────────────────────────

export const project = sqliteTable(
  "project",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    description: text("description"),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // DNS-safe prefix applied to every member service's container name and
    // subdomain (e.g. "<projectSlug>-<serviceSlug>.<baseDomain>") — see
    // docker/service.ts's containerName() and docker/labels.ts.
    slug: text("slug").notNull().unique(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("project_userId_idx").on(table.userId)]
);

export const template = sqliteTable(
  "template",
  {
    category: text("category"), // "database" | "cache" | "monitoring" | "automation" | "other"
    containerPort: integer("container_port").notNull(),
    cpuLimit: text("cpu_limit"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    description: text("description"),
    envVars: text("env_vars", { mode: "json" })
      .$type<Record<string, string>>()
      .default({}),
    icon: text("icon"), // lucide icon name, looked up the same way SERVICE_STATUS_CONFIG maps a key to an icon component
    id: text("id").primaryKey(),
    image: text("image").notNull(),
    memoryLimitMb: integer("memory_limit_mb"),
    name: text("name").notNull(),
    // null = built-in (seeded), immutable — not owned by any user
    ownerId: text("owner_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    restartPolicy: text("restart_policy").default("unless-stopped").notNull(),
    tag: text("tag").default("latest").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("template_ownerId_idx").on(table.ownerId)]
);

export const service = sqliteTable(
  "service",
  {
    // When true, a Traefik forwardAuth middleware gatekeeps this service
    // behind this app's own login (any provider, including a configured
    // OIDC one) — see docker/labels.ts and /api/v1/auth-check.
    authRequired: integer("auth_required", { mode: "boolean" })
      .default(false)
      .notNull(),
    containerId: text("container_id"),
    containerPort: integer("container_port").notNull(),
    cpuLimit: text("cpu_limit"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    // Standard 5-field cron expression ("min hour day month weekday"),
    // evaluated in the server's local time — see $lib/server/cron.ts.
    // Null/disabled unless the user opts in via the Overview tab.
    cronEnabled: integer("cron_enabled", { mode: "boolean" })
      .default(false)
      .notNull(),
    cronLastRunAt: integer("cron_last_run_at", { mode: "timestamp_ms" }),
    cronSchedule: text("cron_schedule"),
    // pending | pulling | starting | running | stopped | failed
    currentStatus: text("current_status")
      .$type<ContainerStatus>()
      .default("pending")
      .notNull(),
    // Optional second hostname routed to this service (its own DNS A/CNAME
    // must already point at this host — the app doesn't manage that).
    // Only takes effect when dnsResolvable is true.
    customDomain: text("custom_domain").unique(),
    // running | stopped — the user's intent
    desiredState: text("desired_state")
      .$type<"running" | "stopped">()
      .default("stopped")
      .notNull(),
    // When false, no Traefik router/service labels are attached at deploy
    // time — the container never gets a public <slug>.<baseDomain>, only
    // reachable over the internal network(s) it's attached to (the shared
    // network by slug alias, plus its project's network if any).
    dnsResolvable: integer("dns_resolvable", { mode: "boolean" })
      .default(true)
      .notNull(),
    envVars: text("env_vars", { mode: "json" })
      .$type<Record<string, string>>()
      .default({}),
    id: text("id").primaryKey(),
    // e.g. "ghcr.io/acme/api"
    image: text("image").notNull(),
    memoryLimitMb: integer("memory_limit_mb"),
    name: text("name").notNull(),
    // nullable — grouping is opt-in, ungrouped services stay valid
    projectId: text("project_id").references(() => project.id, {
      onDelete: "set null",
    }),
    // AES-256-GCM ciphertext — see $lib/server/docker/secrets
    registryPasswordEnc: text("registry_password_enc"),
    registryUrl: text("registry_url"),
    registryUsername: text("registry_username"),
    // no | always | on-failure | unless-stopped
    restartPolicy: text("restart_policy").default("unless-stopped").notNull(),
    // subdomain: <slug>.<baseDomain>
    slug: text("slug").notNull().unique(),
    tag: text("tag").default("latest").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
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
  ]
);

export const deployment = sqliteTable(
  "deployment",
  {
    containerId: text("container_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    errorMessage: text("error_message"),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    id: text("id").primaryKey(),
    imageDigest: text("image_digest"),
    // Progress lines appended live during deploy ("Pulling image...",
    // "Starting container...") — polled by the Overview tab while a deploy
    // is in flight, kept around after for a lightweight audit trail.
    log: text("log").default(""),
    serviceId: text("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "cascade" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
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
  ]
);

export const storageVolume = sqliteTable(
  "storage_volume",
  {
    backupAccessKeyId: text("backup_access_key_id"),
    // Cron expression for scheduled backups, evaluated by the same
    // scheduler tick as service redeploys — see $lib/server/cron.ts.
    backupBucket: text("backup_bucket"),
    // AES-256-GCM ciphertext, same scheme as service.registryPasswordEnc.
    backupEnabled: integer("backup_enabled", { mode: "boolean" })
      .default(false)
      .notNull(),
    // S3-compatible endpoint, e.g. "https://s3.us-east-1.amazonaws.com" or
    // a self-hosted MinIO URL. Bind-mount sources only for now — Docker
    // named volumes aren't backed up yet (see backup.ts).
    backupEndpoint: text("backup_endpoint"),
    backupLastRunAt: integer("backup_last_run_at", { mode: "timestamp_ms" }),
    backupPrefix: text("backup_prefix"),
    backupRegion: text("backup_region"),
    backupSchedule: text("backup_schedule"),
    backupSecretAccessKeyEnc: text("backup_secret_access_key_enc"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    description: text("description"),
    id: text("id").primaryKey(),
    // Docker Binds source: either a bind-mount host path ("/mnt/data/foo")
    // or a Docker-managed named volume ("localrun-vol-xyz") — same field,
    // Docker's Binds syntax tells them apart by whether it looks like a
    // path. `kind` just drives which the create form asks for.
    // "bind" | "volume"
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    source: text("source").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("storageVolume_userId_idx").on(table.userId)]
);

// One storage volume can be mounted into several services — that's what
// makes it "shared" across a project, no separate project-level concept
// needed (see TODO.md).
export const serviceVolume = sqliteTable(
  "service_volume",
  {
    containerPath: text("container_path").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    readOnly: integer("read_only", { mode: "boolean" })
      .default(false)
      .notNull(),
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
  ]
);

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

export const templateRelations = relations(template, ({ one }) => ({
  owner: one(user, { fields: [template.ownerId], references: [user.id] }),
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
  })
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

export type Project = typeof project.$inferSelect;
export type Template = typeof template.$inferSelect;
export type Service = typeof service.$inferSelect;
export type Deployment = typeof deployment.$inferSelect;
export type StorageVolume = typeof storageVolume.$inferSelect;
export type ServiceVolume = typeof serviceVolume.$inferSelect;

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
