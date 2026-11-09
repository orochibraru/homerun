<!-- vale off -->

# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] Revision health (`src/lib/revisions.ts`) and update trials
      (`update-trial.service.ts`) still report a bare "exited with code N": give
      them the deploy's exit-code meaning and last output too.
- [ ] Live log viewer keeps every streamed line (and every line held while
      paused) in memory for as long as the page is open; cap it to the last few
      thousand lines so a fast-logging service can't bloat the tab.
- [ ] Volume disks: the deploy wizard's Volumes step and template/compose
      volumes can't pick a disk yet, and the REST API, MCP and CLI have no way
      to list the host's disks; only Storage → New volume and the service and
      cron job dialogs show the picker.

- [ ] Volume disks: Docker Cleanup can prune an unmounted disk-placed volume
      (its data stays on the disk); a deploy puts it back, a cron job run
      doesn't and lets Docker create it under its data root. Place it before a
      cron run too.

- [ ] Duplicating a volume on a mount edit copies it during the next deploy,
      while the old container still runs: stop the service around the copy so a
      database's copy is consistent without the user stopping it by hand.
- [ ] #113 is back on 1.0.72: a fresh git build published to a private cache
      registry reportedly fails on swarm worker nodes with "No such image". The
      typed SDK keeps `X-Registry-Auth` on service create, update, restart and
      scale against a real daemon; needs the failing deploy's log (image ref,
      build kind) to find where the credentials go missing.

- [ ] PWA: the dashboard isn't installable; add a web app manifest (name,
      `start_url`, `display: standalone`, 192/512 and maskable icons, theme
      colors), link it plus `theme-color` and `apple-touch-icon` from
      `app.html`, and let the service worker serve an offline fallback page

- [ ] Mobile: `SectionNav` subtabs (container, environments, observability,
      bucket, run pages) are still a scrolling strip below `md`; give them the
      same nav-card hub `TabNav` got

- [ ] Mobile: the `TabNav` hub now shows a description and a live summary per
      row, but only the service page fills them; give the other hubs (stack,
      settings, profile, monitoring, workstation, …) the same

- [ ] Git providers: the Add provider form (and the GitHub App manifest flow)
      still sits on top of the list; move it to `/git-providers/new`

- [ ] CLAUDE.md and the check-repo skill say `bun run type-check`, but the
      package.json script is `typecheck`; make them agree

- [ ] Backup destination capacity: on an SFTP or WebDAV box with automatic
      snapshots, `rclone about` reports used as live files only, so the size
      shown is used + free and space held by snapshots is invisible; say so on
      the Storage panel, and in the docs: deleted backups only free space once
      the snapshots holding them are gone

- [ ] Storage Box integration tests never delete what they upload: each run
      leaves its restic repositories under `homerun-it/<type>/` in the
      configured location; purge that prefix after the round trip

- [ ] Backup cleanup skips backups of deleted volumes: they stay on the
      destination forever; offer to delete them when a volume is deleted, or
      list them as orphans on the destination's page

- [ ] IaC: the Terraform provider and HCL generator don't carry a service's
      `swarmPlacement` yet (an object attribute, which `iac/resources.ts`'s
      attribute kinds can't express); add it so drift and import see placement

- [ ] `bun run test` fails on a clean main: bun's per-file 80% coverage
      threshold trips on `backup-queue.ts`, `domain-takeover.ts` and
      `service-settings.service.ts`; cover them or exclude them

- [ ] MCP templates left out because they exit at boot when their app isn't
      reachable, so a headless Templates E2E deploy can't pass: Navidrome
      (Blakeem), AdGuard Home (Samik081), Miniflux (tssujt), Forgejo
      (agentic-forges), Pocket ID (vplme) and Google's MCP Toolbox for
      Databases. Portainer's official one pins a Portainer minor
      (`portainer-mcp:2.45`) against a template on `latest`. Revisit if they
      gain a lazy connect, or if the suite learns to deploy a template next to
      its app.

## Medium

- [ ] Mail server: an outbound relay (smarthost) setting, docker-mailserver's
      `RELAY_HOST`/`RELAY_PORT`/`RELAY_USER`/`RELAY_PASSWORD`, for hosts whose
      outbound port 25 is blocked or whose IP has no matching reverse DNS (a
      home server behind Pangolin sends from its own IP)
- [ ] Mail server: no REST API, MCP tools or CLI commands for mail domains,
      mailboxes and aliases yet; add them like the registry's
- [ ] Mail server: verify the whole path against a live docker-mailserver
      (bcrypt `{BLF-CRYPT}` sign-in, rspamd DKIM signing with the path template,
      `acme.json` extraction when Traefik issued a wildcard)
- [ ] Mail server: real client IPs behind Pangolin; the raw TCP resources don't
      send PROXY protocol, so Postfix and rspamd see the tunnel's address and
      IP-based checks (RBLs, SPF) don't work
- [ ] Mail server: the self-test probes port 25 from the Homerun host, which
      fails on home connections whose ISP blocks outbound 25 even when the
      internet reaches it fine; say so instead of reporting it as broken
- [ ] Mail server: a way for a mailbox owner to change their own password
- [ ] Mail server: offer the `homerun-mail-data` volume to Backups like a
      service volume

- [ ] Service Logs tab: a log-volume strip over the lines (errors in red), like
      the lanes on the Overview tab

- [ ] Log history only follows services: workstations and Homerun's own
      containers (Traefik, the app, the worker) still lose their output on
      recreate; give them the same shipper

- [ ] Pipelines: expose watched repositories, their CI runs and stats in the
      REST API, MCP server and CLI, and sync on the provider's workflow webhook
      instead of only polling

## Large

- [ ] Pulumi projects: generate a Pulumi program
      (`new homerun.X(..., { import })`) from the inventory like the HCL
      generator, and a drift check reading Pulumi's checkpoint from the bucket

- [ ] Package registries: run language package registries (npm first, then PyPI,
      Maven, Cargo...) from Homerun as core services like the Docker registry,
      with tokens and an optional public hostname, listed under Registries in
      the sidebar next to Docker Registry
