# Migrating from Dokploy or Coolify

**Settings → Migrate** (admin-only) reads another PaaS instance and recreates
what it finds here. Pick Dokploy or Coolify, give it the instance URL and an API
token, and **Read instance** lists every application, compose stack and
database, grouped by the project it lives in. It only ever makes read requests:
nothing on the other side is stopped, changed or deleted, and the token is sent
with each request on that page, never stored.

Tick what you want and **Import**. Each source project becomes a Homerun stack,
and every entry goes through the same importer as
[Importing a compose file](compose-import.md), so volumes, slugs and warnings
behave the same way. Nothing is deployed: each imported service waits until you
deploy it.

What carries over:

- **Docker image apps**: image and tag, env vars, the port of their first domain
  (public) or internal-only when they had no domain, CPU/memory limits,
  named-volume and bind mounts, and Dokploy's private registry credentials.
- **Start commands**: a Dokploy command runs through `/bin/sh -c` and its
  arguments replace the image's, the same way Dokploy starts it. On Coolify,
  `start_command` becomes the container command, and the custom docker run
  options Homerun can apply (`--cap-add`, `--device`, `--privileged`, `--label`,
  `--entrypoint`) land on the [Runtime tab](runtime-and-compute.md#runtime); any
  other flag is a warning.
- **File mounts and storage**: a Dokploy file mount (on an app, a database, or
  bound from a compose stack's `../files/` directory) is written under
  `/var/lib/homerun/files/<slug>/` on this host and bind-mounted read-only at
  the same path. Coolify persistent volumes, host binds and file storages come
  across the same way when Coolify's API lists them.
- **Git apps**: become
  [git-based](deploy-source-and-builds.md#deploy-source-image-or-git-repo)
  services with the repository, branch, build context and
  [build method](deploy-source-and-builds.md#build-methods): a Dockerfile (with
  its path), Nixpacks, Railpack, or Dokploy's Heroku and Paketo buildpacks.
  Custom install or build commands set on Coolify aren't carried over, put them
  in the builder's config file in the repository. A private repository needs a
  [connected git provider](git-providers.md).
- **Compose stacks**: the stored compose file, with the stack's own variables
  substituted in. On Dokploy, each domain's port is applied to the service it
  targets, and named volumes keep pointing at the data Dokploy created
  (`<appName>_<volume>`, or the volume's own `name:`/`external` declaration).
- **Databases**: the image, the port, and the credentials turned into the
  image's own env vars (`POSTGRES_PASSWORD`, `MYSQL_ROOT_PASSWORD`, ...), always
  internal-only. A Redis, KeyDB or Dragonfly password is applied through the
  start command, the way both platforms set it.

What doesn't, and shows up as a blocked entry or a warning instead: apps built
with a static build pack, and compose stacks read from a repository at deploy
time. Coolify doesn't expose registry credentials, and older Coolify versions
don't list persistent storage in their API: the import says so, re-attach those
volumes by hand.

For Dokploy, create the token under **Settings → Profile → API/CLI**. For
Coolify, create it under **Keys & Tokens** with the `read` and `read:sensitive`
permissions: without `read:sensitive`, env values and database passwords come
back hidden.
