# Auth, users, login wall

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory. These sections were split out of that file, so a "see X below/above"
in the text below may now point at a section living in a sibling note rather
than in this one.

## Auth (`src/lib/services/auth.ts`)

better-auth at `basePath: "/api/v1/auth"`, `drizzleAdapter` over the same
Postgres `db`. `src/hooks.server.ts` populates `event.locals.user`/`session`
from the cookie session, falling back to manual
`x-api-key`/`Authorization: Bearer` verification when no cookie is present:
`auth.api.verifyApiKey()` confirms the key, then the owning user is looked up
**directly by `result.key.referenceId`** via a plain drizzle query, deliberately
_not_ through `getSession()`'s API-key session-mocking, which is gated behind
the `apiKey()` plugin's `enableSessionForAPIKeys` option (default `false`, and
better-auth's own docs advise against enabling it in production). This is what
makes `x-api-key`/`Bearer` auth work for `src/routes/api/v1/*` (see REST API
above).

## Read-only role and scoped API keys (`$lib/permissions.ts`, `$lib/server/read-only.ts`)

Roles are `admin`, `developer` and `viewer` (labelled "Read-only"), all listed
in `$lib/permissions.ts` (`USER_ROLES`, `ROLE_OPTIONS`, `isUserRole`), which
`/users` validates against. An API key carries a scope in better-auth's key
`metadata` (`{scope: "read"}`, `apiKey({ enableMetadata: true })` in `auth.ts`,
metadata is rejected otherwise); no scope recorded means full access, so every
key created before this is a full key. `apiKeyScopeOf` reads it, tolerating the
double-stringified legacy shape better-auth itself migrates.

**Enforcement is one check in `hooks.server.ts`, not one per action.**
`authHandler` sets `locals.apiKeyScope` (API-key path only) and
`locals.readOnly` (`isReadOnly(role, scope)`), and when read-only runs
`readOnlyRejection` before resolving: every non-GET/HEAD/OPTIONS request is
refused unless `readOnlyMayRequest` allowlists it. That single gate covers form
actions, remote commands (`/_app/remote/<hash>/<exportName>` POSTs) and the REST
API at once, so a new action or endpoint is protected without remembering to add
a guard. The allowlist is the caller's own account only: better-auth's
`/api/v1/auth/*` (sign-out, passkeys, 2FA, password; its admin endpoints stay
gated by better-auth's own admin check), `/api/v1/auth-token`
(`homerun logout`), `/profile/*`, `/cli-auth`, `/security-setup`, `/auth/*`,
`/app-auth`, and the four notification-bell commands **by export name**, since a
remote function's URL is `<file hash>/<export name>`. Renaming one of those
commands silently drops it from the allowlist (it then 403s for viewers, fails
closed). The response is shaped per caller so the UI reports it properly: a
devalue-encoded `ActionResult` failure for a `use:enhance` post (the promise
toast shows the message), a remote-function `{type:"error"}` body for commands,
`{error}` JSON for `/api/`, plain text otherwise. `requireWriter()` in
`remote-auth.ts` is the call-site belt-and-braces for commands
(`startSelfUpdate` uses it). A read-only account's API keys are always created
read-only (Profile → Authorized Clients forces the scope); the (protected)
layout exposes `readOnly` for the header badge and hides "Deploy a service".
Hiding every other write button for viewers is not done: they see them and get
the toast.

`user.deleteUser` is enabled with a `beforeDelete` hook (thin wrapper around
`$lib/services/user.service.ts`'s `UserService.cleanupUserResources()`, see User
roles & invitations below), don't assume better-auth's default account-deletion
behavior is sufficient; it isn't, by design of this app's extra tables (see Data
model above).

`config.auth.crossSubdomainCookies` (`auth.crossSubdomainCookies` in
`homerun.yaml`, default off, also DB-editable, see Instance settings above) sets
better-auth's `advanced.crossSubDomainCookies` to scope the session cookie to
`.{baseDomain}` instead of the exact host, see the per-service auth gate below
for why, and its documented, tested limitation.

**`advanced.useSecureCookies` is set explicitly from the `ORIGIN` env var's
scheme, and it has to be.** Real, reproduced bug, not a precaution: sign-in on
an instance reached over plain HTTP at a bare IP (`http://<ip>:3000`, exactly
what the installer's `--mode=full` produces) returned 200 and toasted "Signed in
successfully", but the button stayed stuck on "Signing in…" forever and the user
never reached the dashboard. better-auth derives the secure-cookie flag through
a fallback chain (`cookies/index.mjs`'s `createCookieGetter`): explicit
`useSecureCookies`, else `baseURL`'s protocol, else **`isProduction`**. This app
deliberately never pins `baseURL` (see the long comment in `auth.ts` for the
lockout that causes), so a deployed container (`NODE_ENV=production`) fell
through to `isProduction` and issued
`__Secure-better-auth.session_token; Secure`. A browser on plain HTTP at a bare
IP silently **discards** that cookie twice over : `Secure` requires a secure
context (only `localhost`/`127.0.0.1` are exempt, an IP is not), and the
`__Secure-` prefix independently requires both. So the POST succeeded, no cookie
was ever stored, `locals.user` stayed empty on the next request, the sign-in
page's `load` never threw its `redirect(302, resolve("/"))`, `refreshAll()` had
no redirect to act on, and `loading` is only ever reset in `catch` or
`onNavigate` : hence a success toast over a permanently spinning button.
**Verified by A/B against a real production build on a real LAN IP**, reading
the actual `Set-Cookie`: pre-fix + `ORIGIN=http://<ip>:3000` →
`__Secure-…; Secure`; fixed → `better-auth.session_token` with no `Secure`;
fixed + `ORIGIN=https://…` → `__Secure-…; Secure` again, so an HTTPS deployment
is not downgraded. The full chain was then driven end to end: sign-in stores the
cookie, `get-session` returns the session, and `/auth/sign-in`'s data request
answers `{"type":"redirect","location":"../../"}`, which is what `client.js`'s
`_invalidate` turns into the `_goto` that un-sticks the button. The branch is
skipped entirely when `ORIGIN` is unset, leaving better-auth's own
`isProduction` default rather than guessing.

**It reads `process.env.ORIGIN`, never `config.auth.origin`, and that
distinction is load-bearing.** The first version of this fix derived the flag
from `config.auth.origin`, which is a _mutable, user-editable setting_ : saving
it calls `applyInstanceSettings()` + `rebuildAuth()`, and flipping
`useSecureCookies` renames the cookie (`better-auth.session_token` ↔
`__Secure-better-auth.session_token`), so every live session is instantly
unreadable. Concretely, and caught by e2e rather than by reading the code :
onboarding's "Use HTTPS" checkbox defaults to **on** whenever
`settings.authOrigin` is still null (a fresh instance), so clicking through the
wizard with defaults saved `https://…`, flipped the flag, renamed the cookie,
and **signed the admin out onto `/auth/sign-in` at the exact moment they
finished setting the instance up**. `ORIGIN` is the right source because it is
how the app is actually _served_ (compose.prod.yaml requires it, the installer
sets it, the e2e harness sets it) and is immutable for the process lifetime, so
no settings save can ever rename a cookie out from under a signed-in user. If a
deployment genuinely changes scheme, that's a restart, which is the correct
blast radius for a cookie-security change.

**Direct access on an IP or `localhost` gets its own auth instance.** With
`ORIGIN=https://…` (or cross-subdomain cookies on), signing in at
`http://<ip>:3000` failed at the 2FA step with "Invalid two factor cookie": the
`two_factor` challenge cookie came out `__Secure-…; Secure` (or
`Domain=.<baseDomain>`), which the browser drops on that origin. The exported
`auth` is a proxy that picks, per request (`getRequestEvent()`), a variant built
by `buildAuth(directAccessScheme(host, x-forwarded-proto))` : `Secure` only over
HTTPS, never scoped to the base domain. Named hosts keep the configured
instance, so the rule above is unchanged for them.

Rate limiting is on outside `vite dev`: 100 requests per IP per 15 minutes
overall, plus the `apiKey()` plugin's own 300/minute. **Real, tested finding**:
better-auth also applies an undocumented-in-config "special rule" (its
`rate-limiter/index.mjs`'s `getDefaultSpecialRules`) capping any
`/sign-in`/`/sign-up`-prefixed path at 3 requests per 10 seconds, well below
that `max`/`window` and unaffected by them, which a handful of `tests/e2e/`
specs signing in and out against a real production build tripped immediately.
`HOMERUN_DISABLE_AUTH_RATE_LIMIT=1` turns rate limiting off for that reason, set
only by `tests/e2e/support/bootstrap-runtime.ts`'s spawned app, never in
production, same test-only-escape-hatch shape as
`HOMERUN_SKIP_INTEGRATION_SETUP`.

`user.changeEmail` is enabled (`enabled: true`,
`updateEmailWithoutVerification: true`) so `/profile`'s email field is editable,
and the two account states take genuinely different paths through better-auth's
`changeEmail` endpoint (`update-user.mjs`): an **unverified** address writes the
new email (and re-sets the session cookie) immediately, synchronously, no
confirmation step, because `updateEmailWithoutVerification: true` only ever
applies when `session.user.emailVerified !== true`. A **verified** address is
untouched in the DB at request time regardless of that flag, better-auth only
creates a verification token and calls `sendChangeEmailConfirmation` (mailed via
`EmailService` to the _current_ address, not the new one); the row only changes
once the user follows that link to `/verify-email`. Both mail callbacks
(`emailVerification.sendVerificationEmail` and `changeEmail`'s
`sendChangeEmailConfirmation`) return early with a warn log when
`!isSmtpEnabled()`, rather than letting `EmailService`'s constructor throw the
way it does everywhere else. `sendOnSignUp` already gates the sign-up case, but
`changeEmail` reaches both callbacks off the mere _presence_ of
`sendVerificationEmail` (`canSendVerification`), whatever the SMTP settings say.
Two different things happen to a throw from there, and neither is useful: inside
`changeEmail` both callbacks go through `runInBackgroundOrAwait`, which catches
and logs (`create-context.mjs`), so the endpoint still answers
`{ status: true }` and the failure is invisible to the caller; but
`/send-verification-email` calls `sendVerificationEmailFn` which awaits the
callback directly, where the same throw is a 500. Returning early makes the skip
explicit in the log in both cases.

What actually keeps a user out of the resulting dead end is the page, not the
server: `src/routes/(protected)/profile/+page.server.ts` exposes `smtpEnabled`
(`isSmtpEnabled()`), and `/profile` disables the email field, with an
explanation, for a **verified** account while SMTP is off — that account's
address can't be changed at all without a confirmation link, and better-auth
would otherwise report success while doing nothing.

The `betterAuth({...})` call is wrapped in `buildAuth()` rather than assigned
once to a `const`, `export let auth = buildAuth()`, plus
`export function rebuildAuth()` which reassigns `auth = buildAuth()`. This is
what makes OAuth provider changes saved on `/settings` apply live: every
consumer (`hooks.server.ts`'s
`auth.api.getSession`/`svelteKitHandler({ auth, ... })`) reads `auth.*`
per-request rather than destructuring it at import time, so ES module
live-bindings mean a reassignment inside `auth.ts` is immediately visible
everywhere without a restart. `rebuildAuth()` is called at the end of
`hooks.server.ts`'s `init()` and every `/settings` action.

## Base domain vs. Dashboard URL, and why they're two things

`instance_settings.baseDomain` and `auth.origin` answer different questions, and
collapsing them caused a real, reported breakage. **Base domain is the DNS
suffix deployed services are routed under** : `labels.ts` interpolates it into a
Traefik `Host()` rule as `<slug>` dot `<baseDomain>`, and a host rule cannot
contain a port. **Dashboard URL (`auth.origin`) is where this app itself is
reached**, scheme and port included, and it's what the OAuth redirect URI and
the login wall's redirects are built from. In production the two coincide
(`example.com`→`<https://example.com`>); **in development they diverge**,
because the dashboard runs on `http://localhost:5173` while services are routed
by Traefik on 443 as `<slug>.localhost`.

Origin used to be derived as `scheme://baseDomain` with no separate field, and
`normalizeBaseDomain` explicitly permitted an optional `:port`. So getting the
origin right for dev forced `localhost:5173` into Base domain, which then became
the routing suffix : every service rendered as `<slug>.localhost:5173`, a URL
that hits the **Vite dev server** rather than Traefik, which served the
dashboard under that hostname, found no session cookie for it, and bounced to
`/auth/sign-in`. That's the bug, and nothing about it looked like a domain
problem from the outside.

Now: `normalizeBaseDomain` returns `{domain, port}` and **the port is moved to
the origin instead of the routing name**, so pasting `localhost:5173` (or a full
URL) into Base domain does the right thing silently rather than corrupting
routing. `applyCoreOverride` also strips any port from `config.baseDomain` at
boot, so an instance that already stored one is correct without needing a
re-save. Settings gained an explicit optional **Dashboard URL** field for the
cases derivation can't express. **A blank Dashboard URL means "derive it"**, and
that is load-bearing : `authOrigin` is always persisted, derived or not, so a
naive `value={settings.authOrigin}` pre-fills the field and then silently
overrides a later Base domain edit — caught by a browser test, not by reading
the code. The field renders blank whenever the stored origin equals
`scheme://baseDomain`, and shows the placeholder as a hint.

**Auth-check URL default**: when the app itself runs in a container attached to
the Docker network (installer `--mode=full`), `hooks.server.ts`'s `init()`
resolves it via `DockerService.selfContainer()` to
`http://<container name>:<PORT>/api/v1/auth-check` through
`setDetectedAuthCheckUrl` (a `homerun.yaml` `authCheckUrl` still wins, a DB
override still wins over both). Real bug this fixes: the old
`host.docker.internal` default doesn't resolve inside a Linux Traefik container
(`lookup host.docker.internal on 127.0.0.11:53: no such host`), so every login
wall 500'd on a real install. The dev compose files also give Traefik
`extra_hosts: host.docker.internal:host-gateway` for the bare-metal case.
Services deployed before the fix keep the old URL in their labels until
redeployed.

**Dev-mode port**: outside a container, `config.authCheckUrl` defaults to
`http://host.docker.internal:${PORT}/api/v1/auth-check` with `PORT` defaulting
to 3000. `vite dev` serves on 5173 (or the next free port) and doesn't set
`PORT`, so `vite.config.ts`'s `listeningPortPlugin` hooks the dev and preview
servers' `listening` event and writes the bound port into `process.env.PORT`.
That works because SvelteKit's dev middleware only loads the server modules (and
so evaluates `$lib/config.ts`) on the first request, which is always after
`listening`. **Don't "fix" this by deriving the port from `auth.origin`**
instead: that is only the same port in dev. Behind a reverse proxy the origin is
443 while the app listens on 3000, so deriving would break production to fix
development.

## Authentication pages (`/authentication`, `$lib/auth-providers.ts`)

Admin-only, its own sidebar item under Administration. It **replaced** the old
`/settings/authentication` tab (that route is gone; `/settings` is down to four
tabs), so there's one place editing `instance_settings.oauthProviders`.

**It follows the list + `new/` + `[id]` shape every other entity uses**
(services, stacks, storage), not a single page of inline expanding forms. The
first cut was that inline page and it was wrong on every axis the user cared
about : one provider looked like _the_ provider, deleting had no confirmation,
and the whole thing lived in one whole-array `updateOauth` action whose seven
parallel `formData.getAll()` arrays had to stay index-aligned between collapsed
and expanded rows. The route split deleted that fragility outright : each page
edits exactly one provider through `addOauthProvider`/`updateOauthProvider`/
`deleteOauthProvider` on the DTO, and `$lib/server/oauth-provider-form.ts`
parses one provider from one form. Providers still live in the
`instance_settings.oauthProviders` jsonb array rather than their own table, so
the route param is the provider **name**, which is why the name is immutable
once created (it's in the redirect URI and in every service's `oauth:<name>`
method reference). Deletion goes through `ConfirmDialog` with the provider name
as the typed phrase, same as the service danger zone.

**`label` vs `name`.** `name` is the machine id (lowercase, hyphens, part of the
redirect URI and of `oauth:<name>`); `label` is the human name shown on the
"Continue with …" button, the per-service Access checkbox list and the provider
list. `label` falls back to `name` everywhere it's read, so providers stored
before it existed keep working.

**Signing out of the provider is opt-in, off by default** (`signOutOfProvider`).
better-auth picks `end_session_endpoint` straight out of the discovery document
(`endSessionEndpoint ??= discovered.end_session_endpoint`) and performs
RP-initiated logout by default, so signing out of Homerun bounced the user to
their IdP's logout page without anyone having configured it. The provider config
now always passes `disableProviderLogout: !signOutOfProvider`, so the default is
a local sign-out and the redirect only happens when an admin ticks the box.

- **Presets.**- **Presets.** `OAUTH_PRESETS` (`$lib/auth-providers.ts`, a pure
  module, also home to the method-id encoding and the email matcher) carries a
  discovery-URL template, default scopes and PKCE default for Pocket ID,
  Keycloak, Authelia, Logto, Authentik, Zitadel and Kanidm. Clicking one appends
  a prefilled provider row with `{host}`/`{realm}`/`{slug}`/`{clientId}`
  placeholders left in for the admin to replace; "Blank" is still there for
  anything else. The templates are the products' own documented discovery paths,
  which differ more than you'd guess (Logto nests under `/oidc`, Authentik under
  `/application/o/<slug>`, Kanidm under `/oauth2/openid/<client id>`).
- The page prints the exact redirect URI to register with the provider
  (`<origin>/api/v1/auth/callback/<provider id>`), and says so explicitly when
  `config.auth.origin` isn't set yet rather than printing a broken URL.
- Provider **names must be unique** and renaming one silently drops it from any
  service that referenced it as `oauth:<name>`, so the save action rejects
  duplicates and the UI shows a per-provider "used by N apps" count.
- A "Protected apps" panel lists services with the wall on, flagging any with no
  sign-in method picked, and deep-links to each one's Networking tab.

**The OAuth redirect URI comes from the request, and both halves of the exchange
must agree.** better-auth builds the authorize step's `redirect_uri` from the
provider's optional `redirectURI`, but the **token exchange ignores it
entirely** and rebuilds the URI from `context.baseURL` (see
`api/routes/callback.mjs`, which interpolates `c.context.baseURL` with the
callback path), and that is derived per-request because `auth.ts` deliberately
leaves `baseURL` undefined — see Auth above for the lockout that causes. **Real
bug, introduced and reverted in one session**: pinning only `redirectURI` to
`config.auth.origin` made the authorize step stable but desynced it from the
token step, turning a `redirect_uri ... is not registered` error into
`invalid_code`, since OAuth requires the two to match byte for byte. Don't pin
one half. The request origin is the single source of truth for both, and the fix
for "it points at the wrong hostname" is to make the user reach Homerun at the
right one : that's what the Base domain / Dashboard URL split above and the
canonicalization below are for. The original report (a `dashy.localhost:5173`
callback not being registered) turned out to be the _same_ root cause as the
layout bug — a port in Base domain sending the browser to the dev server under a
service hostname — and fixing that fixes the redirect URI without pinning
anything.

**Client authentication on the token exchange is selectable per provider**
(`instance_settings.oauthProviders[].tokenAuthMethod`,
`"auto" | "post" | "basic"`, Authentication page). better-auth's default
(`getDefaultTokenEndpointAuth`) is `client_secret_post` whenever a client secret
is configured, and `none` when it isn't — and `none` sends **no client
credentials at all**, which an IdP reports as `invalid_client`,
indistinguishable from a wrong secret. A discovery document's
`token_endpoint_auth_methods_supported` lists what the _server_ accepts, but
each registered client has its own configured method, so a client set to
`client_secret_basic` rejects the default POST-body request. **Automatic is not
"let better-auth decide"** : it reads the provider's own
`token_endpoint_auth_methods_supported`, captured into `discoveredTokenAuth` by
the same discovery fetch that already validates the URL on save, and prefers
`client_secret_basic` when offered — which is what RFC 6749 §2.3.1 requires
servers to support and calls body credentials "NOT RECOMMENDED", and what OIDC
Core defaults `token_endpoint_auth_method` to. better-auth's POST-body default
is the outlier, and following it is what made a correctly configured Pocket ID
client fail. Falls back to `post` when Basic isn't advertised, and to
better-auth's own default when neither is (`resolveAdvertisedTokenAuth`, a pure
function in `$lib/auth-providers.ts`, covered by
`tests/unit/app/token-auth.test.ts`). Because the list is captured at save time,
a provider stored before this exists has an empty `discoveredTokenAuth` and
behaves as before until it's saved again. `"basic"` maps to better-auth's
`authentication: "basic"`, `"post"` to an explicit
`tokenEndpointAuth: { method: "client_secret_post" }`, and all of it is only
applied when a secret is actually present : passing a secret-based method with
no secret makes the plugin **throw during init**, which would take the whole
auth context down (the lockout shape described under Auth above). **Verified by
observing the real request** against a stub IdP that logs what arrives —
`auto`/`post` put the secret in the body, `basic` sends an
`Authorization: Basic` header and no body secret. That stub is the tool to reach
for here : two earlier guesses at this bug (a pinned `redirectURI`, then a
suspected empty secret) were both wrong, and only watching the actual outgoing
request settled it.

**The flow still has to start and finish on one origin.** The PKCE code-verifier
cookie is set on whichever origin began the exchange, so beginning on host A and
finishing on host B fails on the verifier even when the URIs line up.
`$lib/server/canonical-origin.ts`'s `offCanonicalOrigin()` is what closes that:
`/app-auth` 302s to the canonical origin (lossless, its state is the signed `rd`
param), and the dashboard sign-in page swaps its provider buttons for a link to
the canonical sign-in URL rather than offering a button that cannot work. **The
load-bearing detail is that it reads the `Host` (or `X-Forwarded-Host`) header,
not `url.origin`** : with `ORIGIN` set, SvelteKit normalizes `event.url` to the
configured origin, so a `url.origin` comparison can never detect the mismatch
and the guard is silently dead code, which is exactly how the first attempt at
it was written. The header is attacker-controllable, which is safe here because
it only ever decides _whether_ to redirect; the target is always
`config.auth.origin`, never derived from the request.

**Linking a provider to an existing account is explicit, and it has to be.**
better-auth refuses implicit linking when the **local** user row has
`emailVerified: false`, even for a trusted provider (`link-account.mjs`'s single
condition, which also covers `accountLinking.enabled`/`disableImplicitLinking`).
Homerun's bootstrap admin signs up with email and password while SMTP is
typically disabled, so `emailVerified` is false and can never become true : that
account could **never** link an OIDC provider, and the failure surfaced as a raw
`account_not_linked` code. The escape hatch (`requireLocalEmailVerified: false`)
is marked deprecated upstream — "the gate will become unconditional" — so
disabling it buys months and then breaks. The fix is therefore the explicit
path, not the loophole: `/profile/security` has a **Connected accounts** section
listing every enabled provider with Connect/Disconnect, driven by better-auth's
authenticated `linkSocial()`/`unlinkAccount()` (which bypass the gate entirely,
since being signed in is itself the proof both accounts are yours). Disconnect
is disabled while the user has no `credential` account, so nobody can strip
their own last sign-in method. **`unlinkAccount` takes `accountId`, not
`providerId`**, in this version, so the load returns each provider's
`account.accountId` alongside its linked flag.

**better-auth's own error UI is replaced by `/auth/error`** via
`onAPIError.errorURL`. Without it, a failed OAuth callback renders better-auth's
branded "Something went wrong" page with a raw code and an "Ask AI" button,
which is jarring in a self-hosted dashboard. The page maps the codes that
actually occur (`account_not_linked`, `state_mismatch`, `email_not_verified`,
`email_not_found`, `invalid_callback_request`) to plain language, and falls back
to a sane message for anything else. **It normalizes the incoming code**
(lowercase, spaces and hyphens to underscores) because better-auth emits
`"account not linked"` with spaces and it arrives slugified.

**The page performs the fix rather than describing it.** A first cut told the
user to go to Profile → Security themselves, which the user rightly rejected :
the page already knows everything needed to do it. For `account_not_linked` it
now renders a real **Link \<provider\> to this account** button (calling
`linkSocial()` inline) plus **Sign out**, when `locals.user` is set — and the
sign-in prompt only when nobody is signed in, since linking requires an
authenticated session. Which provider failed isn't in better-auth's redirect (it
only appends `error=`), so the two places that start an OAuth flow stash the
provider name in `sessionStorage` first (`$lib/oauth-attempt.ts`); the page
falls back to the only enabled provider when there's exactly one, and to a
button per provider otherwise, so it degrades instead of guessing wrong.

**Enabled providers now actually appear on the dashboard's own sign-in page**
too, as "Continue with …" buttons. They never did before: providers could be
configured but nothing rendered a button, and `/api/v1/auth/providers` was in
`hooks.server.ts`'s `customAuthPaths` allowlist while the route itself didn't
exist. **In this better-auth version `genericOAuth` registers its providers as
ordinary social providers** ("used through the standard `signIn.social` and
`callback/:id` core endpoints — no plugin-specific endpoints needed", from the
plugin's own types), so the client calls
`signIn.social({ provider, callbackURL })` and needs no extra client plugin —
there is no `genericOAuthClient` export in this version to add. `provider` is
typed as a union of the built-in social providers, so a custom provider id needs
a cast at that one call site.

## Per-app login wall (`service.authRequired` + policy columns, `/api/v1/auth-check`, `/app-auth`, `$lib/server/app-gate.ts`)

The gap this document used to describe at length — `authRequired` blocked
_everyone_ because there was no login page on the gated hostname and
`AUTH_CROSS_SUBDOMAIN` didn't rescue it — is closed. `authRequired` is now a
real login wall, and `crossSubdomainCookies` is unrelated to it (still a
supported setting, just not part of this flow).

**The mechanism, and the Traefik behaviour it rests on.** Traefik returns a
non-2xx forwardAuth response to the client _verbatim_, headers and all. So
`/api/v1/auth-check` can answer with a `302` **and** a `Set-Cookie`, and because
the browser sees that response as coming from the gated app's own hostname, the
cookie lands host-scoped there. That's the whole trick: no cross-subdomain
cookies, no second Traefik router, no extra container. **Verified directly
against Traefik v3** before any of this was built (a throwaway auth server and
backend behind the real dev Traefik): a 302 passes through with its `Location`,
custom headers and `Set-Cookie` intact; `X-Forwarded-Uri` carries the query
string; the original request's `Cookie` header reaches the auth server; and
`authResponseHeaders` injects identity headers into the backend request on a
2xx. Re-verify these if the middleware is ever reworked, the design has no
fallback if any of them stops holding.

The round trip, all of it through the one forwardAuth channel:

1. Anonymous request to `app.example.com/page` → auth-check → `302` to
   `<config.auth.origin>/app-auth?rd=<signed token>`. `rd` carries the original
   URL, the host and the service id, HMAC-signed with a 10-minute TTL, so it
   can't be used as an open redirect.
2. `/app-auth` (its own top-level route, outside `(protected)/` — it has to
   render for signed-out visitors) resolves the service. A signed-out visitor is
   `302`ed to the real `/auth/sign-in?redirectTo=/app-auth?rd=…`
   (`$lib/redirect-target.ts` keeps `redirectTo` same-origin), so passkeys, 2FA
   and the instance's preferred and enforced sign-in methods all apply exactly
   as for the dashboard; the sign-in page names the app
   (`$lib/server/app-gate-return.ts`), and once signed in shows a two-second
   "taking you to X" screen and returns with `window.location.assign`. It has to
   be a full page load: `/app-auth` answers an allowed user with a `302` to the
   app's own host, and a client-side `invalidateAll`/`goto` can't follow a
   cross-origin redirect, which is the real bug the old in-page form had (sign
   in, "redirecting…" toast, then nothing, fields disabled). An allowed user
   gets `302`ed to `app.example.com/__homerun_auth/callback?token=<60s grant>`;
   a signed-in user the app's policy refuses (including one who signed in with a
   method the app doesn't allow) gets the denial screen with "Sign in as someone
   else".
3. That callback path is itself gated, so it lands back in auth-check, which
   verifies the grant and answers `302` + `Set-Cookie` for the session cookie
   (`homerun_app_session`, `HttpOnly`/`SameSite=Lax`/`Secure` over https, **no
   `Domain`** so it stays host-only, 8h).
4. The original URL is re-requested, now carrying the cookie → `200`, plus
   `X-Homerun-User`/`-Email`/`-Name` (declared in the middleware's
   `authResponseHeaders`) so a proxy-header-aware app gets the identity for
   free.

`/__homerun_auth/logout` clears the cookie the same way.

**The hot path is DB-free.** The cookie is a self-contained signed token
(`$lib/server/app-gate.ts`), so a request with a valid one costs an HMAC verify
plus a 10s-TTL in-memory lookup of the service row
(`$lib/server/gated-service-cache.ts`, HMR-safe `globalThis` singleton, same
pattern as the db client). Every proxied request to a gated app goes through
this, so don't add a query to it.

**Revocation is immediate, and that's load-bearing.** The cookie embeds a
`policyVersion`, a short HMAC over the service's own auth policy; auth-check
recomputes it per request and challenges on a mismatch, and saving the policy
calls `invalidateGatedService()`. Without this, tightening an allowlist would
have left already-issued cookies working for up to 8 hours — observed for real
during live testing, which is what prompted adding it.

**User changes revoke too, through a cached re-check.** A cookie that passes the
signature/host/policy checks is also run through
`$lib/server/gate-access-cache.ts`'s `cachedGateAccess`, keyed by service, user
and policy version, which calls `AppAccessService.recheck()` (the full
`evaluate()`, now also refusing a missing or banned user) at most once every
five minutes and shares one in-flight promise between concurrent requests. So
the hot path stays DB-free between re-checks. `auth.ts` registers
`databaseHooks` `after` hooks on `user` update/delete and `account`
create/update/delete that call `forgetGateAccess(userId)`, so deleting, banning,
re-roling or changing the email of a user, or linking/unlinking an account, is
seen on the very next request. Those hooks fire for every better-auth
`internalAdapter` write (`removeUser`, `setRole`, `banUser`, `updateUser`,
self-service delete), but **a raw Drizzle write to `user` or `account` bypasses
them**: call `forgetGateAccess(userId)` after one. A re-check that throws (DB
down) is logged, not cached, and honours the cookie, matching the old DB-free
behaviour. The user's Homerun role counts as a group for `authAllowedGroups`
(`groupsAcross(accounts, role)`), which is what makes a role change on `/users`
a re-grouping for gated apps. For a service with `authAllowedGroups`,
`recheck()` first calls `auth.api.refreshToken({ body: { accountId, userId } })`
(no headers, so better-auth treats it as a trusted server call) for each linked
OAuth account holding a refresh token, throttled to once per five minutes per
user, so a group removed at the provider lands in the stored `idToken` well
before the 8h cookie expiry. A failed refresh is logged and the stored token is
used. `auth` is imported dynamically there so the unit tests importing
`app-access.service.ts` don't build better-auth.

**Config prerequisite**: `config.auth.origin` must be set, since that's where
visitors get sent to sign in. `updateAppAuth` refuses to turn the wall on
without it, and auth-check falls back to an explanatory 500 rather than a
mystery redirect. **`config.auth.origin` now falls back to the `ORIGIN` env
var** — it previously read only `homerun.yaml`/`instance_settings`, even though
`compose.prod.yaml`, the installer's generated stack and the integration harness
all set `ORIGIN`, and `auth.ts` warned based on `process.env.ORIGIN` while
`config.auth.origin` never read it.

**Turning the wall on or off applies live.** `buildContainerLabels` attaches the
forwardAuth middleware to every publicly routed service, wall on or off, and
auth-check answers `200` straight away for a service whose `authRequired` is
false (the same early return `pangolinOwnsAuth` uses). Saving on the Networking
tab or `PATCH /api/v1/services/:id` calls `invalidateGatedService()` so the 10s
service cache doesn't delay it. The cost, accepted on purpose: every routed app
now depends on the dashboard answering auth-check, so Traefik refuses all of
them while Homerun is down, and each request to an ungated app costs one cached
service lookup. Services deployed before this change need one redeploy to get
the middleware.

**The policy columns** on `service` (all jsonb, all `[]` by default):
`authProviders` (allowed sign-in methods, `"password"` for built-in credentials
or `"oauth:<provider name>"`), plus `authAllowedUserIds`/`authAllowedEmails`/
`authAllowedGroups`. `$lib/auth-providers.ts` is the pure module owning that
encoding (and the `*@domain` email matcher, and the preset catalogue);
`$lib/services/app-access.service.ts` evaluates a decision. **Nothing is
selected by default and the wall can't be turned on with an empty
`authProviders`** — that combination would lock out everyone including the
owner, so it's rejected at save time rather than allowed and warned about.

**"Which method did they use" is answered by linked identity, not by the
session.** better-auth's `session` table records no provider, so
`AppAccessService` checks whether the user has an `account` row whose
`providerId` matches an allowed method (`credential` ↔ `password`). Groups come
from decoding the claims of that row's stored `idToken` (`groups`, `roles`, and
Keycloak's `realm_access`/`resource_access` roles — a fixed list, deliberately
not per-provider config). A stricter session-bound check would need a side table
written at sign-in and still couldn't classify a pre-existing dashboard session.

**Verified end to end against real infrastructure**, not just reasoned about: a
real gated `nginx:alpine` container behind the real dev Traefik, driven with
curl as the browser through every hop — anonymous redirect, the login screen,
the grant, the host-scoped `Set-Cookie`, the app actually serving, a forged
cookie refused, logout, the identity headers, and a policy change revoking a
live cookie. `tests/integration/app-gate.test.ts` covers the same flow against
the real app (including cross-host cookie rejection and each denial reason), and
`tests/unit/app/app-gate.test.ts` covers token signing/expiry/tampering and
claim extraction.

## User roles & admin-managed accounts (`user.role`, `/users`, `invitation` table)

This moved from "anyone can `/auth/sign-up`" to a real single-instance model.
Roles are `"admin"`, `"developer"` and `"viewer"` (read-only, see Read-only role
above). Between admin and developer the difference is a label plus route-gating
only, not a permissions system: both roles get the full dashboard over every
shared resource (no shared-resource DTO filters by `userId`, which only records
the creator; see Shared resources in `data-and-config.md`), the only difference
is two admin-only pages, `/users` and `/settings` (`locals.isAdmin`, see below,
checked at the top of each `load`, plus the nav items are filtered out of
`(protected)/+layout.svelte`'s sidebar for non-admins).

- **The very first account becomes admin automatically**, whoever creates it.
  `hooks.server.ts`'s `authHandler` hard-blocks
  `POST /api/v1/auth/sign-up/email` (better-auth's real email/password sign-up
  endpoint) with a 403 once `AdminService.hasAnyUser()`
  (`$lib/services/admin.service.ts`, a raw query, no DTO exists for
  better-auth-owned tables) is true, the endpoint itself is blocked, not just
  the UI, so it can't be curled around. `/auth/sign-up` and `/auth/sign-in`'s
  own `load`s cross-redirect based on the same check (blank instance → sign-up;
  account exists → sign-in), so navigating to either one always lands somewhere
  sensible. Every account after the first is created by an admin from `/users`,
  direct-create (name/email/temp password/role, works with no SMTP, via
  `auth.api.createUser`) or email invite (`InvitationDTO` +
  `/auth/accept-invite/[token]`, gated behind `isSmtpEnabled()`).
- **Real, tested-in-review finding**: making the bootstrap-admin hook
  conditional on `!user.role` doesn't work. `auth.ts`'s
  `databaseHooks.user.create.before` is where the promotion happens, but the
  `admin()` plugin registers its _own_ `databaseHooks.user.create.before` (via
  its `init()`) that sets `role` to `options.defaultRole`, and depending on
  plugin/app hook-merge order, that can run _before_ the app-level one, so
  `user.role` is already truthy by the time this hook sees it. Verified live:
  with a `!user.role` guard, the bootstrap account came out `"developer"`, not
  `"admin"`. Fixed by checking `AdminService.hasAnyUser()` directly instead of
  `user.role`'s presence, both hooks run pre-insert, so it's still reliably
  false only before the very first user exists, regardless of ordering.
  `admin({ defaultRole: "developer" })` stays as the sane fallback for any
  creation path that doesn't pass an explicit role (shouldn't normally happen,
  direct-create and invite-accept both always pass one).
- **Real, tested-in-review finding**: `auth.api.removeUser` (the admin plugin's
  user-deletion endpoint) calls `internalAdapter.deleteUser()` directly, which
  does **not** run this app's `user.deleteUser.beforeDelete` option, that option
  is read and invoked only by better-auth's own self-service delete-account
  endpoints (`node_modules/better-auth/dist/api/routes/update-user.mjs` is the
  only place `beforeDelete`/`afterDelete` are referenced at all), not by
  `internalAdapter.deleteUser` generically. Calling `auth.api.removeUser`
  naively from an admin "remove user" action would cascade-delete that user's
  rows and leak their Docker containers/networks. Fixed by extracting the
  cleanup body out of `auth.ts`'s `beforeDelete` into
  `$lib/services/user.service.ts`'s
  `UserService.cleanupUserResources(userId, actingUserId?)`, called explicitly
  by both the self-service `beforeDelete` hook _and_ `/users`' `removeUser`
  action (passing the acting admin) before it calls `auth.api.removeUser`. It
  reassigns every shared row's `userId` (and `template.ownerId`,
  `invitation.invitedByUserId`) to the acting admin, else the oldest other
  admin, else the oldest other account, so nothing cascades; only the very last
  account's deletion removes containers and stack networks. A transferred git
  service builds with its new owner's git connection. By contrast
  `databaseHooks.user.create.before` (used for the role-promotion above)
  genuinely _is_ generic, `internalAdapter.createUser` goes through the same
  `createWithHooks` machinery regardless of caller, confirmed in
  `node_modules/better-auth/dist/db/internal-adapter.mjs`, so that one hook
  firing uniformly for self-service sign-up, `admin.createUser`, and
  invite-accept was safe to rely on.
- `/users`' `setEmail` action changes an address directly through the admin
  plugin's `auth.api.adminUpdateUser` (`{email, emailVerified: true}`, with the
  request headers so better-auth re-checks admin), after refusing an address
  another account already holds. It exists because self-service change-email on
  a verified address sends a confirmation to the old address, which never
  arrives without SMTP.
- `/users`' `removeUser`/`setRole` actions also refuse to strip the last
  remaining admin (`wouldRemoveLastAdmin()`, checked via
  `$lib/services/user.service.ts`'s `UserService.countAdmins()`) and refuse
  self-removal (mirroring better-auth's own guard on `admin.removeUser`, checked
  client-side too before it gets there).
- `/auth/accept-invite/[token]/+page.server.ts`'s `accept` action calls
  `auth.api.createUser` **without** a `headers` option, confirmed from
  `node_modules/better-auth/dist/plugins/admin/routes.mjs`: omitting
  `headers`/request context is treated as a trusted server-side call and skips
  the admin-role permission check entirely, which is correct here since the
  invite token itself (validated, single-use, expiring via
  `InvitationDTO.getByToken`) is the authorization, not an admin session.
  `/users`' own actions, by contrast, always pass `headers: request.headers` so
  better-auth's own permission check double-enforces admin-only on top of the
  route's own `locals.isAdmin` guard.
- `App.Locals.isAdmin` (declared in `app.d.ts`, was dead/aspirational like
  `logger`, see Logging below, until this feature) is now populated in
  `hooks.server.ts`'s `authHandler` right after `locals.user` is set
  (`locals.user?.role === "admin"`), for both the cookie-session and API-key
  paths. Every admin-only route checks `locals.isAdmin`, not
  `locals.user?.role === "admin"` inline.

## Onboarding (`instance_settings.onboardingCompletedAt`, `/onboarding`, `Stepper` component)

A signed-in user whose instance hasn't finished onboarding is forced to
`/onboarding` and can't reach anything else; `/onboarding` itself is unreachable
once it's done. **`src/routes/onboarding/` is its own top-level route, not
nested under `(protected)/`** (it predates that route group's current shape,
this doc previously said otherwise, see below), so the two directions are two
separate `load`s rather than one shared check: `(protected)/+layout.server.ts`
redirects into `/onboarding` when `!settings.onboardingComplete` (right after
its own `locals.user` check, same function that redirects signed-out visitors to
sign-in/sign-up, see Routing above), and `onboarding/+layout.server.ts`
redirects back out to `/` when `settings.onboardingComplete` is already true,
both reading the same `InstanceSettingsDTO.onboardingComplete` getter
(`onboardingCompletedAt !== null`). Onboarding is a property of the singleton
`instance_settings` row (see Instance settings above), not per-user, so once the
bootstrap admin finishes it, later developer accounts never see the wizard, that
falls out naturally from the flag living on the instance, not the account. Edge
case: an admin _could_ create another account before finishing onboarding
themselves, `/onboarding/+page.server.ts`'s own `load` checks `locals.isAdmin`
and shows a non-admin a "an admin needs to finish setting up this instance"
holding message instead of the real wizard rather than handing them
instance-wide config controls.

The Docker step shows a live **swarm readiness** block
(`DockerService.swarmReadiness()` via `getSwarmReadiness`): whether this daemon
is a swarm manager, whether the overlay network exists, and whether Traefik is
actually running its swarm provider, each read off the daemon rather than
assumed. It's informational, not a gate : standalone containers need none of it,
and Settings → Docker sets up whatever's missing when the mode is switched.
`packages/installer/swarm-join.sh` is still unverified against a real host.

**Doc correction**: this section previously described both directions as gated
from a single `(protected)/+layout.server.ts` load comparing `route.id` against
`"/(protected)/onboarding"`, following an earlier fix for a real
`url.pathname`-vs-`resolve()` bug (`resolve("/onboarding")` returns the relative
`"./onboarding"` in this app, not an absolute path, so an `===` check against
`url.pathname` always evaluated false and infinite-redirect-looped). That fix
and its `route.id` mechanism are gone now that `onboarding/` moved out from
under `(protected)/` into its own top-level route with its own reverse-direction
`load`; there is no `route.id` comparison anywhere in this codebase today. The
underlying gotcha (`resolve()` here returns a relative path, not useful for a
`url.pathname` equality check) is still real and still worth knowing if a future
gate needs one, just not implemented this way anymore.

`/onboarding/+page.svelte` is a 6-step wizard (Core / Docker / Traefik / Email /
DNS / Review) in a centred `max-w-3xl` column, each step a `panel` card with its
own header, closing on a Review step that lists what's about to be persisted.
It's built on the reusable `$lib/components/stepper.svelte` (connected circular
step markers with labels at `sm+`, a progress bar below that, `Button`
primitives for Back/Next), extracted from `services/new`'s inlined
step-indicator-bar-plus-Back/Next pattern (not retrofitted onto `services/new`
itself, a deliberate scope cut). `Stepper` owns navigation and which step is
unlocked (`reachableStep`, grows only after a passed `onNext`); the consuming
page owns field markup and validation, same "shared chrome, not shared shape"
split as `form-styles.ts`. No phantom errors: a field's error paragraph only
renders once that field's step has actually failed an attempted `Next`/submit
(tracked in the page's own `attempted: Set<number>` state, not the component's),
nothing shows on initial render. The finish action reuses the exact
`InstanceSettingsDTO.updateCore/updateDocker/updateTraefik/updateSmtp` methods
`/settings` already calls, plus `updateCloudflare`/`updatePangolin` for
whichever DNS integration the DNS step switched on, then
`markOnboardingComplete()`, then `applyAndRebuild()` (the same post-save helper
`/settings` uses, so the dashboard DNS record is synced too). The DNS step
shares its form parsing and "Test connection" checks with Settings → Networking
through `$lib/server/validation/dns-settings-form.ts`; Pangolin's target
host/port and `pangolinOwnsAuth` aren't shown and are preserved; the Newt fields
are shown and validated with the same `newtFieldsError`. Its Test buttons post
`?/testCloudflare`/`?/testPangolin` from the same wizard form, and the page's
submit function routes those through their own promise toast **without calling
`update()`**: a successful action result invalidates `data`, and every wizard
field is a writable `$derived` over `data`, so `update()` would reset everything
typed so far. Secrets (`smtpPassword`, both API tokens) are stripped from the
`values` echoed back on a failed finish.

## Trusted origins (`$lib/services/auth-origins.ts`)

better-auth's `trustedOrigins` is a function reading `config` live, built by
`trustedOriginsFor`: the `ORIGIN` env, the Dashboard URL, and `http(s)://` of
both the Dashboard URL's host and the Base domain. Real bug this fixes: an
install whose `ORIGIN` is its IP (installer default) rejected every sign-in
reached through its resolved DNS name with "Invalid origin". Subdomains of the
Base domain are deliberately **not** wildcarded: they're deployed apps, same
site as the dashboard, and must not be able to drive its auth endpoints.

**The server's own address is always trusted** (`directAccessOrigins`): when a
request's `Host` header is an IP literal or `localhost`, `http(s)://<Host>` is
added per request. Real lockout this fixes: changing the Base domain / Dashboard
URL to a wrong domain moved Traefik's routing, and signing back in at
`http://<ip>:3000` (the published port still answers) failed with "Invalid
origin", because SvelteKit rewrites `event.url` to `ORIGIN` and the IP was in no
trusted list. It's a same-origin check (a cross-site page can't make a browser
send another site's `Host`), limited to IP literals so DNS rebinding can't use
it. `csrfHandler` got the matching rule: an `Origin` whose host equals `Host`
passes. better-auth only enforces origins on requests carrying a cookie, and
**skips the check entirely when `NODE_ENV=test`**, which is what the integration
suite's spawned app inherits, so `advanced.disableOriginCheck: false` is set
explicitly; the suite now exercises the production behaviour
(`tests/integration/auth.test.ts` signs in from an IP `Host` that isn't
`ORIGIN`, and refuses a cross-site one). Session cookies are only `Secure` when
`ORIGIN` is `https`, and the installer writes `http://<ip>:3000`, so the cookie
sticks over plain http too; an instance with an `https` `ORIGIN` still can't
keep a session over `http://<ip>`.

## Passkeys, 2FA and sign-in requirements

`twoFactor({ allowPasswordless: true })` (TOTP + backup codes) and `passkey()`
are wired server and client side. `passkey`'s `rpID` is the hostname of
`config.auth.origin` (`$lib/security-policy.ts`'s `passkeyRpId`): without it
better-auth fell back to `localhost`, since `baseURL` is deliberately never set
(see above), so passkeys could never work on a real domain. Users manage both
from Profile → Security (`two-factor-panel.svelte`, `passkey-panel.svelte`,
reads through `AccountSecurityService`). The sign-in page offers a passkey
button (labelled "Continue with a passkey" because e2e selects the `Sign in`
button by name prefix) and the TOTP/backup-code step on `twoFactorRedirect`.

Changing the Dashboard URL's hostname strands every passkey on the instance (a
credential only signs for the rp id it was registered under). Settings → General
computes the next rp id from the typed Base domain / Dashboard URL
(`nextPasskeyRpId`), compares it against the running one
(`strandedPasskeyCount`, count from
`AccountSecurityService.countAllPasskeys()`), shows an inline warning, and
cancels the enhance submit behind a confirm dialog until the admin accepts.

`instance_settings.require_two_factor` / `require_passkey`, edited on
`/authentication`, are enforced by the `(protected)` layout load only for cookie
sessions (`locals.session`), never for API key/bearer/CLI tokens: a user missing
one is redirected to `/security-setup?next=…`, an `AuthShell` card outside
`(protected)` that shows only the panels still needed. Known gaps: form actions
and remote functions hit directly aren't gated, and better-auth only asks for
the TOTP code on email/password sign-in, not passkey or OAuth.

## Preferred sign-in methods

`instance_settings.preferred_sign_in_methods` (jsonb string[], null = none),
edited in the "Preferred sign-in methods" section of `/authentication`. Keys are
`password`, `passkey` and `oauth:<provider name>` (`$lib/sign-in-methods.ts`,
`oauthMethod`). The sign-in load builds the methods actually available on this
request (passkey only when `passkeyUsableOn`, enabled OAuth providers) and
`splitSignInMethods` puts the preferred ones up front and the rest behind an
"Other sign-in methods" link. A preference matching nothing available (a deleted
provider, passkey on the wrong host) falls back to showing everything, so the
page can never render with no way in. When `passkey` is among the preferred
methods (and usable on this host), the sign-in page prompts for a passkey on
load instead of starting the conditional autofill request, since a second
WebAuthn call would abort the first. Cancelling, or a browser that refuses a
prompt without a click (Safari), fails silently and leaves the passkey button in
place.

## Homerun as an OIDC provider (`@better-auth/oauth-provider`, `$lib/oidc-provider.ts`, `/authentication/apps`, `/auth/consent`)

`oidcProviderPlugins()` in `auth.ts` adds better-auth's `jwt` plugin (RS256 key
pairs in the `jwks` table, since plenty of apps' OIDC libraries reject the EdDSA
default) and `oauthProvider` (`loginPage: "/auth/sign-in"`,
`consentPage: "/auth/consent"`, scopes
`openid profile email offline_access groups`, claims from `oidcClaimsFor`:
`groups` is `[user.role]`, `preferred_username` the email's local part).
`@better-auth/oauth-provider` is pinned to the installed better-auth version
(1.7.1); the two move together. Issuer is `<config.auth.origin>/api/v1/auth`,
discovery at `/api/v1/auth/.well-known/openid-configuration`, which
`svelteKitHandler` already forwards. **The plugins are only added when
`config.auth.origin` is set**: `baseURL` is deliberately unset (see the
`buildAuth` comment), and the provider's `init()` builds
`new URL(issuer ?? baseURL)`, which throws on an empty base; `rebuildAuth()`
adds them once settings supply the origin. `sveltekitCookies` must stay the
**last** plugin, better-auth warns otherwise and the provider's after-hooks set
cookies.

**Tables** (`jwks`, `oauth_client`, `oauth_access_token`, `oauth_refresh_token`,
`oauth_consent`, `oauth_client_assertion`, plus the unused `oauth_resource` /
`oauth_client_resource`) are hand-written from `getAuthTables()` output. Every
`string[]`/`json` field is a `text` column: the drizzle adapter is configured
with `provider: "sqlite"`, which makes better-auth JSON-encode arrays itself.
`OauthClientDTO` reads them back with a tolerant JSON parse. Token and consent
rows cascade from the client's `client_id`.

**Client management goes through better-auth, reads don't.** Create, update and
rotate call `auth.api.adminCreateOAuthClient` / `adminUpdateOAuthClient` /
`rotateClientSecret` via `OauthAppService`, so secrets get generated and hashed
the way the token endpoint expects. Real, tested finding: the "admin",
server-only create endpoint still loads the session and runs `clientPrivileges`
(`user.role === "admin"`), and answers a bare 401 with no body without request
`headers`. Its `APIError`s carry an empty `message` too, the text lives in
`body.error_description`; `authErrorMessage()` digs it out. Redirect URIs must
be `https` and not loopback for web clients (the plugin rejects
`http://localhost`), `parseOauthAppForm` refuses non-https up front with a
readable message.

**Three request-path changes the provider needed**, all verified by
`tests/e2e/ui-oidc-provider.spec.ts` (register, signed-out authorize → sign-in →
code, token exchange, id_token claims, userinfo, consent):

1. **CSRF.** SvelteKit's `csrf.checkOrigin` runs before any hook and 403s
   `application/x-www-form-urlencoded` POSTs without a same-origin `Origin`,
   which is exactly what an app's server sends to `/oauth2/token`. It's turned
   off (`csrf: { trustedOrigins: ["*"] }` in `vite.config.ts`) and reimplemented
   as `csrfHandler`, first in `hooks.server.ts`'s sequence
   (`$lib/server/csrf.ts`), exempting only the token, introspect, revoke and
   end-session paths. Remote-function origin checks are separate in SvelteKit
   and unaffected.
2. **API keys.** `applyApiKeyAuth` treats any `Authorization: Bearer` without a
   session as an API key and 401s it; `isOidcProviderPath` skips that fallback
   for `/oauth2/*`, `/.well-known/*` and `/jwks`, since userinfo is called with
   an OAuth access token.
3. **Sign-in resume.** `/oauth2/authorize` without a session redirects to
   `/auth/sign-in?<original params>&sig=…`; `oauthProviderClient()` in
   `auth-client.ts` adds the signed query to every non-GET auth call from that
   page, and the provider's after-hook answers the sign-in (password, 2FA
   verify, passkey) with a redirect back into authorize. The sign-in page
   detects the flow (`sig` + `client_id`), names the app, shows "taking you
   back", and must not navigate itself (no `goto("/")`, no `redirectTo`), and
   its load doesn't bounce an already-signed-in user so `prompt=login` works.
