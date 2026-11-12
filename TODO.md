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
