<!-- vale off -->

# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] #113 is back on 1.0.72: a fresh git build published to a private cache
      registry reportedly fails on swarm worker nodes with "No such image". The
      typed SDK keeps `X-Registry-Auth` on service create, update, restart and
      scale against a real daemon; needs the failing deploy's log (image ref,
      build kind) to find where the credentials go missing.

- [ ] MCP templates left out because they exit at boot when their app isn't
      reachable, so a headless Templates E2E deploy can't pass: Navidrome
      (Blakeem), AdGuard Home (Samik081), Miniflux (tssujt), Forgejo
      (agentic-forges), Pocket ID (vplme) and Google's MCP Toolbox for
      Databases. Portainer's official one pins a Portainer minor
      (`portainer-mcp:2.45`) against a template on `latest`. Revisit if they
      gain a lazy connect, or if the suite learns to deploy a template next to
      its app.

- [ ] Resource incidents have no REST API, MCP tool or CLI command yet: only
      Monitoring → Incidents reads them.
- [ ] A remote host connected as a raw Docker daemon (`tcp://`, `ssh://`) isn't
      measured for resource incidents, only agent hosts are; reading the machine
      would take a helper container on that daemon.
- [ ] A workstation's (and workstation preset's) repository isn't followed when
      it's renamed on its provider: they store a clone URL only, no `owner/name`
      or provider id, and its checkout directory is named after the URL.
- [ ] Drizzle's bun-sql driver stores every jsonb value as a JSON string
      (`"[...]"`), healed only when drizzle reads it back. Anything that works
      on jsonb in SQL sees the string: `UserPreferencesDTO.updateViewMode`'s
      `||` merge turns `viewModes` into an array of strings, so a list's
      list/card choice doesn't stick, and `causes::text ilike` searches escaped
      text. Fix the encoding once (a custom column type, or binding jsonb as
      text) and repair the stored rows.

## Medium

- [ ] Mail server: verify the relay's certificate; docker-mailserver sets
      `smtp_tls_security_level = encrypt` for a relay, which encrypts but
      accepts any certificate, so an active man in the middle can read the relay
      password (`secure` checks it against the relay's hostname)
- [ ] Mail server: verify the whole path against a live docker-mailserver
      (bcrypt `{BLF-CRYPT}` sign-in, rspamd DKIM signing with the path template,
      `acme.json` extraction when Traefik issued a wildcard)

## Large

- [ ] Package registries: npm (Verdaccio) and PyPI (pypiserver) run as core
      services; Maven and Cargo don't yet, their usual servers (Reposilite,
      kellnr) keep their own user database instead of the htpasswd file the
      others share, and there's no REST API, MCP or CLI for any of them
