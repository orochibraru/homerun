# Users & access

## Roles

Homerun has two roles, **admin** and **developer**. Both get the full dashboard
over their own data, every project/service/volume is already scoped by account,
invisible to other users, the only difference is a few admin-only pages,
`/users`, `/settings`, and `/docker-cleanup` (see
[Configuration](configuration.md#docker-cleanup)). There's no finer-grained
permission system yet (no per-project access control, no read-only role).

**The very first account created on a fresh instance becomes admin
automatically.** After that, there's no public sign-up, every other account is
created by an admin from `/users`:

- **Direct-create**, name/email/temporary password/role, works with no email
  setup.
- **Email invite**, only shown once SMTP is configured (see
  [Configuration](configuration.md)); sends a link to
  `/auth/accept-invite/<token>`, valid for 7 days.

An admin can change a user's role or remove them from `/users`, with two guards:
you can't remove yourself, and you can't demote/remove the last remaining admin.
`/users` has a search box (name/email) and a Role filter once you have more than
a couple of accounts, plus a pager once you have more than a page's worth,
searched/paginated server-side.

## OAuth / OIDC login

Configured per-provider from the Authentication page (see below), not env vars:
any OIDC-compatible provider via a discovery URL, client ID/secret, and scopes.
Applies live once saved, no restart. The discovery URL is validated before
saving specifically because a broken one used to be able to lock the whole
instance out (see [Configuration](configuration.md#a-note-on-lockout)).

## API keys

Generate an API key from your profile page to use the
[REST API or CLI](api-and-cli.md) without a browser session, `x-api-key` or
`Authorization: Bearer <key>` on any `/api/v1/*` request.

## Appearance

A per-account "Appearance" tab on your profile page controls:

- **Theme**: light, dark, or match system (the default). Changes apply instantly
  and are saved to your account, so the choice follows you to a new browser or
  device, not just the one you set it on.
- **Sidebar color intensity**: "Colorful" (default, each sidebar section gets
  its own color) or "Single accent color" (every section uses the same, more
  muted, color).
- **Main color accent**: pick a preset or a custom color for buttons, links, and
  highlighted state throughout the dashboard.

These are personal preferences, not instance-wide settings, each account picks
its own independently of `/settings`.

## Authentication providers

The **Authentication** page (Administration, admin-only) is where sign-in
methods are configured for the whole instance:

- **Built-in authentication** is Homerun's own email and password accounts,
  managed on the Users page. It's always available for the dashboard.
- **OAuth / OIDC providers** are any standards-compliant provider, and you can
  configure **as many as you like**. The page lists them the same way Services
  does: **Add provider** opens its own page, and each one has a detail page for
  editing and removal (removal asks you to type the provider's id first).
  One-click presets fill in the discovery URL shape, scopes and PKCE default for
  Pocket ID, Keycloak, Authelia, Logto, Authentik, Zitadel and Kanidm; replace
  the `{placeholders}` with your own hostname and add the client id and secret
  from the OAuth app you registered there. Any other OIDC provider works from
  the "Blank" option. Each provider has a **Display name** shown on the sign-in
  button and everywhere it's listed, separate from its **Provider id**, which is
  the lowercase machine name baked into the redirect URI and fixed once created.
  Leaving a client secret blank when editing keeps the one already stored.

Register `<your-homerun-url>/api/v1/auth/callback/<provider id>` as the redirect
URI on the provider's side. The Authentication page prints the exact URL to use.

### Base domain and Dashboard URL are two different things

- **Base domain** is the DNS suffix your deployed services are routed under, so
  a service appears at `<slug>.<base domain>`. It never includes a port, because
  a Traefik host rule can't have one.
- **Dashboard URL** is where you reach Homerun itself, scheme and port included.
  Leave it blank to derive it from the base domain; fill it in when the two
  differ.

They're the same in a normal deployment (`example.com` → `https://example.com`).
They differ in development, where the dashboard runs on `http://localhost:5173`
while services are routed by Traefik on 443 as `<slug>.localhost`. If you type a
port into Base domain it's moved to the Dashboard URL for you rather than into
your service hostnames.

### Signing out

Signing out of Homerun signs you out of Homerun only. If you also want it to end
your session at the identity provider (which sends you to that provider's logout
page), turn on **Sign out of the provider too** on that provider's page. It's
off by default.

### Connecting a provider to an existing account

Signing in with a provider whose email already belongs to a local account is
refused, on purpose: matching an email address doesn't prove the two accounts
are the same person.

If you hit that, the page you land on does the work for you. Signed in, it
offers **Link \<provider\> to this account** and **Sign out**. Signed out, it
gives you an email and password box right there — sign in and the provider is
connected in the same step, no trip through the sign-in page and your profile.

**Client authentication** on each provider controls how the client id and secret
are sent when exchanging the login for a token. _Automatic_ reads your
provider's own discovery document and uses the HTTP Basic header when it's
offered, which is what OpenID Connect defaults to. Override it only if sign-in
fails with **`invalid_client`** while the credentials are correct — that means
the client you registered expects the other method.

You can also manage this any time from **Profile → Security → Connected
accounts**, which lists every enabled provider with Connect/Disconnect.
Disconnect stays unavailable until you have a password set, so you can't remove
your last way in.

**Set Origin (Settings → General) before you do this, and keep it accurate.** An
OAuth provider only accepts a redirect URI you registered with it in advance, so
Homerun sends the one built from Origin — that's the URL the Authentication page
shows you. Two things follow:

- If the Dashboard URL doesn't match how you actually reach Homerun, sign-in
  fails with something like _"The redirect_uri '…' is not registered for this
  client"_. Change Origin to match rather than registering a second URI with
  your provider.
- Single sign-on has to begin and end on that same address. If you open Homerun
  on some other hostname, the sign-in page will point you at the configured one
  instead of offering provider buttons that can't work, and the login-wall
  sign-in screen redirects there on its own. Email and password sign-in works
  from any address.

Every enabled provider appears as a "Continue with …" button on the Homerun
sign-in page, and becomes selectable as a per-app sign-in method below. Saving
takes effect immediately, without a restart.

## Per-app login wall

A deployed service can require a login before anyone reaches it. Turn on
**Require login to access this app** on the service's **Networking** tab, under
Access.

**How it works.** Traefik's forwardAuth middleware asks Homerun about every
request to that hostname. A visitor without a valid session for that app is
redirected to Homerun's own sign-in screen, signs in there, and is sent back to
the page they originally asked for. Homerun then sets a session cookie scoped to
that app's own hostname, so the app stays reachable for eight hours without
signing in again. Nothing is shared with your other apps: each one gets its own
cookie, and a cookie issued for one hostname is rejected on any other.

This needs **Origin** set under Settings → General, since that's the URL
visitors are sent to in order to sign in. Saving the setting is refused with an
explanation if it isn't set yet. It does **not** need `AUTH_CROSS_SUBDOMAIN`,
which is unrelated to this flow.

**Sign-in methods.** Nothing is enabled by default: pick at least one of the
built-in login and your configured OAuth providers. Only the methods you pick
are offered on that app's login screen, and only an account linked to one of
them is let through. Turning the wall on with nothing picked is refused, so you
can't lock yourself out by accident.

**Who's allowed.** Three optional lists narrow access further:

- **Users** — specific Homerun accounts.
- **Emails** — exact addresses, or `*@example.com` to cover a whole domain.
- **Groups / roles** — matched against the group and role claims in the id token
  your OAuth provider issued (`groups`, `roles`, and Keycloak's realm and
  resource roles). Make sure the provider's scopes actually request them, often
  by adding a `groups` scope.

Leave all three empty to let any signed-in user through, as long as they used an
allowed method. Filling any of them narrows access to whoever matches at least
one entry in that list. Changing any of this takes effect immediately, including
for people already signed in to that app.

**Redeploy the service** after turning the wall on or off: the middleware is
attached through the container's Traefik labels, which are written at deploy
time.

The app itself receives the signed-in identity as `X-Homerun-User`,
`X-Homerun-Email` and `X-Homerun-Name` request headers, which an app that
supports proxy-header authentication can consume directly.

**Limits worth knowing.** The wall covers services Traefik routes publicly; a
service that isn't publicly routed has no router to gate. Access is re-checked
when the app cookie is issued and whenever the rules change, but deleting a user
or changing their groups at the provider takes effect at the next sign-in, or
within the eight-hour cookie lifetime at the latest.

## Onboarding

The forced first-run wizard (see
[Getting started](getting-started.md#first-boot)) is a property of the
_instance_, not the account, once the bootstrap admin finishes it, later
developer accounts never see it. If an admin invites someone before finishing
onboarding themselves, that person sees a holding message instead of the wizard
(they don't get instance-wide config controls).
