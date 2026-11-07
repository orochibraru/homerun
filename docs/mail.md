# Mail server

**Mail** (needs the Mail permission, under **Networking** in the sidebar) turns
Homerun into a mail server for your own domains. Homerun runs
[docker-mailserver](https://docker-mailserver.github.io/docker-mailserver/latest/)
for you and keeps its domains, mailboxes and aliases in its own database: you
never edit docker-mailserver's files or run its `setup` script. The page has
four tabs: **Domains**, **Mailboxes**, **Aliases** and **Server**.

## Before you start

Self-hosted mail only works when the internet can reach the server and trusts
it:

- Ports **25**, **465**, **587** and **993** must be open to the internet. Many
  cloud and residential providers block outgoing port 25 by default; ask yours
  to lift it, or mail you send never leaves.
- The server's IP needs a **reverse DNS (PTR)** record pointing at the mail
  hostname. Only your hosting provider can set it.
- Pangolin and other tunnels don't carry SMTP: the server needs a public IP of
  its own.

## Setting it up

1. **Domains → New domain**: add the domain you want addresses on. Homerun
   generates a DKIM key for it.
2. On the domain's page, add the records it lists at your DNS provider: an MX
   pointing at the mail hostname, SPF, the DKIM key and DMARC. Each one shows
   whether public resolvers (Cloudflare's and Google's) already see it; **Check
   again** re-reads them. When the domain sits under a domain linked to a DNS
   provider on the [DNS page](dns-automation.md), **Publish** creates or fixes
   them for you.
3. **Mailboxes → New mailbox**: an address, a password (10 to 72 characters) and
   an optional quota in MB.
4. **Server → Run the mail server**, then **Save**.

docker-mailserver won't start without a mailbox, so the container only runs once
the server is on, has a hostname and at least one enabled mailbox. The banner at
the top of the page says which is missing.

## The Server tab

- **Run the mail server** starts or removes the `homerun-mail` container. Mail,
  queues and settings live in the `homerun-mail-*` Docker volumes, so turning it
  off keeps every message for when it's back on.
- **Hostname** is the name the server greets other servers with and every
  domain's MX points at. It defaults to `mail.<base domain>`. Traefik issues its
  certificate like any routed hostname, and the mail server reads it from
  Traefik's `acme.json`; its address record is created by the DNS automation
  like the dashboard's. When Traefik's certificate store isn't an `acme.json` at
  the root of a volume, the tab says so and the server runs without TLS, which
  mail apps refuse to sign in over.
- **Client settings**: IMAP on port 993 (SSL/TLS) and SMTP on port 465 (SSL/TLS)
  or 587 (STARTTLS), both at the mail hostname. The username is always the full
  address.

Spam filtering and DKIM signing are rspamd's; mail rspamd flags lands in the
mailbox's Junk folder. ClamAV, SpamAssassin and Fail2ban are off to keep the
container under a gigabyte of memory.

## Mailboxes and aliases

A mailbox's page edits its display name, quota and whether it's enabled, and
changes its password. A disabled mailbox can't sign in and its address stops
receiving mail; what it holds is kept. Deleting a mailbox wipes its mail.

An alias forwards an address to one or more others, on this server or anywhere
else. Leave its name empty and it becomes the domain's **catch-all**: anything
sent to an address on the domain that isn't a mailbox or another alias goes to
it. Deleting a domain deletes its mailboxes, their mail and its aliases.

Every change is applied in the background through the
[job queue](scheduling.md#the-job-queue): Homerun rewrites docker-mailserver's
config files and the server picks them up within seconds, without a restart.

## Not built yet

No webmail, no REST API, MCP tools or CLI commands for mail, no per-user sign-in
to change one's own password, and no backup of the mail volumes through
[Backups](backups.md) beyond what you set up on them yourself.
