---
page_title: "homerun_bucket (Resource)"
description: "A bucket on an object store."
---

# homerun_bucket (Resource)

A bucket on an object store.

## Example usage

```terraform
resource "homerun_bucket" "example" {
  store_id        = homerun_object_store.example.id
  name            = "uploads"
  expiration_days = 30
}
```

## Schema

### Required

- `name` (String) Changing it replaces the resource.
- `store_id` (String) Changing it replaces the resource.

### Optional

- `expiration_days` (Number) Delete objects this many days after they're
  written.
- `public` (Boolean) Serve the bucket's objects to anyone at
  /public/{storeId}/{bucket}/{key}, without signing in. Defaults to `false`.

### Read-only

- `id` (String) The object's id.

## Import

Import an existing object by its `<store_id>/<name>`, with an `import` block:

```terraform
import {
  to = homerun_bucket.example
  id = "<store_id>/<name>"
}
```

or the command line:

```shell
terraform import homerun_bucket.example "<store_id>/<name>"
```
