# Your profile

The profile pages (reached from the avatar menu, not the sidebar) are per
account:

- **Personal information**, your name and email. Changing an unverified email
  takes effect immediately; a verified one needs confirming from a link sent to
  the address you're leaving, so it stays locked until SMTP is configured or an
  admin changes it for you from `/users` (see
  [Known, real limitations](faq-and-limitations.md#known-real-limitations-not-hypothetical)).
- **Security**, change your password, connect or disconnect OAuth providers (see
  [Connecting a provider to an existing account](authentication-providers.md#connecting-a-provider-to-an-existing-account)),
  set up [two-factor authentication and passkeys](two-factor-and-passkeys.md),
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
  see [Notifications](notifications.md).

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

## Git provider accounts

Separate from signing in to Homerun: connecting a GitHub, GitLab, Gitea or
Bitbucket account on the **Git Providers** page lets a git-based service pick
its repository and branch instead of pasting a URL, reach private ones without a
token in the clone URL, and deploy on every push through a webhook Homerun adds
for you. An admin registers the OAuth app once for the instance; each person
connects their own account to it. See
[Connecting a git provider](git-providers.md).
