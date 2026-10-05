# Blocked paths and IP bans

Bots scan every public address for the same things: `.env` files, `.git`
folders, WordPress login pages, database dumps. A service can tell Traefik to
turn those requests away before they reach the app, and Homerun can ban an
address that keeps trying.

## Blocked paths

On a service's **Security** tab, **Blocked paths** takes one pattern per line. A
request whose path matches one of them gets a 403 and never reaches the app.

- A pattern matches whole path segments anywhere in the path: `.git` blocks
  `/.git`, `/.git/config` and `/app/.git/HEAD`, but not `/.github`.
- Starting a pattern with `/` matches from the root only: `/admin` blocks
  `/admin` and `/admin/users`, not `/blog/admin`.
- `*` matches anything, slashes included (`*.sql` blocks `/backups/db.sql`), and
  `?` matches one character.
- Matching ignores case.

A pattern that would match every path (`*` or `/*`) is refused: stop the service
or turn on its login wall instead.

**Presets** add a ready-made list to the box, which you can then edit:

- **WordPress probes**: `wp-admin`, `wp-login.php`, `wp-config.php*`,
  `wp-content`, `wp-includes`, `wp-json`, `xmlrpc.php`. Don't use it on a real
  WordPress site.
- **Sensitive files**: `.env` and `.env.*`, `.git`, `.git-credentials`,
  `.gitconfig`, `.svn`, `.hg`, `.aws`, `.ssh`, `.htpasswd`, `.htaccess`,
  `.npmrc`, `.DS_Store`, SQL dumps, backups and editor swap files, private keys.
- **Admin tools**: `phpmyadmin`, `phpinfo.php`, `adminer.php`, `server-status`,
  `cgi-bin`.

Saving redeploys a running service, since the rule is part of its Traefik
routing; a stopped service picks it up on its next deploy. Blocked paths apply
on every one of the service's domains, before its login wall, and its pull
request previews and canary inherit them.

Visitors see the **Blocked path** page, branded and worded under
[Settings → Error pages](error-pages.md). Without Traefik's dynamic config
directory (Settings → Networking), Traefik answers a bare 403 instead, and
blocked requests aren't counted towards a ban.

## IP bans

Every blocked request is counted against the address it came from. An address
that makes too many of them is banned on every service at once: Traefik answers
all its requests with a 403 until the ban ends. **Settings → IP bans** sets the
rule, on by default:

- **Blocked requests**: how many it takes (10 by default),
- **Within**: in how many minutes (10 by default, up to a day),
- **Ban for**: how many hours the ban lasts (24 by default, 0 for good).

The same page lists the banned addresses, why and until when, each with an
**Unban** button. Expired bans are lifted within a minute. Turning bans off
keeps blocking the paths and only stops new bans; bans already in place stay
until they expire or you lift them.

The dashboard's own address is never blocked by a ban, so a banned admin can
still sign in and lift it.

**Which address gets banned.** It's the address Traefik sees the connection come
from, the only one it can match a ban against. Behind a proxy or tunnel
(Pangolin, Cloudflare's proxy, a load balancer), that's the proxy, not the
visitor. Homerun never bans a private, loopback, link-local or carrier-grade NAT
address (which is how a Pangolin tunnel or a Docker network reaches Traefik),
nor an address in Cloudflare's published proxy ranges, so a proxy can't get
every visitor behind it banned. Behind such a proxy, blocked paths still work;
bans just don't happen. Only requests that really went through a blocked-paths
router count: requesting the Blocked path page directly never does.
