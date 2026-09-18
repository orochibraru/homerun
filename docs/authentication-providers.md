# Authentication providers

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

- **Preferred sign-in methods** picks among password, passkey and each enabled
  provider. The sign-in page is email-first (see below), so this no longer
  reorders a list of buttons: with passkey preferred, the page prompts for one
  as soon as it opens instead of only offering autofill; with a provider
  preferred, an account linked to it is sent straight there once you enter its
  email, skipping the extra click. Pick none and the page just falls back to
  whatever's available for that account.
- **Sign-in requirements**: **Require two-factor authentication** and **Require
  a passkey**. They apply to every account, admins included. Anyone who doesn't
  meet one is sent to a setup page on their next visit and can't use the
  dashboard until they've enrolled. API keys and CLI tokens aren't affected.

## OAuth / OIDC login

Configured per-provider from the Authentication page, not env vars: any
OIDC-compatible provider via a discovery URL, client ID/secret, and scopes.
Applies live once saved, no restart. The discovery URL is validated before
saving specifically because a broken one used to be able to lock the whole
instance out (see [Configuration](configuration.md#a-note-on-lockout)).

## Base domain and Dashboard URL are two different things

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

## Signing out

Signing out of Homerun signs you out of Homerun only. If you also want it to end
your session at the identity provider (which sends you to that provider's logout
page), turn on **Sign out of the provider too** on that provider's page. It's
off by default.

## Connecting a provider to an existing account

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

The sign-in page asks for your email first: enter one with no password set and
already linked to a provider, and it's offered there as a "Continue with …"
button (or you're sent straight to it, see Preferred sign-in methods above); any
other email gets a password field with every enabled provider offered below it.
Every enabled provider also becomes selectable as a per-app sign-in method on
the [login wall](login-wall.md). Saving takes effect immediately, without a
restart.
