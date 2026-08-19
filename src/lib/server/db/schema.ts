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
    containerId: text("container_id"),
    containerPort: integer("container_port").notNull(),
    cpuLimit: text("cpu_limit"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    // pending | pulling | starting | running | stopped | failed
    currentStatus: text("current_status")
      .$type<ContainerStatus>()
      .default("pending")
      .notNull(),
    // running | stopped — the user's intent
    desiredState: text("desired_state")
      .$type<"running" | "stopped">()
      .default("stopped")
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

// ─── Relations ─────────────────────────────────────────────────────────────

export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  deployments: many(deployment),
  passkeys: many(passkey),
  projects: many(project),
  services: many(service),
  sessions: many(session),
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
}));

export const deploymentRelations = relations(deployment, ({ one }) => ({
  service: one(service, {
    fields: [deployment.serviceId],
    references: [service.id],
  }),
  user: one(user, { fields: [deployment.userId], references: [user.id] }),
}));

export type Project = typeof project.$inferSelect;
export type Template = typeof template.$inferSelect;
export type Service = typeof service.$inferSelect;
export type Deployment = typeof deployment.$inferSelect;

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
