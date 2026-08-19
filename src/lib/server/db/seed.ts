import { db } from "$lib/server/db/lib";
import { template } from "$lib/server/db/schema";

interface BuiltinTemplate {
  category: string;
  containerPort: number;
  description: string;
  envVars: Record<string, string>;
  icon: string;
  id: string;
  image: string;
  name: string;
  tag: string;
}

// ownerId: null = built-in, immutable, usable by every user. Fixed ids +
// onConflictDoNothing() make this idempotent — safe to call on every boot.
const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    category: "cache",
    containerPort: 6379,
    description: "In-memory key-value store. Unauthenticated by default.",
    envVars: {},
    icon: "database",
    id: "builtin-redis",
    image: "redis",
    name: "Redis",
    tag: "alpine",
  },
  {
    category: "database",
    containerPort: 5432,
    description:
      "Relational database. Review the placeholder password before deploying.",
    envVars: {
      POSTGRES_DB: "app",
      POSTGRES_PASSWORD: "changeme",
      POSTGRES_USER: "postgres",
    },
    icon: "database",
    id: "builtin-postgres",
    image: "postgres",
    name: "PostgreSQL",
    tag: "16-alpine",
  },
  {
    category: "database",
    containerPort: 3306,
    description:
      "Relational database. Review the placeholder password before deploying.",
    envVars: {
      MYSQL_DATABASE: "app",
      MYSQL_ROOT_PASSWORD: "changeme",
    },
    icon: "database",
    id: "builtin-mysql",
    image: "mysql",
    name: "MySQL",
    tag: "8",
  },
  {
    category: "database",
    containerPort: 27_017,
    description:
      "Document database. Review the placeholder password before deploying.",
    envVars: {
      MONGO_INITDB_ROOT_PASSWORD: "changeme",
      MONGO_INITDB_ROOT_USERNAME: "admin",
    },
    icon: "database",
    id: "builtin-mongodb",
    image: "mongo",
    name: "MongoDB",
    tag: "7",
  },
  {
    category: "other",
    containerPort: 8080,
    description:
      "Lightweight database admin UI (works with Postgres/MySQL/etc).",
    envVars: {},
    icon: "table",
    id: "builtin-adminer",
    image: "adminer",
    name: "Adminer",
    tag: "latest",
  },
  {
    category: "monitoring",
    containerPort: 3001,
    description: "Self-hosted uptime monitoring with status pages.",
    envVars: {},
    icon: "activity",
    id: "builtin-uptime-kuma",
    image: "louislam/uptime-kuma",
    name: "Uptime Kuma",
    tag: "1",
  },
  {
    category: "automation",
    containerPort: 5678,
    description: "Workflow automation tool.",
    envVars: {},
    icon: "workflow",
    id: "builtin-n8n",
    image: "n8nio/n8n",
    name: "n8n",
    tag: "latest",
  },
  {
    category: "other",
    containerPort: 80,
    description: "Self-hosted password manager (Bitwarden-compatible server).",
    envVars: {},
    icon: "lock",
    id: "builtin-vaultwarden",
    image: "vaultwarden/server",
    name: "Vaultwarden",
    tag: "latest",
  },
];

export async function seedBuiltinTemplates(): Promise<void> {
  const now = new Date();
  await db
    .insert(template)
    .values(
      BUILTIN_TEMPLATES.map((t) => ({
        ...t,
        createdAt: now,
        ownerId: null,
        restartPolicy: "unless-stopped" as const,
        updatedAt: now,
      }))
    )
    .onConflictDoNothing();
}
