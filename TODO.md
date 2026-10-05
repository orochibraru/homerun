<!-- vale off -->

# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] One bun unit test failed once in the stop hook's `bun run test` (1619
      pass, 1 fail) and not in 22 reruns since. The gate now prints `(fail)`
      lines and below-threshold coverage rows first, so the next failure names
      it: fix that test then.
- [ ] Since we have branding on custom traefik pages, let's also apply it to the
      custom authentication pages for a service, whitelabelling included.
- [ ] Make UI nicer and easier to navigate on the registry page for images.
- [ ] Registry page: stream + paginate images when loading the page, page load
      takes too long.

## Medium

- [ ] **[WIP]** Security: add a paths filter glob pattern matchers in the
      security tab of a service to block access to certain pages. In the same
      spirit, let's add the ability to filter paths for authentication. Let's
      also add the ability to completely ban IPs if trying to access a blocked
      pattern too many times. For patterns add presets such as Wordpress (wp-
      stuff) or simply a default list with in it sensitive files (.env, .git,
      .git-credentials)

## Large

- [ ] **S3 storage service, the base for IaC state.** A dedicated S3 page where
      users create and manage buckets, backed either by a built-in object store
      (dxflrs/garage, run by Homerun like the built-in registry) or by a
      connected cloud provider (AWS S3, GCP, Hetzner Object Storage, any
      S3-compatible endpoint). Access keys per bucket, usage, lifecycle. On top
      of it, state management so Terraform and Pulumi state never needs a paid
      backend: a state bucket per project, locking (a DynamoDB-compatible lock
      table or Terraform's S3 native lockfile), state versions with diff and
      rollback, and who changed what. Possibly volume backups and volumes
      themselves on the same store later. The sidebar gets a **Storage**
      category grouping Volumes, Backups, Backup Destinations and the new S3
      page.

- [ ] **Homerun as infrastructure as code (after the S3 service).** A Terraform
      provider and a Pulumi provider (a bridged Terraform one, or native) that
      scaffold everything the dashboard can: stacks, services and their
      dependencies, databases from templates, and every service setting (source,
      build, environment variables, limits, networking and domains, volumes,
      healthcheck, runtime, revisions and rollback, previews, release channels,
      environments, login wall, cron), plus instance-level objects (DNS
      providers, git providers, notification channels, backup destinations,
      redirects). Needs the REST API to cover every one of those settings first
      (an audit of what `/api/v1` and the OpenAPI document are missing), stable
      ids, and import of existing resources. A dedicated IaC page in the
      dashboard: generate a starter configuration from what's running, point at
      the state bucket, show drift between the state and the instance.

- [ ] **Simple and advanced UI modes (once S3 and IaC land).** Two ways to run
      the dashboard, switchable per instance or per account. **Simple** is for
      homelab enthusiasts: self-hosting through click-ops, a short sidebar,
      templates and one-click deploys up front, sensible defaults and the
      engineering settings out of sight. **Advanced** shows the full cloud
      feature set for engineering work: environments, release channels,
      previews, IaC and state, S3, build servers, revisions, observability in
      depth. Decide what each mode hides (routes, tabs, sections, settings)
      without forking pages: a feature hidden in simple mode keeps working, it
      just isn't in the way.
