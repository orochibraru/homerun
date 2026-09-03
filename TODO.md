# TODO

- [ ] Terraform/Pulumi providers
- [ ] Github Actions & Gitlab CI presets to deploy easily (deterministic or
      non-deterministic tags)
- [ ] Recent deployments on the dashboard should be clickable for quick nav &
      better ux
- [ ] Base theme (light/dark/system) off the user's system first. Store theme
      preferences in account settings. When navigating to account add a tab for
      appearance and add three sections: theme (choose between light, dark and
      system), color intensity (should control if the sidebar is colorful or
      just one accent color) and main color accent.
- [ ] Ability to delete a notification
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
