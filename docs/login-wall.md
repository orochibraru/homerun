# Per-app login wall

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
