# Sign in with Homerun

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
