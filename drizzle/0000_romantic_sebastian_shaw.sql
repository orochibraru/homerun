CREATE TABLE "account" (
	"access_token" text,
	"access_token_expires_at" timestamp,
	"account_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"id_token" text,
	"issuer" text NOT NULL,
	"password" text,
	"provider_id" text NOT NULL,
	"refresh_token" text,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"config_id" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp NOT NULL,
	"enabled" boolean DEFAULT true,
	"expires_at" timestamp,
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"last_refill_at" timestamp,
	"last_request" timestamp,
	"metadata" text,
	"name" text,
	"permissions" text,
	"prefix" text,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_max" integer DEFAULT 10,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"reference_id" text NOT NULL,
	"refill_amount" integer,
	"refill_interval" integer,
	"remaining" integer,
	"request_count" integer DEFAULT 0,
	"start" text,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_log" (
	"created_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"metadata" text,
	"scope" text,
	"service_id" text
);
--> statement-breakpoint
CREATE TABLE "deployment" (
	"container_id" text,
	"created_at" timestamp NOT NULL,
	"error_message" text,
	"finished_at" timestamp,
	"id" text PRIMARY KEY NOT NULL,
	"image_digest" text,
	"log" text DEFAULT '',
	"service_id" text NOT NULL,
	"started_at" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"auth_check_url" text,
	"auth_cross_subdomain_cookies" boolean,
	"auth_origin" text,
	"base_domain" text,
	"created_at" timestamp NOT NULL,
	"docker_network_name" text,
	"docker_socket_path" text,
	"id" text PRIMARY KEY NOT NULL,
	"oauth_providers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"onboarding_completed_at" timestamp,
	"smtp_enabled" boolean,
	"smtp_from" text,
	"smtp_host" text,
	"smtp_password_enc" text,
	"smtp_port" integer,
	"smtp_secure" boolean,
	"smtp_user" text,
	"traefik_cert_resolver" text,
	"traefik_dynamic_config_dir" text,
	"traefik_entrypoint" text,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"accepted_at" timestamp,
	"created_at" timestamp NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"role" text NOT NULL,
	"token" text NOT NULL,
	CONSTRAINT "invitation_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"aaguid" text,
	"backed_up" boolean NOT NULL,
	"counter" integer NOT NULL,
	"created_at" timestamp,
	"credential_id" text NOT NULL,
	"device_type" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"transports" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"created_at" timestamp NOT NULL,
	"description" text,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "project_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "remote_host" (
	"created_at" timestamp NOT NULL,
	"docker_host" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tls_ca_enc" text,
	"tls_cert_enc" text,
	"tls_key_enc" text,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service" (
	"auth_required" boolean DEFAULT false NOT NULL,
	"build_source" text DEFAULT 'image' NOT NULL,
	"container_id" text,
	"container_port" integer NOT NULL,
	"cpu_limit" text,
	"created_at" timestamp NOT NULL,
	"cron_enabled" boolean DEFAULT false NOT NULL,
	"cron_last_run_at" timestamp,
	"cron_schedule" text,
	"current_status" text DEFAULT 'pending' NOT NULL,
	"custom_domain" text,
	"custom_ssl_cert_enc" text,
	"custom_ssl_key_enc" text,
	"desired_state" text DEFAULT 'stopped' NOT NULL,
	"dns_resolvable" boolean DEFAULT true NOT NULL,
	"env_vars" jsonb DEFAULT '{}'::jsonb,
	"git_build_context" text,
	"git_dockerfile_path" text,
	"git_ref" text,
	"git_url" text,
	"id" text PRIMARY KEY NOT NULL,
	"image" text NOT NULL,
	"memory_limit_mb" integer,
	"name" text NOT NULL,
	"project_id" text,
	"registry_password_enc" text,
	"registry_url" text,
	"registry_username" text,
	"remote_host_id" text,
	"restart_policy" text DEFAULT 'unless-stopped' NOT NULL,
	"slug" text NOT NULL,
	"tag" text DEFAULT 'latest' NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "service_custom_domain_unique" UNIQUE("custom_domain"),
	CONSTRAINT "service_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "service_volume" (
	"container_path" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"read_only" boolean DEFAULT false NOT NULL,
	"service_id" text NOT NULL,
	"volume_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"impersonated_by" text,
	"ip_address" text,
	"token" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "storage_volume" (
	"backup_access_key_id" text,
	"backup_bucket" text,
	"backup_enabled" boolean DEFAULT false NOT NULL,
	"backup_endpoint" text,
	"backup_last_run_at" timestamp,
	"backup_prefix" text,
	"backup_region" text,
	"backup_schedule" text,
	"backup_secret_access_key_enc" text,
	"created_at" timestamp NOT NULL,
	"description" text,
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template" (
	"category" text,
	"container_port" integer NOT NULL,
	"cpu_limit" text,
	"created_at" timestamp NOT NULL,
	"description" text,
	"env_vars" jsonb DEFAULT '{}'::jsonb,
	"icon" text,
	"id" text PRIMARY KEY NOT NULL,
	"image" text NOT NULL,
	"memory_limit_mb" integer,
	"name" text NOT NULL,
	"owner_id" text,
	"restart_policy" text DEFAULT 'unless-stopped' NOT NULL,
	"tag" text DEFAULT 'latest' NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"ban_expires" timestamp,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"created_at" timestamp NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"image" text,
	"name" text NOT NULL,
	"role" text,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_log" ADD CONSTRAINT "app_log_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remote_host" ADD CONSTRAINT "remote_host_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_remote_host_id_remote_host_id_fk" FOREIGN KEY ("remote_host_id") REFERENCES "public"."remote_host"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_volume" ADD CONSTRAINT "service_volume_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_volume" ADD CONSTRAINT "service_volume_volume_id_storage_volume_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."storage_volume"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_volume" ADD CONSTRAINT "storage_volume_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "appLog_createdAt_idx" ON "app_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "appLog_serviceId_idx" ON "app_log" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "deployment_serviceId_idx" ON "deployment" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "deployment_userId_idx" ON "deployment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credentialID_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "project_userId_idx" ON "project" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "remoteHost_userId_idx" ON "remote_host" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "service_userId_idx" ON "service" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "service_slug_idx" ON "service" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "service_projectId_idx" ON "service" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "serviceVolume_serviceId_idx" ON "service_volume" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "serviceVolume_volumeId_idx" ON "service_volume" USING btree ("volume_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "storageVolume_userId_idx" ON "storage_volume" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "template_ownerId_idx" ON "template" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");