import process from "node:process";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dbCredentials: {
		url:
			process.env.DATABASE_URL ??
			"postgres://homerun:homerun@localhost:5432/homerun",
	},
	dialect: "postgresql",
	out: "./drizzle",
	schema: "./src/lib/server/db/schema.ts",
});
