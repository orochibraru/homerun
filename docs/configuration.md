# Configuration

Homerun is configured three ways: a few env vars (read once at boot, needed
before anything else is reachable), a YAML config file (`homerun.yaml`, read
once at boot), and `/settings` (admin-only, DB-backed, live, no restart needed),
a set of pages, one per tab (General, Docker, Networking, Email, Authentication)
rather than one long page. Most YAML settings are also live-editable from
`/settings`; a `null`/unset DB value falls back to the file default.

## Env-only

Have to be known before the app can even reach the database or the config file's
own docs are useful. See [`.env.example`](../.env.example).

| Var                                                | Default                                             | Meaning                                                                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                     | `postgres://homerun:homerun@localhost:5432/homerun` | Postgres connection string.                                                                                                                                |
| `PORT`                                             | `3000`                                              | Port the built app listens on.                                                                                                                             |
| `CONFIG_FILE`                                      | `./homerun.yaml`                                    | Path to the YAML config file below.                                                                                                                        |
| `AUTH_SECRET` (falls back to `BETTER_AUTH_SECRET`) | `default-secret`                                    | Session/cookie signing key, and the key every encrypted column derives its encryption key from via `scrypt`. **Change this before running anywhere real.** |

## `homerun.yaml`

Everything else. Copy [`homerun.example.yaml`](../homerun.example.yaml) to
`homerun.yaml` (see `CONFIG_FILE` above for a different path/name) and adjust.
The file has a `$schema` comment (`homerun.schema.json`, generated from the same
zod schema that validates it, `bun run gen`) so an editor with a
YAML-language-server extension gets linting/autocomplete for free.

| Key                                                  | Default                                                | `/settings` tab                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `baseDomain`                                         | `localhost`                                            | General, the domain deployed services get subdomained under (`<slug>.<baseDomain>`)                                          |
| `auth.origin`                                        | _(derived per-request)_                                | General, this app's own public origin                                                                                        |
| `auth.crossSubdomainCookies`                         | `false`                                                | General, scopes the session cookie to `.baseDomain`; see [Users & access](users-and-access.md) before enabling               |
| `authCheckUrl`                                       | `http://host.docker.internal:<PORT>/api/v1/auth-check` | General, where Traefik's forwardAuth middleware checks a gated service's login state                                         |
| `docker.socketPath`                                  | auto-detected                                          | Docker                                                                                                                       |
| `docker.networkName`                                 | `homerun`                                              | Docker                                                                                                                       |
| `traefik.entrypoint`                                 | `websecure`                                            | Networking                                                                                                                   |
| `traefik.certResolver`                               | `letsencrypt`                                          | Networking                                                                                                                   |
| `traefik.dynamicConfigDir`                           | _(unset, feature is a no-op until set)_                | Networking, see [Services: custom domains & SSL](services.md#custom-domains--ssl)                                            |
| `traefik.acmeEmail`                                  | _(unset)_                                              | Networking, informational mirror only, see below                                                                             |
| `smtp.enabled`                                       | `false`                                                | Email                                                                                                                        |
| `smtp.host`/`port`/`user`/`password`/`secure`/`from` | _(unset)_                                              | Email, all required together for `smtp.enabled: true` to take effect; a partial config is treated as disabled with a warning |
| `auth.oauthProviders`                                | `[]`                                                   | Authentication, see [Users & access](users-and-access.md)                                                                    |
| `logLevel`                                           | `info`                                                 | `debug` \| `info` \| `warn` \| `error`                                                                                       |
| `logFormat`                                          | `console`                                              | `console` \| `json`                                                                                                          |

Orchestration mode/autoscaling (Docker tab) and both DNS integrations,
Cloudflare and Pangolin (Networking tab), have **no file form at all**, they're
added, edited, and removed only from `/settings`, secrets among them stored
encrypted the same way `registryPasswordEnc` is, on the singleton
`instance_settings` row.

## Compose-only variables

`compose.yaml`/`compose.prod.yaml` (Traefik + Postgres bootstrap) read a few of
their own, separate from anything above, still plain `.env` since compose itself
has no notion of this app's YAML file:

| Var                                                   | Default                           | Meaning                                                |
| ----------------------------------------------------- | --------------------------------- | ------------------------------------------------------ |
| `ACME_EMAIL`                                          | `admin@example.com`               | Let's Encrypt account email for the ACME cert resolver |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `homerun` / `homerun` / `homerun` | Must match `DATABASE_URL` above if you change them     |

`compose.prod.yaml` bind-mounts `./homerun.yaml` into the app container at
`/app/homerun.yaml`, same directory `.env` lives in.

## First-run wizard vs. `/settings`

The onboarding wizard (see [Getting started](getting-started.md#first-boot))
sets exactly the Core / Docker / Traefik / Email fields above, once, on a fresh
instance, across its own Core/Docker/Traefik/Email/Review steps (which predate,
and aren't the same thing as, the `/settings` General/Docker/
Networking/Email/Authentication tabs above). It calls the same
`InstanceSettingsDTO` methods `/settings` does, so there's nothing the wizard
does that isn't also reachable (and re-editable) from `/settings` afterward.

## A note on lockout

Saving a broken OAuth provider (an unreachable or invalid discovery URL) used to
be able to lock the entire app out, better-auth validates every configured
provider's discovery document on every request that touches auth, including a
plain page load. `/settings`' OAuth save action now validates the discovery URL
before persisting anything, and session lookups degrade to "signed out" instead
of a hard 500 on any other auth-context failure, but if you're editing
`instance_settings` by hand (not through `/settings`), keep this in mind.

## Docker Cleanup

`/docker-cleanup` (admin-only) is host-wide Docker housekeeping from the
dashboard, unlike everything else above it isn't scoped to containers Homerun
created. It previews what's reclaimable, unused images, stopped containers,
unreferenced volumes, unused networks, unused build cache, before you prune, and
lets you prune each category individually or all at once ("Run system prune").
There's no confirmation dialog beyond the preview itself, review what's listed
before clicking a prune button.
