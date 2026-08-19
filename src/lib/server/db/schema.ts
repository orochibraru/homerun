import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" })
		.default(false)
		.notNull(),
	image: text("image"),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.$onUpdate(() => new Date())
		.notNull(),
	role: text("role"),
	banned: integer("banned", { mode: "boolean" }).default(false),
	banReason: text("ban_reason"),
	banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
});

export const session = sqliteTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => new Date())
			.notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		impersonatedBy: text("impersonated_by"),
	},
	(table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: integer("access_token_expires_at", {
			mode: "timestamp_ms",
		}),
		refreshTokenExpiresAt: integer("refresh_token_expires_at", {
			mode: "timestamp_ms",
		}),
		scope: text("scope"),
		password: text("password"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const apikey = sqliteTable(
	"apikey",
	{
		id: text("id").primaryKey(),
		configId: text("config_id").default("default").notNull(),
		name: text("name"),
		start: text("start"),
		referenceId: text("reference_id").notNull(),
		prefix: text("prefix"),
		key: text("key").notNull(),
		refillInterval: integer("refill_interval"),
		refillAmount: integer("refill_amount"),
		lastRefillAt: integer("last_refill_at", { mode: "timestamp_ms" }),
		enabled: integer("enabled", { mode: "boolean" }).default(true),
		rateLimitEnabled: integer("rate_limit_enabled", {
			mode: "boolean",
		}).default(true),
		rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
		rateLimitMax: integer("rate_limit_max").default(10),
		requestCount: integer("request_count").default(0),
		remaining: integer("remaining"),
		lastRequest: integer("last_request", { mode: "timestamp_ms" }),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
		permissions: text("permissions"),
		metadata: text("metadata"),
	},
	(table) => [
		index("apikey_configId_idx").on(table.configId),
		index("apikey_referenceId_idx").on(table.referenceId),
		index("apikey_key_idx").on(table.key),
	],
);

export const passkey = sqliteTable(
	"passkey",
	{
		id: text("id").primaryKey(),
		name: text("name"),
		publicKey: text("public_key").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		credentialID: text("credential_id").notNull(),
		counter: integer("counter").notNull(),
		deviceType: text("device_type").notNull(),
		backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
		transports: text("transports"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }),
		aaguid: text("aaguid"),
	},
	(table) => [
		index("passkey_userId_idx").on(table.userId),
		index("passkey_credentialID_idx").on(table.credentialID),
	],
);

// ─── Car Mods Domain ──────────────────────────────────────────────────────

export const profile = sqliteTable(
	"profile",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.unique()
			.references(() => user.id, { onDelete: "cascade" }),
		username: text("username").notNull().unique(),
		bio: text("bio"),
		location: text("location"),
		coverImage: text("cover_image"),
		isPublic: integer("is_public", { mode: "boolean" }).default(true).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("profile_userId_idx").on(table.userId)],
);

export const car = sqliteTable(
	"car",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		make: text("make").notNull(),
		model: text("model").notNull(),
		year: integer("year").notNull(),
		trim: text("trim"),
		color: text("color"),
		nickname: text("nickname"),
		description: text("description"),
		coverImage: text("cover_image"),
		isPublic: integer("is_public", { mode: "boolean" })
			.default(false)
			.notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("car_userId_idx").on(table.userId),
		index("car_isPublic_idx").on(table.isPublic),
	],
);

export const mod = sqliteTable(
	"mod",
	{
		id: text("id").primaryKey(),
		carId: text("car_id")
			.notNull()
			.references(() => car.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		// engine | turbo | exhaust | suspension | wheels | brakes
		// exterior | interior | electronics | audio | fuel | transmission | drivetrain | other
		category: text("category").notNull(),
		brand: text("brand"),
		partNumber: text("part_number"),
		// stored in cents to avoid floating-point issues
		price: integer("price").default(0).notNull(),
		laborCost: integer("labor_cost").default(0).notNull(),
		description: text("description"),
		installDate: integer("install_date", { mode: "timestamp_ms" }),
		// planned | installed | removed
		status: text("status").default("installed").notNull(),
		isPublic: integer("is_public", { mode: "boolean" }).default(true).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("mod_carId_idx").on(table.carId),
		index("mod_userId_idx").on(table.userId),
		index("mod_category_idx").on(table.category),
		index("mod_status_idx").on(table.status),
	],
);

export const carImage = sqliteTable(
	"car_image",
	{
		id: text("id").primaryKey(),
		carId: text("car_id")
			.notNull()
			.references(() => car.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		url: text("url").notNull(),
		caption: text("caption"),
		isMain: integer("is_main", { mode: "boolean" }).default(false).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [
		index("car_image_carId_idx").on(table.carId),
		index("car_image_userId_idx").on(table.userId),
	],
);

export const follow = sqliteTable(
	"follow",
	{
		id: text("id").primaryKey(),
		followerId: text("follower_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		followingId: text("following_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [
		index("follow_followerId_idx").on(table.followerId),
		index("follow_followingId_idx").on(table.followingId),
	],
);

export const like = sqliteTable(
	"like",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		carId: text("car_id")
			.notNull()
			.references(() => car.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [
		index("like_userId_idx").on(table.userId),
		index("like_carId_idx").on(table.carId),
	],
);

export const comment = sqliteTable(
	"comment",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		carId: text("car_id")
			.notNull()
			.references(() => car.id, { onDelete: "cascade" }),
		content: text("content").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("comment_userId_idx").on(table.userId),
		index("comment_carId_idx").on(table.carId),
	],
);

// ─── Relations ─────────────────────────────────────────────────────────────

export const userRelations = relations(user, ({ many, one }) => ({
	profile: one(profile, {
		fields: [user.id],
		references: [profile.userId],
	}),
	cars: many(car),
	mods: many(mod),
	followers: many(follow, { relationName: "followers" }),
	following: many(follow, { relationName: "following" }),
	likes: many(like),
	comments: many(comment),
	sessions: many(session),
	accounts: many(account),
	passkeys: many(passkey),
}));

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

export const profileRelations = relations(profile, ({ one }) => ({
	user: one(user, {
		fields: [profile.userId],
		references: [user.id],
	}),
}));

export const carRelations = relations(car, ({ one, many }) => ({
	user: one(user, {
		fields: [car.userId],
		references: [user.id],
	}),
	mods: many(mod),
	images: many(carImage),
	likes: many(like),
	comments: many(comment),
}));

export const carImageRelations = relations(carImage, ({ one }) => ({
	car: one(car, {
		fields: [carImage.carId],
		references: [car.id],
	}),
	user: one(user, {
		fields: [carImage.userId],
		references: [user.id],
	}),
}));

export const modRelations = relations(mod, ({ one }) => ({
	car: one(car, {
		fields: [mod.carId],
		references: [car.id],
	}),
	user: one(user, {
		fields: [mod.userId],
		references: [user.id],
	}),
}));

export const followRelations = relations(follow, ({ one }) => ({
	follower: one(user, {
		fields: [follow.followerId],
		references: [user.id],
		relationName: "followers",
	}),
	following: one(user, {
		fields: [follow.followingId],
		references: [user.id],
		relationName: "following",
	}),
}));

export const likeRelations = relations(like, ({ one }) => ({
	user: one(user, {
		fields: [like.userId],
		references: [user.id],
	}),
	car: one(car, {
		fields: [like.carId],
		references: [car.id],
	}),
}));

export const commentRelations = relations(comment, ({ one }) => ({
	user: one(user, {
		fields: [comment.userId],
		references: [user.id],
	}),
	car: one(car, {
		fields: [comment.carId],
		references: [car.id],
	}),
}));
