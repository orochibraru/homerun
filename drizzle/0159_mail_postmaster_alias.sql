INSERT INTO "mail_alias" ("created_at", "destinations", "domain_id", "enabled", "id", "local_part", "updated_at")
SELECT now(), jsonb_build_array("user"."email"), "mail_domain"."id", true, gen_random_uuid()::text, 'postmaster', now()
FROM "mail_domain"
INNER JOIN "user" ON "user"."id" = "mail_domain"."user_id"
WHERE lower("user"."email") <> 'postmaster@' || "mail_domain"."name"
	AND NOT EXISTS (SELECT 1 FROM "mail_alias" WHERE "mail_alias"."domain_id" = "mail_domain"."id" AND "mail_alias"."local_part" = 'postmaster')
	AND NOT EXISTS (SELECT 1 FROM "mail_mailbox" WHERE "mail_mailbox"."domain_id" = "mail_domain"."id" AND "mail_mailbox"."local_part" = 'postmaster');
