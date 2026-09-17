# Users & access

## Roles

Homerun has three roles, **admin**, **developer** and **read-only**. Every
account sees every resource on the instance, and every admin or developer
account manages it: services, stacks, volumes, backups, S3 destinations, build
cache registries, remote hosts, cron jobs, status pages, custom templates and
the job queue are shared, whoever created them. Each one still records who
created it. What stays personal is your sessions, API keys, preferences, git
provider connections, terminal sessions, bell feed and notification channels.
Every account gets a copy of each bell notification, and every account's own
notification channels hear about every event. Between admin and developer, the
only difference is a few admin-only pages, **Users**, **Authentication**,
**Settings**, **System Logs** and **Docker Cleanup** (see
[Operations](operations.md#docker-cleanup)), plus admin-only actions elsewhere:
registering a git provider's OAuth app and host-command cron jobs. There's no
finer-grained permission system yet (no per-stack access control, no teams).

**Read-only** accounts see everything a developer sees but can't change
anything: every form, button and API call that writes is refused with "This
account or API key is read-only", enforced on the server for form actions,
remote commands and the REST API alike, and the dashboard header shows a
**Read-only** badge. What they can still do is look after their own account:
sign out, change their password, manage passkeys and two-factor, set
preferences, clear their notification bell, create API keys (always read-only)
and log in the CLI. They don't see the admin-only pages.

**The very first account created on a fresh instance becomes admin
automatically.** After that, there's no public sign-up, every other account is
created by an admin from `/users`:

- **Direct-create**, name/email/temporary password/role, works with no email
  setup.
- **Email invite**, only shown once SMTP is configured (see
  [Configuration](configuration.md)); sends a link to
  `/auth/accept-invite/<token>`, valid for 7 days. The pending list on `/users`
  shows only invites that can still be accepted; an expired one drops off, and
  inviting the same address again replaces it.

An admin can change a user's role or email, or remove them, from `/users`. An
email changed there takes effect immediately and is marked verified, no
confirmation link and no SMTP needed, which is the way to change a verified
address on an instance without email set up. Two guards apply: you can't remove
yourself, and you can't demote/remove the last remaining admin. Removing a user
hands everything they created over to the admin who removed them: their services
keep running. A git service they created builds with its new owner's git
provider connection from then on, so reconnect the provider under your profile
if its builds or webhooks start failing. `/users` has a search box (name/email)
and a Role filter once you have more than a couple of accounts, plus a pager
once you have more than a page's worth, searched/paginated server-side.

## OAuth / OIDC login

Configured per-provider from the Authentication page (see below), not env vars:
any OIDC-compatible provider via a discovery URL, client ID/secret, and scopes.
Applies live once saved, no restart. The discovery URL is validated before
saving specifically because a broken one used to be able to lock the whole
instance out (see [Configuration](configuration.md#a-note-on-lockout)).

## Your profile

The profile pages (reached from the avatar menu, not the sidebar) are per
account:

- **Personal information**, your name and email. Changing an unverified email
  takes effect immediately; a verified one needs confirming from a link sent to
  the address you're leaving, so it stays locked until SMTP is configured or an
  admin changes it for you from `/users` (see
  [Known, real limitations](faq-and-limitations.md#known-real-limitations-not-hypothetical)).
- **Security**, change your password, connect or disconnect OAuth providers (see
  [below](#connecting-a-provider-to-an-existing-account)), set up
  [two-factor authentication and passkeys](#two-factor-authentication-and-passkeys),
  and delete your account. Deleting it hands everything you created over to
  another admin (or, failing that, the oldest other account), so nothing stops
  running. Only when yours is the last account are its containers removed with
  it.
- **Sessions**, every browser currently signed in as you, with the device and
  when it was last seen. Revoke any of them, useful after signing in somewhere
  you don't control.
- **Authorized clients**, API keys, including the ones the
  [CLI](api-and-cli.md#logging-in) created for itself through its device-code
  login. Create a key here to use the REST API or CLI without a browser session,
  and revoke one the same way. A key is shown once, at creation.
- **Appearance**, see [below](#appearance).
- **Notifications**, which events each of your notification channels receives,
  see [Operations](operations.md#notifications).

## Two-factor authentication and passkeys

Both live under **Profile → Security**.

- **Two-factor authentication** asks for a code from an authenticator app after
  your password. Turning it on (confirm your password first, if you have one)
  shows a QR code to scan and a set of **backup codes**; save those, each one
  signs you in once when the app isn't to hand. The sign-in page's code step
  accepts either. You can generate new backup codes or turn it off from the same
  panel.
- **Passkeys** sign you in with Touch ID, Windows Hello, a security key or your
  password manager instead of a password. Register as many as you like, name
  them, and remove the ones you no longer use. The sign-in page offers a passkey
  button and your browser's passkey autofill.

A passkey is bound to the **Dashboard URL**'s hostname (Settings → General), so
it only works when you open Homerun on that host or a subdomain of it; on any
other address the passkey option isn't offered. Set the Dashboard URL before
anyone registers one, since changing its hostname later strands every passkey
already registered. Settings → General warns before saving a Base domain or
Dashboard URL change that moves the hostname, with how many passkeys it would
strand, and asks you to confirm.

## API keys

Generate an API key from **Profile → Authorized Clients** to use the
[REST API or CLI](api-and-cli.md) without a browser session, sent as `x-api-key`
or `Authorization: Bearer <key>` on any `/api/v1/*` request. Pick its **Access**
when you create it:

- **Full access** carries the full permissions of the account that owns it.
- **Read-only** can call every `GET` endpoint and gets a `403` on anything that
  writes, whatever the owning account's role. Use it for dashboards, monitoring
  scripts and anything else that only needs to look.

A read-only account can only create read-only keys. The key list shows a
**Read-only** badge on each read-only key.

`homerun login` creates one for you through a device-code flow rather than
making you copy-paste, and it shows up in this list like any other.

## Git provider accounts

Separate from signing in to Homerun: connecting a GitHub, GitLab, Gitea or
Bitbucket account on the **Git Providers** page lets a git-based service pick
its repository and branch instead of pasting a URL, reach private ones without a
token in the clone URL, and deploy on every push through a webhook Homerun adds
for you. An admin registers the OAuth app once for the instance; each person
connects their own account to it. See
[Services](services.md#connecting-a-git-provider).

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

The same page has two instance-wide switches:

- **Preferred sign-in methods** picks what the sign-in page shows up front,
  among password, passkey and each enabled provider. Everything else stays
  available behind an "Other sign-in methods" link; pick none to show every
  method. With passkey preferred, the sign-in page prompts for one as soon as it
  opens.
- **Sign-in requirements**: **Require two-factor authentication** and **Require
  a passkey**. They apply to every account, admins included. Anyone who doesn't
  meet one is sent to a setup page on their next visit and can't use the
  dashboard until they've enrolled. API keys and CLI tokens aren't affected.

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

**Locked out after a typo?** If a wrong Base domain or Dashboard URL means the
dashboard's domain no longer reaches Homerun, open it on the server's IP and
port instead (`http://<server IP>:3000` for a standard install) and fix the
setting from there. Homerun always accepts sign-ins on its own IP address,
whatever the domain settings say. That works as long as `ORIGIN` in `.env` isn't
an `https` address, which the installer doesn't set.

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
**Require login to access this app** on the service's **Security** tab, under
Login wall.

**How it works.** Traefik's forwardAuth middleware asks Homerun about every
request to that hostname. A visitor without a valid session for that app is
redirected to Homerun's own sign-in page, the same one as the dashboard's, so
passkeys, two-factor codes and your preferred sign-in methods all work there.
The page names the app they're signing in to, and once they're in it shows a
short "taking you to …" screen before sending them back to the page they
originally asked for. Homerun then sets a session cookie scoped to that app's
own hostname, so the app stays reachable for eight hours without signing in
again. Nothing is shared with your other apps: each one gets its own cookie, and
a cookie issued for one hostname is rejected on any other.

This needs **Origin** set under Settings → General, since that's the URL
visitors are sent to in order to sign in. Saving the setting is refused with an
explanation if it isn't set yet. It does **not** need **Cross-subdomain
cookies** (Settings → General), which is unrelated to this flow.

**Sign-in methods.** Nothing is enabled by default: pick at least one of the
built-in login and your configured OAuth providers. Only an account linked to
one of the methods you pick is let through; someone who signs in another way
sees a "you don't have access" screen with a button to sign in as someone else.
Turning the wall on with nothing picked is refused, so you can't lock yourself
out by accident.

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

**Turning the wall on or off applies immediately**, without a redeploy. Every
publicly routed service carries the forwardAuth middleware whether its wall is
on or not, and Homerun simply lets requests through for a service whose wall is
off. Two consequences: a service deployed before this behaviour existed needs
one redeploy to pick up the middleware, and while Homerun itself is down,
Traefik refuses requests to every routed app, not just the gated ones.

The app itself receives the signed-in identity as `X-Homerun-User`,
`X-Homerun-Email` and `X-Homerun-Name` request headers, which an app that
supports proxy-header authentication can consume directly.

**Groups include the Homerun role.** Besides the provider's claims, a user's
Homerun role (`admin`, `developer` or `viewer` for read-only) counts as a group,
so an app can be limited to `admin` without an identity provider at all.

**Revocation.** Access is re-checked when the app cookie is issued, whenever the
rules change, and again at least every five minutes while the cookie is in use.
Deleting, banning or re-roling a user in Homerun, or unlinking one of their
sign-in methods, is picked up on their very next request to any gated app. For
an app that filters on groups, the five-minute re-check first asks the user's
OAuth provider for fresh tokens, so a group removed at the provider is noticed
within about five minutes, as long as the provider issues refresh tokens and
returns a new id token on refresh, which usually needs the `offline_access`
scope. If the refresh fails, the groups from the last sign-in are used until the
eight-hour cookie lifetime runs out.

**Limits worth knowing.** The wall covers services Traefik routes publicly; a
service that isn't publicly routed has no router to gate.

## Sign in with Homerun

Homerun is also an OpenID Connect (OIDC) provider. Apps you host can offer "Sign
in with Homerun" using the same accounts as the dashboard, so you don't need to
run Pocket ID, Authentik or Keycloak just to give Grafana or Outline a login.
Whatever the dashboard requires (passkeys, two-factor codes, your preferred
sign-in methods) applies to these sign-ins too.

It needs the **Dashboard URL** set under Settings → General: Homerun signs
tokens as that address, and apps discover everything else from it.

**Registering an app.** On the Authentication page, under **Sign in with
Homerun**, click **Register app**:

- **Name**: shown on the consent screen.
- **Redirect URIs**: the callback URL from the app's own OIDC settings, one per
  line. They must use `https`, which every app Homerun routes already has.
- **Client type**: **Confidential** for server-side apps (almost every
  self-hosted app), **Public** for a browser or mobile app that can't keep a
  secret.
- **Require PKCE**: confidential apps only, leave off unless you know the app
  sends a PKCE challenge. Change it later from the app's own page, for an app
  that fails with "pkce is required for this client". A public app always needs
  PKCE, and so does a sign-in asking for `offline_access` without an OIDC nonce,
  whatever this says.
- **Skip the consent screen**: on by default for apps you host yourself. Turn it
  off to have users approve sharing their details the first time.
- **Allow single sign-out**: lets the app sign the user out of Homerun too.

Registering shows the client ID and client secret. **The secret is shown only
once**; if you lose it, open the app and use **Rotate secret**, then paste the
new one into the app.

**Configuring the app.** Most apps only need three values:

| Setting       | Value                                                              |
| ------------- | ------------------------------------------------------------------ |
| Discovery URL | `https://<dashboard>/api/v1/auth/.well-known/openid-configuration` |
| Client ID     | from the registration screen                                       |
| Client secret | from the registration screen                                       |

If an app asks for individual endpoints instead, the app's page in Homerun lists
the issuer, authorization, token, userinfo and JWKS URLs. Request the scopes
`openid profile email`, plus `groups` if the app maps groups to roles: the
`groups` claim holds the user's Homerun role (`admin`, `developer` or `viewer`).
Tokens are signed with RS256.

**Turning an app off or deleting it.** **Turn off** stops new sign-ins through
the app. **Delete app** also revokes every token it holds, so users are signed
out of it the next time it checks.

## Onboarding

The forced first-run wizard (see
[Getting started](getting-started.md#first-boot)) is a property of the
_instance_, not the account, once the bootstrap admin finishes it, later
developer accounts never see it. If an admin invites someone before finishing
onboarding themselves, that person sees a holding message instead of the wizard
(they don't get instance-wide config controls).
