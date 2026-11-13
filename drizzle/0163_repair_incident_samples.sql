UPDATE "resource_incident" SET "samples" = (
	SELECT coalesce(jsonb_agg("reading" ORDER BY "outer_index", "inner_index"), '[]'::jsonb)
	FROM jsonb_array_elements(
		CASE WHEN jsonb_typeof("resource_incident"."samples") = 'string' THEN ("resource_incident"."samples" #>> '{}')::jsonb ELSE "resource_incident"."samples" END
	) WITH ORDINALITY AS "outer_items"("item", "outer_index")
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE WHEN jsonb_typeof("item") = 'string' THEN ("item" #>> '{}')::jsonb ELSE jsonb_build_array("item") END
	) WITH ORDINALITY AS "inner_items"("reading", "inner_index")
);
