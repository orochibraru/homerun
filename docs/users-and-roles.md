# Users and roles

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
[Docker Cleanup](docker-cleanup.md)), plus admin-only actions elsewhere:
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

- **Direct-create**, name/email/role only, no password to set or hand over. The
  new account signs in itself the first time: it enters its email on the sign-in
  page and, since it doesn't have a password yet, is walked through choosing one
  there (a 6-digit emailed code first if SMTP is configured, so the person
  really owns that address; straight to picking a password if it isn't). Works
  with no email setup either way.
- **Email invite**, only shown once SMTP is configured (see
  [Configuration](configuration.md)); sends a link to
  `/auth/accept-invite/<token>`, valid for 7 days. The pending list on `/users`
  shows only invites that can still be accepted; an expired one drops off, and
  inviting the same address again replaces it.

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
