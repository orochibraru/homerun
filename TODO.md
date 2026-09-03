# TODO

## Medium

- [ ] Use Multipass to test (full run, e2E) the installer and agent. Use docker
      to test the CLI. All against a real instance, all e2e

## Large

- [ ] Security scanning?
- [ ] Terraform/Pulumi providers
- [ ] Github Actions & Gitlab CI presets to deploy easily (deterministic or not,
      should be a settings if the user wants latest or only tagged)
- [ ] Finish building the auth wall for services, includes adding an
      "Authentication" sidebar item & page to configure auth providers. Oauth
      should be prioritized with presets for popular open source choices like
      Pocket ID, Keycloak, Authelia, Logto, Authentik, Zitadel and Kanidm. Users
      should also have the ability to use the built-in Homerun authentication.
      These providers need to be configured using the default better-auth system
      so they're also available for signing in to the homerun dashboard. On each
      service each provider mustn't be selected by default. The user should be
      able to choose one, many or all. They should also be able to restrict
      access to some users, some emails or oauth groups/claims.
