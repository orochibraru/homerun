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

**Nothing is quiesced before the tar runs.** Homerun reads the volume as it is,
while the service using it keeps running, which is fine for files but can
produce a torn copy of a database that's mid-write. For a database, prefer a
cron job running that database's own dump tool into a bind-mounted directory,
and back up that directory instead.

## Backup history

`/backups` is one row per attempt across every volume you own, scheduled or
manual, with when it started and finished, whether it succeeded, the uploaded
size, and the error if it didn't. It has a search box (matching volume name), an
Outcome filter (success/failed/running) and a pager over the whole history, so a
long-running instance with hundreds of past runs can page all the way back
through them instead of only ever seeing the newest handful. The same "Run now"
button is available here as on a volume's own page.

**There's no restore flow yet**, uploads only. Retrieve a backup from your S3
destination directly (`aws s3 cp`, `rclone`, your provider's console) and unpack
it into the bind-mount path (or into a named volume, through a helper container
of your own) by hand.

## Next steps

- [Services: Volumes tab](services.md#volumes)
- [Build servers & the Homerun Agent](remote-hosts-and-agent.md)
