# Storage & backups

## Storage volumes

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

## S3 destinations

A **destination** (`/s3-destinations`) is a named, reusable S3 target, defined
once and pointed at by as many volumes as you like, rather than retyping a
bucket and credentials per volume. Each one is a name, an endpoint URL, a
bucket, a region, an access key id and a secret access key (stored encrypted at
rest, same scheme as registry passwords). Anything S3-compatible works: AWS S3,
MinIO, Cloudflare R2, Backblaze B2, Wasabi, and so on, addressed path-style.

The page has the same search box and pager as every other list page. A
destination can't be deleted out from under a volume without the volume simply
losing its target, so a volume whose destination is gone reports "no
destination" and its backups fail with a config error rather than silently doing
nothing.

## S3-compatible backups

Turned on per-volume from `storage/[volumeId]`, off by default: pick a
destination, optionally a key prefix, and optionally a cron schedule. Homerun
tars the volume's contents and uploads it as
`<prefix/>volumeName-<timestamp>.tar.gz` through a hand-rolled Signature V4
client (single-request PUT, no multipart, no SDK).

**Both volume kinds are backed up.** A bind mount's contents are tarred straight
off the host filesystem. A Docker-managed volume's contents aren't visible
there, so Homerun mounts it read-only into a short-lived `alpine` helper
container that tars it to stdout instead, that container is removed as soon as
it exits, and a failure to read the volume fails the run with the helper's own
stderr attached.

Set a cron schedule alongside the destination to back up automatically; the
scheduler mirrors the [scheduled-redeploy](services.md#scheduled-redeploy) shape
(a 60-second tick, a due-check, a guard against double-firing in the same
minute). Enabled schedules also show up on the
[Scheduling page](operations.md#the-scheduling-page) alongside cron redeploys
and cron jobs.

Backups, scheduled or from a "Run now" button, are queued and run in the
background (see [the job queue](services.md#the-job-queue)), so the button
returns straight away and the run shows up in the history on `/backups` once it
starts. A failed backup is retried once.

By default nothing is quiesced: Homerun reads the volume as it is, while the
services using it keep running, which is fine for files but can produce a torn
copy of a database that's mid-write. Two per-volume options on the same form fix
that:

- **Stop services during the backup** stops every running service that mounts
  the volume just before the tar, and starts them again as soon as it's done
  (before the upload), whether the tar worked or not. The services are down for
  the length of the tar.
- **Pre-backup command** runs a shell command (`/bin/sh -c`) inside a service's
  running container before each backup, for example
  `pg_dump -U postgres -f /var/lib/postgresql/data/dump.sql app` or
  `mysqldump ... > /var/lib/mysql/dump.sql`. Write the dump into the volume
  being backed up so it ends up in the archive. **Run it in** picks which
  service's container it runs in; left on the default, it's the first running
  service that mounts the volume. The command runs while the service is still up
  (before any stop), a non-zero exit or a run longer than 15 minutes fails the
  backup with the tail of its output, and nothing is uploaded.

## Backup history

`/backups` is one row per attempt across every volume, scheduled or manual,
backups and restores alike, with its kind, when it started and finished, whether
it succeeded, the size, and the error if it didn't (hover the kind for the
object key). It has a search box (matching volume name, object key or error), a
Kind filter (backup/restore), an Outcome filter (success/failed/running) and a
pager over the whole history, so a long-running instance with hundreds of past
runs can page all the way back through them instead of only ever seeing the
newest handful. The same "Run now" button is available here as on a volume's own
page.

## Restoring a backup

A volume with a destination has a **Restore** panel on its own page. **List
backups** reads what's in the bucket for that volume (under its key prefix),
newest first with date and size, and **Restore** on one of them queues a restore
that downloads it and unpacks it back into the volume, for both volume kinds,
through the same kind of short-lived `alpine` helper container.

Two options sit above the list and apply to whichever backup you restore:

- **Wipe the volume first** deletes everything in the volume before unpacking,
  so files that weren't in the backup don't survive. Off, the restore unpacks
  _over_ the volume: files in the archive replace the ones on disk and anything
  else is left alone.
- **Stop services during the restore** (on by default) stops every running
  service that mounts the volume for the wipe and unpack, and starts them again
  afterwards, even when the restore fails. Turn it off only if you've stopped
  them yourself or nothing writes to the volume, otherwise it can end up with
  half-old, half-new data.

Restores go through [the job queue](services.md#the-job-queue) like backups, so
the button returns straight away. The download happens before anything is
stopped, so services are only down for the unpack. A restore shares the volume's
lock with backups (it never runs while the same volume is being backed up), is
never retried, and shows up in the run log on the volume's page and on
`/backups` as a `Restore` row.

You can still fetch a backup from the bucket yourself (`aws s3 cp`, `rclone`,
your provider's console) if you'd rather unpack it somewhere else.

## Next steps

- [Services: Volumes tab](services.md#volumes)
- [Build servers & the Homerun Agent](remote-hosts-and-agent.md)
