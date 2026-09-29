# Redirects

**Redirects** (sidebar, Infrastructure) sends a hostname, or a path under one,
to another URL. Traefik answers the request itself, no container is involved.

Each redirect has:

- **Source**: a hostname (`old.example.com`) or a hostname plus a path prefix
  (`example.com/blog`). The prefix matches on a path boundary: `/blog` and
  `/blog/post` match, `/blogger` doesn't.
- **Destination**: a full `http://` or `https://` URL.
- **Keep the path and query string**: on, `old.example.com/a/b?x=1` goes to
  `https://new.example.com/a/b?x=1` (with a path prefix, the prefix is dropped
  and the rest is appended to the destination). Off, every request goes to the
  destination exactly as written.
- **Permanent redirect**: on sends a 308, off a 307. Browsers cache permanent
  redirects, so start temporary while testing.
- **Enabled**: off keeps the redirect around without serving it.

Each source can only have one redirect.

## How it's served

Every create, edit and delete rewrites one Traefik file-provider file
(`homerun-redirects.yml` in the dynamic config directory, the same place custom
certificates and the dashboard's own route live), and the app rewrites it again
on boot. Traefik watches the directory, so a change is live within moments with
no restart. On an instance with no dynamic config directory, nothing is written
(see [Networking](networking.md)).

Point the source hostname's DNS at this server yourself: redirects don't create
DNS records. Traefik requests a certificate for the source like it does for any
domain, unless your instance certificate already covers it.
