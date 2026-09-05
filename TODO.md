# TODO

## Small

- [ ] [App] When creating a new service and clicking on "Create and Deploy" at
      the end of a template: making this button a loader until the service
      deploys is poor ux. Let's instead initiate the deployment sequence in the
      background and redirect the user to the service page showing them the logs
      and all that would happen if they clicked on "create" and got redirected
      to the page and clicked "deploy" themselves.
- [ ] [App] Instead of appending a div to a section for confirmation (such as
      the confirm button in a danger zone) let's use a real confirmation modal
      that sticks out with a "type in service name to confirm" to make sure we
      alert enough the users so they don't destroy their config accidentally

## Medium

- [ ] [App] When creating a new service add possibility to link it to another
      even if it's outside of a project. When linking to something like Redis or
      Postgres let's be smart: offer to add an env variable to the main service
      you're configuring with either a JDBC format or each value as a var. Offer
      a default name such as (POSTGRES_URL) or (REDIS_URL) when the user selects
      JDBC format but don't force them to use it let them rename it to whatever
      they want. In the other scenario where they don't want JDBC apply the same
      logic, they should have vars such as (DB_USER) or (POSTGRES_USER) etc
      etc..
- [ ] [App] Add a queue system with a worker. This should be prioritized for
      build queues (multiple pushes on git in a short span of time would be a
      no-op without it) as well as deployments (especially at the end of the
      service creation wizard) but also for cron-triggered tasks like backups
      and docker cleanups
- [ ] [App] For container logs I'm certain we need to use a websocket instead of
      polling. For other tasks I wonder if RPC would be a good choice but seems
      like a trend over a good REST API. Let's evaluate where each is more
      relevant. For example when deploying a service we generally want logging,
      a websocket action could be interesting to provide info in a modal when
      clicking a deploy button such as "pulling image 'image-name'",
      "registering configuration", "provisioning container", "checking container
      health", "routing traffic", "creating volumes" etc...

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
