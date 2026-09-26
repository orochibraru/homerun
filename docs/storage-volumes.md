# Storage volumes

A **storage volume** (`/storage`) is a named source you define once, then mount
into one or more services from each service's Volumes tab:

- **Bind mount**, an absolute path on the host filesystem.
- **Docker-managed volume**, a named Docker volume, created/managed by Docker
  itself.

Docker's own bind-vs-named-volume syntax is what tells the two apart under the
hood; you just pick a kind and a source when creating one. A volume becomes
"shared" simply by being mounted into more than one service, there's no separate
"shared volume" concept to configure.

`/storage` has a search box, Kind and Backups filters, a list/card view toggle,
and a pager once you have more than a page's worth, same toolkit as the
[services list](services.md#the-services-list), searched/paginated server-side
the same way.

Tick volumes (or the select-all box above the list, which covers the current
page) to bring up a bottom bar with bulk **Enable backups**, **Disable backups**
and **Delete**. Enabling only turns backups on for volumes that already have a
schedule and an S3 destination set on their backup settings page; the rest are
skipped and counted in the result. Bulk delete asks for confirmation first, and
services mounting a deleted volume need a redeploy.

## A database's data volume

A new database or cache service gets a Docker volume named `<slug>-data` mounted
at its engine's data directory when it's created with no volume of its own,
whether from the deploy wizard, a template (its linked containers included) or
the API, so a redeploy doesn't start it empty. The deploy wizard shows it as a
pre-filled row on its Volumes step, remove the row to create the service without
one:

| Engine                                  | Mounted at                                                               |
| --------------------------------------- | ------------------------------------------------------------------------ |
| PostgreSQL (and forks)                  | `/var/lib/postgresql` on 18 and later, `/var/lib/postgresql/data` before |
| MySQL, MariaDB                          | `/var/lib/mysql`                                                         |
| MongoDB                                 | `/data/db`                                                               |
| Redis, Valkey, Dragonfly, KeyDB, Garnet | `/data`                                                                  |
| RabbitMQ                                | `/var/lib/rabbitmq`                                                      |

Memcached holds nothing worth keeping and gets none. A service that already
existed isn't changed: mounting a volume on it later starts it from an empty
data directory.

## Browsing and editing files

A volume's **Files** tab (the **Browse** button next to it on `/storage` and on
a service's Volumes tab opens it directly) browses what's inside it and edits
text files in the browser, for config files you'd otherwise need a shell for (an
nginx `default.conf`, an app's `config.yaml`). Folders open by clicking them; a
text file up to 1 MB opens in an editor, and **Save** writes it in place,
keeping its owner and permissions. A volume that is a single bound file, the way
Dokploy file mounts are imported, shows that one file. Binary files can be
browsed but not edited.

Each action runs a short-lived Alpine container with the volume mounted
(read-only, except while saving), so it works the same for bind mounts and
Docker volumes and needs nothing installed on the host. A saved file is picked
up the next time the services using it read it; most apps only read their config
at start, so restart them after saving.

## The Volumes tab

Mount a storage volume into the container path of your choice, read-write or
read-only, from a service's Volumes tab, including creating a brand-new volume
inline without leaving the page.
