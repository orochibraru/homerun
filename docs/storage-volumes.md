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

## The Volumes tab

Mount a [storage volume](storage-volumes.md) into the container path of your
choice, read-write or read-only, from the Volumes tab, including creating a
brand-new volume inline without leaving the page. A volume becomes "shared"
simply by mounting it into more than one service.
