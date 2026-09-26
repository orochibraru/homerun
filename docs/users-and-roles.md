# Users and roles

Homerun has four roles, **admin**, **developer**, **read-only** and **app access
only**. Every dashboard account sees every resource on the instance, and every
admin or developer account manages it: services, stacks, volumes, backups, S3
destinations, build cache registries, remote hosts, cron jobs, status pages,
custom templates and the job queue are shared, whoever created them. Each one
still records who created it. What stays personal is your sessions, API keys,
preferences, git provider connections, terminal sessions, bell feed and
notification channels. Every account gets a copy of each bell notification, and
every account's own notification channels hear about every event. Between admin
and developer, the only difference is a few admin-only pages, **Users**,
**Authentication**, **Settings**, **System Logs**, **Registry**, **Docker
Cleanup** and **DNS**, plus admin-only actions elsewhere: registering a git
provider's OAuth app and host-command cron jobs. There's no finer-grained
permission system yet (no per-stack access control, no teams).

**Read-only** accounts see everything a developer sees but can't change
anything: every form, button and API call that writes is refused with "This
account or API key is read-only", enforced on the server for form actions,
remote commands and the REST API alike, and the dashboard header shows a
**Read-only** badge. What they can still do is look after their own account:
sign out, change their password, manage passkeys and two-factor, set
preferences, clear their notification bell, create API keys (always read-only)
and log in the CLI. They don't see the admin-only pages.

**App access only** accounts never see the dashboard. They exist so you can let
someone (a client, a friend, the family) through the [login wall](login-wall.md)
of the apps you choose without giving them anything else. They sign in on the
normal sign-in page, with a password, passkey, OAuth provider or emailed code
like anyone else, and are sent straight back to the app they were trying to
open. Opening the dashboard URL directly lands them on a small **Your apps**
page instead: the apps whose login wall currently lets them through (pull
request previews show their PR number and title), their passkeys and two-factor
setup, and a Sign out button. Every dashboard page, form, remote call and REST
API route refuses them on the server, not just in the menu, and so does the MCP
endpoint. They can't create or use API keys or log in the CLI, and an API key
they held under an earlier role stops working. They can still use **Sign in with
Homerun** apps (see [Sign in with Homerun](sign-in-with-homerun.md)), since
that's a login for an app, not for Homerun. To share an app with one, tick them
under **Users** on the app's Security tab, or add `app-user` to its **Groups /
roles** to let every app-access account in.

**The first account created on a fresh instance becomes admin automatically.**
After that, there's no public sign-up, every other account is created by an
admin from `/users`:

- **Direct-create**, name/email/role only, no password to set or hand over. The
  new account signs in itself the first time: it enters its email on the sign-in
  page and, since it doesn't have a password yet, is walked through choosing one
  there (a 6-digit emailed code first if SMTP is configured, so the person
  really owns that address; straight to picking a password if it isn't). Works
  with no email setup either way. With emailed codes switched on, that step also
  offers **Skip the password, sign in with emailed codes**.
- **Email invite**, only shown once SMTP is configured (see
  [Configuration](configuration.md)); sends a link to
  `/auth/accept-invite/<token>`, valid for 7 days. The pending list on `/users`
  shows only invites that can still be accepted; an expired one drops off, and
  inviting the same address again replaces it. While emailed codes or links are
  switched on (Authentication → Sign-in), the invite page lets the person choose
  between **Set a password** and **Emailed codes**: the second creates the
  account with no password at all, and they sign in each time with a code sent
  to their address.

**Inviting a client to review a pull request preview.** Invite them with the
**App access only** role, and on the preview's parent service's Security tab
allow **Emailed code** and tick them under **Users** (previews copy their
parent's login wall). They accept the invite with **Emailed codes**, open the
preview link, enter their email, paste the code, and land on the preview; no
password is ever created.

Without SMTP configured, `/users` shows a warning: anyone who knows a
direct-created account's email can beat its real owner to the sign-in page and
choose that account's password themselves, since there's no code step proving
who's asking. Set up SMTP (see [Configuration](configuration.md)) before
direct-creating an account if that's a real risk on your instance, or use email
invites instead, which already require it.

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

## Onboarding

The forced first-run wizard (see
[Getting started](getting-started.md#first-boot)) is a property of the
_instance_, not the account, once the bootstrap admin finishes it, later
developer accounts never see it. If an admin invites someone before finishing
onboarding themselves, that person sees a holding message instead of the wizard
(they don't get instance-wide config controls).
