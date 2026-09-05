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

## S3-compatible backups

Configured per-volume on `storage/[volumeId]`, off by default. Homerun tars the
volume's contents and uploads it as `<prefix/>volumeName-<timestamp>.tar.gz` to
any S3-compatible endpoint, AWS S3, MinIO, R2, Backblaze B2, etc., via a
hand-rolled Signature V4 client (path-style addressing, single-request PUT, no
multipart).

**Bind-mount volumes only.** A Docker-managed volume's contents aren't visible
on the host filesystem the same way, so it's rejected, backing those up would
need a short-lived helper container to read the data out, which isn't built yet.

Set a cron schedule alongside the S3 destination to back up automatically; the
scheduler mirrors the [scheduled-redeploy](services.md#scheduled-redeploy) shape
(a 60-second tick, a due-check, a guard against double-firing in the same
minute).

Backups, scheduled or from a "Run now" button, are queued and run in the
background (see [the job queue](services.md#the-job-queue)), so the button
returns straight away and the run shows up in the history on `/backups` once it
starts. A failed backup is retried once.

**There's no restore flow yet**, uploads only. Retrieve a backup from your S3
destination directly (`aws s3 cp`, `rclone`, your provider's console) and
restore it into the bind-mount path by hand.

## Next steps

- [Services: Volumes tab](services.md#volumes)
- [Remote hosts](remote-hosts-and-agent.md), note that bind-mount volumes are
  skipped entirely on a remote-hosted deploy (a local path has no meaning on a
  different machine)
