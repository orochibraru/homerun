# Object storage

**Object Storage** (needs the Object storage permission, under **Storage** in
the sidebar) gives you S3 buckets without paying for a cloud: a built-in object
store Homerun runs for you, plus any S3-compatible provider you connect, side by
side. On top of it, Homerun keeps Terraform state, so infrastructure code needs
no paid backend either. The page has four tabs: **Buckets**, **Stores**,
**Built-in** and **Terraform State**.

## The built-in store

**Built-in → Run the built-in object store** starts a single
[Garage](https://garagehq.deuxfleurs.fr) node next to the registry. Its data
lives in Docker volumes, so turning it off stops the container and keeps every
bucket and object for when it's back on. Homerun sets the node up on first start
and gives itself an access key it uses to manage buckets; you never see or need
that key.

Other containers on Homerun's network reach it at `http://homerun-garage:3900`.
To use it from anywhere else, set a hostname under **Publish it**: Traefik
routes that hostname to the store's S3 API with TLS, and the
[DNS automation](dns-automation.md) points it at this server like the
registry's. Only the S3 API is ever published, never Garage's admin API.

The tab shows whether the container runs and how much its buckets hold.

## Connecting a provider

**Stores → Connect a store** adds any S3-compatible provider: AWS S3, Google
Cloud Storage's interoperability keys, Hetzner Object Storage, Cloudflare R2,
MinIO and the like. Give it a name, the endpoint (scheme and host only, e.g.
`https://fsn1.your-objectstorage.com`), the region (`us-east-1` when left empty)
and an access key. Homerun lists the provider's buckets with the key before
saving it, so a typo never lands. The secret is stored encrypted and never shown
again; editing a store with the secret left empty keeps it. Removing a store
forgets the connection and the Terraform state projects kept on it; the buckets
and their objects stay at the provider.

Requests use path-style addressing (the bucket in the path), which every
S3-compatible store accepts.

## Buckets

**Buckets** lists every bucket on every store, with how many objects it holds
and their size. The built-in store reports exact numbers instantly; for a
provider, Homerun counts by listing at most 10,000 objects and shows `10,000+`
beyond that. A store that can't be listed (unreachable, a revoked key) is
reported above the list instead of hiding the rest. **New bucket** creates one
on the store you pick; names are 3 to 63 lowercase letters, digits, dots or
dashes.

Click a bucket for its page:

- **Endpoint and region** to copy into a client.
- **Lifecycle**: expire every object a number of days after it was written, or
  leave it empty to keep objects until you delete them. It replaces any
  lifecycle rule the bucket had.
- **Access keys** (built-in store only): a key scoped to this one bucket, with
  read, write and owner permissions. The secret is shown once, as environment
  variables ready to paste. Revoking a key deletes it everywhere. For a
  provider, keys are managed in its own console.
- **Use for backups** adds the bucket as a [backup destination](backups.md):
  with a read/write key of its own on the built-in store, with the store's own
  credentials for a provider. On the built-in store that destination uses the
  published hostname when there is one, the address on Homerun's network
  otherwise.
- **Delete bucket** deletes an empty bucket. A bucket that still holds objects
  is refused with a plain message rather than emptied for you.

## Terraform state

**Terraform State** keeps each Terraform configuration's state in a bucket you
pick, through Terraform's `http` backend. **New state project** takes a name, a
store, a bucket and an optional folder inside it; the project page then shows
the backend block to paste:

```hcl
terraform {
  backend "http" {
    address        = "https://homerun.example.com/api/v1/iac/projects/<id>/state"
    lock_address   = "https://homerun.example.com/api/v1/iac/projects/<id>/lock"
    unlock_address = "https://homerun.example.com/api/v1/iac/projects/<id>/lock"
    lock_method    = "POST"
    unlock_method  = "DELETE"
    username       = "homerun"
  }
}
```

Terraform authenticates with HTTP Basic: any username, and an API key (**Profile
→ API keys**) as the password, set as `TF_HTTP_PASSWORD` so it stays out of the
file. The key needs write access to Infrastructure as code to write or lock the
state; with read access it can only read it.

- **Versions.** Every state Terraform writes is kept as its own object in the
  bucket and listed newest first, with its serial, when, who (the API key's
  owner) and its size. Nothing is overwritten.
- **Diff.** Open a version to see which resources it added, changed and removed
  compared with the version before it.
- **Rollback.** **Roll back** on an older version writes it back as the newest
  state, with a serial past the latest so Terraform accepts it. The versions in
  between stay in the history. It's refused while the state is locked.
- **Lock.** Terraform locks the state for every plan and apply, and a second run
  is refused with the first one's lock info until it finishes. The lock lives in
  Homerun, not in the bucket, so it works on every store. **Force unlock**
  releases a lock left behind by a run that died; only use it when that run is
  really gone.

Deleting a project forgets it, its versions and its lock; the state files stay
in the bucket.

Pulumi doesn't speak Terraform's backend protocol, so the project page also
shows a `pulumi login` command that points Pulumi straight at the same bucket
and folder, with an access key for the bucket in `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY`. Pulumi then keeps its own history and locks in the
bucket; the versions, diff and rollback above only cover Terraform.
