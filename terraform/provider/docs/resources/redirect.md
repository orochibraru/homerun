---
page_title: "homerun_redirect (Resource)"
description: "A hostname, or a path under it, redirected to another URL."
---

# homerun_redirect (Resource)

A hostname, or a path under it, redirected to another URL.

## Example usage

```terraform
resource "homerun_redirect" "example" {
  source      = "www.example.com"
  destination = "https://example.com"
}
```

## Schema

### Required

- `destination` (String)
- `source` (String)

### Optional

- `enabled` (Boolean) Defaults to `true`.
- `keep_path` (Boolean) Defaults to `true`.
- `permanent` (Boolean) Defaults to `true`.

### Read-only

- `id` (String) The object's id.

## Import

Import an existing object by its id, with an `import` block:

```terraform
import {
  to = homerun_redirect.example
  id = "<id>"
}
```

or the command line:

```shell
terraform import homerun_redirect.example "<id>"
```
