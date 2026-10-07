---
page_title: "homerun_object_store (Resource)"
description: "An S3-compatible object store."
---

# homerun_object_store (Resource)

An S3-compatible object store.

## Example usage

```terraform
resource "homerun_object_store" "example" {
  name              = "r2"
  endpoint          = "https://<account>.r2.cloudflarestorage.com"
  access_key_id     = var.r2_access_key_id
  secret_access_key = var.r2_secret_access_key
}
```

## Schema

### Required

- `access_key_id` (String)
- `endpoint` (String)
- `name` (String)
- `secret_access_key` (String, Sensitive) Write-only: the API never returns it,
  so Terraform can't detect a change made outside it.

### Optional

- `region` (String) Defaults to `"us-east-1"`.

### Read-only

- `id` (String) The object's id.
- `kind` (String)

## Import

Import an existing object by its id, with an `import` block:

```terraform
import {
  to = homerun_object_store.example
  id = "<id>"
}
```

or the command line:

```shell
terraform import homerun_object_store.example "<id>"
```
