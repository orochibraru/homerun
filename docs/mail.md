# Mail server

**Mail** (needs the Mail permission, under **Networking** in the sidebar) turns
Homerun into a mail server for your own domains. Homerun runs
[docker-mailserver](https://docker-mailserver.github.io/docker-mailserver/latest/)
for you and keeps its domains, mailboxes and aliases in its own database: you
never edit docker-mailserver's files or run its `setup` script. The page has
five tabs: **Domains**, **Mailboxes**, **Aliases**, **Logs** and **Server**.

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

1. Add the domain on the [DNS page](dns-automation.md) if it isn't there yet:
   mail domains are picked from that list, not typed in.
2. **Domains → New domain**: pick it. Homerun generates a DKIM key for it.
3. On the domain's page, add the records it lists at your DNS provider: an MX
   pointing at the mail hostname, SPF, the DKIM key and DMARC. Each one shows
   whether public resolvers (Cloudflare's and Google's) already see it; **Check
   again** re-reads them. When the domain is linked to a DNS provider,
   **Publish** creates or fixes them for you.
4. **Mailboxes → New mailbox**: an address, a password (10 to 72 characters) and
   an optional quota in MB.
5. **Server → Run the mail server**, then **Save**.
6. **Server → Run self-test** to see that everything is reachable.

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

## Self-test

**Server → Run self-test** checks, without changing anything:

- that the container runs;
- that ports 25, 465 and 587 answer with an SMTP greeting at the mail hostname;
- that IMAP on 993 serves a certificate valid for the hostname, and how long it
  has left (a warning under two weeks);
- that the server can reach another mail server on port 25, which many providers
  block;
- that the server's address has a reverse DNS (PTR) record naming the hostname;
- that the outgoing queue is empty;
- that every domain has its MX, SPF, DKIM and DMARC records.

The ports are probed from the server itself against its public hostname. A home
router without hairpin NAT can fail those checks while the internet gets through
fine: try a mail app from outside to be sure.

## Logs and failures

**Logs** shows what Postfix, Dovecot and rspamd printed, from the mail
container's output: the last 500, 1500 or 5000 lines, everything or only
warnings and errors or only deliveries, searchable by address or queue id. Above
them, counts of bounced and deferred messages, failed sign-ins and other errors
in those lines, and every bounce or delay with the receiving server's own
answer.

Homerun also watches the server every five minutes and raises a
[notification](notifications.md) when:

- the container stops, or keeps restarting (and again once it's back);
- outgoing messages bounce, or get deferred, with who they were for and why;
- applying a change to domains, mailboxes or aliases fails.

The page's banner says when the container is down or restarting, with its last
exit code and a link to the logs.

## Mail client

**Server → Deploy Roundcube** creates a [Roundcube](https://roundcube.net)
service from the built-in template, already set to this mail server's IMAP (993)
and SMTP (465) at the mail hostname, and deploys it. It's an ordinary service:
give it a domain of its own on its Networking tab, see its logs, back its volume
up. The tab lists every Roundcube service with a link to open it. The mail
container answers to the mail hostname on Homerun's network, so Roundcube
reaches it there with a matching certificate.

## Mailboxes and aliases

A mailbox's **Overview** shows the space it uses against its quota, its message
and unread counts, and each folder with its size; any folder can be emptied from
there. It also lists the settings for a mail app and sends a test email from the
mailbox, which is the quickest way to see outgoing mail arrive, signed, at
another provider or at a checker like mail-tester.com. Its **Settings** edit the
display name, quota and whether it's enabled, change its password and delete it.
A disabled mailbox can't sign in and its address stops receiving mail; what it
holds is kept. Deleting a mailbox wipes its mail.

An alias forwards an address to one or more others, on this server or anywhere
else. Leave its name empty and it becomes the domain's **catch-all**: anything
sent to an address on the domain that isn't a mailbox or another alias goes to
it. Deleting a domain deletes its mailboxes, their mail and its aliases.

Every change is applied in the background through the
[job queue](scheduling.md#the-job-queue): Homerun rewrites docker-mailserver's
config files and the server picks them up within seconds, without a restart.

## Not built yet

No REST API, MCP tools or CLI commands for mail, no per-user sign-in to change
one's own password, and no backup of the mail volumes through
[Backups](backups.md) beyond what you set up on them yourself.
