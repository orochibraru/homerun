# Env vars

Plain key/value rows on the Env Vars tab, stored as-is (not encrypted, don't put
a raw plaintext secret you'd mind leaking in the DB dump into an env var if you
can avoid it; registry passwords and similar have their own encrypted fields
instead).

**Link a service** in the new-service wizard's Environment step fills those rows
in for you from a service you already run, in any stack or none: pick it, and
Homerun recognises what it is from its image (PostgreSQL, MySQL/MariaDB,
MongoDB, Redis/Valkey, RabbitMQ, or a plain HTTP service) and reads the
credentials off its own env vars. You then choose the shape you want:

- **Connection URL**, e.g. `POSTGRES_URL=postgres://app:secret@db:5432/app`.
- **JDBC URL** (relational engines only), e.g.
  `jdbc:postgresql://db:5432/app?user=app&password=secret`.
- **One variable per value**, e.g. `DB_HOST`, `DB_PORT`, `DB_USER`,
  `DB_PASSWORD`, `DB_DB`.

The suggested variable name (or prefix) is a default, not a rule, rename it to
whatever your app expects before adding it. The host in every generated value is
the linked service's slug, which is how services already reach each other on the
shared network, so this works across stacks and needs no extra networking.

## Env files

Under the variables, **Env files** lists `.env` files on this host, one absolute
path per line, read at every deploy through a short-lived helper container (so
they work even though Homerun itself runs in a container). A later file wins
over an earlier one, and the service's own variables win over both. A file that
can't be read fails the deploy, the same as a missing `env_file` fails
`docker compose up`. Only an admin can change the list, since the files are read
off the host.
