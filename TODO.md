# TODO

## Small

## Medium

- [ ] [App] No restore flow for S3 backups (upload only) : retrieving a tarball
      and unpacking it back into a bind mount or a named volume is still manual.
- [ ] [App] Compose import ignores `build:` : a compose service built from a
      local Dockerfile is imported as a service that then needs its Source tab
      pointed at a git repo by hand.
- [ ] [App] Cron jobs run on the local Docker daemon only : `runOneOff` takes a
      remote connection but nothing passes one, so an image job can't be
      targeted at a Remote Host, and a run's output is only visible after it
      finishes (no live tail).
- [ ] [App] Revisit WebSockets once SvelteKit ships a route-level WebSocket API
      (2.70 has none, and `@orochibraru/svelte-smol` already forwards a
      `server.websocket()` to `Bun.serve` if one ever appears). Deploy progress
      is server-sent events and container logs are a streamed response today,
      both one-way pushes; the only genuinely bidirectional surface, the web
      terminal, still hand-rolls chunked HTTP plus a raw `Bun.connect()` hijack
      and would be the first thing worth moving.

## Large

- [ ] [App] Instead of loading data all over the place for quick actions from
      svelte files let's use remote functions. DO NOT use remote function for
      critical data such as user settings, role, profile, authentication stuff
      etc.. Only for data that can be loaded asynchronously via Skeleton loaders
      and {#await} loops in Svelte code.
- [ ] [Docker] Security scanning
- [ ] [SDKs] Terraform/Pulumi providers
- [ ] [SDKs] Github Actions & Gitlab CI presets to deploy easily (deterministic
      or not, should be a settings if the user wants latest or only tagged)
- [ ] [App] Finish building the auth wall for services, includes adding an
      "Authentication" sidebar item & page to configure auth providers. Oauth
      should be prioritized with presets for popular open source choices like
      Pocket ID, Keycloak, Authelia, Logto, Authentik, Zitadel and Kanidm. Users
      should also have the ability to use the built-in Homerun authentication.
      These providers need to be configured using the default better-auth system
      so they're also available for signing in to the homerun dashboard. On each
      service each provider mustn't be selected by default. The user should be
      able to choose one, many or all. They should also be able to restrict
      access to some users, some emails or oauth groups/claims.
