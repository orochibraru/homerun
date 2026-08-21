# Users & access

## Roles

Homerun has two roles, **admin** and **developer**. Both get the full dashboard over their own data, every project/service/volume is already scoped by account, invisible to other users, the only difference is two admin-only pages, `/users` and `/settings`. There's no finer-grained permission system yet (no per-project access control, no read-only role).

**The very first account created on a fresh instance becomes admin automatically.** After that, there's no public sign-up, every other account is created by an admin from `/users`:

- **Direct-create**, name/email/temporary password/role, works with no email setup.
- **Email invite**, only shown once SMTP is configured (see [Configuration](configuration.md)); sends a link to `/auth/accept-invite/<token>`, valid for 7 days.

An admin can change a user's role or remove them from `/users`, with two guards: you can't remove yourself, and you can't demote/remove the last remaining admin.

## OAuth / OIDC login

Configured per-provider from `/settings` (not env vars), any OIDC-compatible provider via a discovery URL, client ID/secret, and scopes. Applies live once saved, no restart. The discovery URL is validated before saving specifically because a broken one used to be able to lock the whole instance out (see [Configuration](configuration.md#a-note-on-lockout)).

## API keys

Generate an API key from your profile page to use the [REST API or CLI](api-and-cli.md) without a browser session, `x-api-key` or `Authorization: Bearer <key>` on any `/api/v1/*` request.

## Per-service auth gate

A deployed service can require a Homerun login to reach it at all (`authRequired`, the service's Networking tab), Traefik's forwardAuth middleware checks the request against this app's own session before letting it through.

**Real limitation, not hypothetical**: there's no login page mounted on the gated subdomain itself, so this blocks _everyone_, including a signed-in admin, unless `AUTH_CROSS_SUBDOMAIN=true` widens the session cookie to every subdomain of your base domain. Even with that on, a signed-in admin visiting the gated subdomain directly has been observed still getting a 401 in testing, not fully root-caused. Treat `authRequired` today as a hard "make this unreachable from outside" switch, not a finished SSO gate; a real fix needs a login-redirect flow for gated subdomains, which isn't built yet.

## Onboarding

The forced first-run wizard (see [Getting started](getting-started.md#first-boot)) is a property of the _instance_, not the account, once the bootstrap admin finishes it, later developer accounts never see it. If an admin invites someone before finishing onboarding themselves, that person sees a holding message instead of the wizard (they don't get instance-wide config controls).
