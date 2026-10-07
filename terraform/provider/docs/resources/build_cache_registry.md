---
page_title: "homerun_build_cache_registry (Resource)"
description: "A registry git builds use as their layer cache."
---

# homerun_build_cache_registry (Resource)

A registry git builds use as their layer cache.

## Example usage

```terraform
resource "homerun_build_cache_registry" "example" {
  name         = "build-cache"
  registry_url = "ghcr.io/acme/build-cache"
  username     = "acme"
  password     = var.build_cache_token
}
```

## Schema

### Required

- `name` (String)
- `password` (String, Sensitive) Write-only: the API never returns it, so
  Terraform can't detect a change made outside it.
- `registry_url` (String)
- `username` (String)

### Read-only

- `id` (String) The object's id.
- `password_set` (Boolean)

## Import

Import an existing object by its id, with an `import` block:

```terraform
import {
  to = homerun_build_cache_registry.example
  id = "<id>"
}
```

or the command line:

```shell
terraform import homerun_build_cache_registry.example "<id>"
```
