# TODO

## Medium

- [ ] [APP] Docker cleanup methods via UI (docker prune for system (all), image,
      container...)
- [ ] [CI/CD] Since we already build & tag docker images in PRs, it's safe to
      assume that the last built image is healthy which means we're re-building
      one for nothing in the main CI when merged. We could just re-tag it. On
      top of this we should definitely have both a workflow that deletes the PR
      image when a PR is closed as well as a periodic docker registry cleanup
      for dangling images from PRs if the cleanup jobs ever fail.

## Large

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
