# Configuration

Homerun is configured two ways: environment variables (read once at boot), and a `/settings` page (admin-only, DB-backed, live — no restart needed). Most settings exist in both places; a `null`/unset DB value falls back to the env default. See [`.env.example`](../.env.example) at the repo root for a copy-pasteable starting point.

## Env-only (not editable from `/settings`)

These have to be known before the app can even reach the database, or would be circular if they lived in it:

| Var | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgres://homerun:homerun@localhost:5432/homerun` | Postgres connection string. Required — there's no SQLite fallback. |
| `PORT` | `3000` | Port the built app listens on (`bun run start`). Not used by `vite dev`, which always uses 5173. |
| `AUTH_SECRET` (falls back to `BETTER_AUTH_SECRET`) | `default-secret` | Session/cookie signing key, and the key every encrypted column (`registryPasswordEnc`, OAuth client secrets, S3 keys, etc.) derives its encryption key from via `scrypt`. **Change this before running anywhere real** — both names are honored, `BETTER_AUTH_SECRET` because that's what better-auth's own `auth generate` CLI writes. |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error`. |
| `LOG_FORMAT` | `console` | `console` \| `json`. |

## Env defaults, live-editable from `/settings`

Everything else starts from an env var but can be overridden per-instance from the dashboard without a restart — a saved change re-merges over the env baseline immediately (`applyInstanceSettings()`), so clearing the DB override reverts cleanly to the env value rather than going stale.

| Var | Default | `/settings` section |
|---|---|---|
| `BASE_DOMAIN` | `localhost` | Core — the domain deployed services get subdomained under (`<slug>.<baseDomain>`) |
| `ORIGIN` | `http://localhost:3000` | Core — this app's own public origin |
| `AUTH_CROSS_SUBDOMAIN` | `false` | Core — scopes the session cookie to `.baseDomain`; see [Users & access](users-and-access.md) before enabling |
| `AUTH_CHECK_URL` | `http://host.docker.internal:<PORT>/api/v1/auth-check` | Core — where Traefik's forwardAuth middleware checks a gated service's login state |
| `DOCKER_SOCKET_PATH` | `/var/run/docker.sock` | Docker |
| `DOCKER_NETWORK_NAME` | `homerun-network` | Docker |
| `TRAEFIK_ENTRYPOINT` | `websecure` | Traefik |
| `TRAEFIK_CERT_RESOLVER` | `letsencrypt` | Traefik |
| `TRAEFIK_DYNAMIC_CONFIG_DIR` | _(unset — feature is a no-op until set)_ | Traefik — see [Services: custom domains & SSL](services.md#custom-domains--ssl) |
| `SMTP_ENABLED` | `false` | Email |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_SECURE` / `SMTP_FROM` | _(unset)_ | Email — all required together for `SMTP_ENABLED=true` to actually take effect; a partial config is treated as disabled with a warning |
| OAuth providers | _(none)_ | Configured entirely from `/settings`, not env vars — see [Users & access](users-and-access.md) |

OAuth providers are the one setting with **no env-var form at all** — they're added, edited, and removed only from `/settings`, stored as an encrypted JSON array on the singleton `instance_settings` row.

## Compose-only variables

`compose.yaml` (Traefik + Postgres bootstrap) reads a few of its own, separate from anything above:

| Var | Default | Meaning |
|---|---|---|
| `ACME_EMAIL` | `admin@example.com` | Let's Encrypt account email for the ACME cert resolver |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `homerun` / `homerun` / `homerun` | Must match `DATABASE_URL` above if you change them |

## First-run wizard vs. `/settings`

The onboarding wizard (see [Getting started](getting-started.md#first-boot)) sets exactly the Core / Docker / Traefik / Email sections above, once, on a fresh instance — it calls the same `InstanceSettingsDTO` methods `/settings` does, so there's nothing the wizard does that isn't also reachable (and re-editable) from `/settings` afterward.

## A note on lockout

Saving a broken OAuth provider (an unreachable or invalid discovery URL) used to be able to lock the entire app out — better-auth validates every configured provider's discovery document on every request that touches auth, including a plain page load. `/settings`' OAuth save action now validates the discovery URL before persisting anything, and session lookups degrade to "signed out" instead of a hard 500 on any other auth-context failure — but if you're editing `instance_settings` by hand (not through `/settings`), keep this in mind.
