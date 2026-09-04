CREATE TABLE "template_link" (
	"alias" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"linked_template_id" text NOT NULL,
	"template_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "template_link" ADD CONSTRAINT "template_link_linked_template_id_template_id_fk" FOREIGN KEY ("linked_template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_link" ADD CONSTRAINT "template_link_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "templateLink_templateId_idx" ON "template_link" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templateLink_templateId_alias_uidx" ON "template_link" USING btree ("template_id","alias");