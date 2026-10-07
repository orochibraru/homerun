---
page_title: "homerun_status_page (Resource)"
description: "A status page."
---

# homerun_status_page (Resource)

A status page.

## Example usage

```terraform
resource "homerun_status_page" "example" {
  name  = "Status"
  slug  = "status"
  scope = "global"
}
```

## Schema

### Required

- `name` (String)
- `scope` (String) global, stack or custom.
- `slug` (String)

### Optional

- `description` (String)
- `domains` (List of String) Domains a public page also answers on.
- `is_public` (Boolean) Defaults to `false`.
- `services` (List of Object) The services a custom page shows. See the nested
  schema for `services` below.
- `stack_id` (String)

### Read-only

- `id` (String) The object's id.

### Nested schema for `services`

Required:

- `service_id` (String)

Optional:

- `include_children` (Boolean) Defaults to `false`.

## Import

Import an existing object by its id, with an `import` block:

```terraform
import {
  to = homerun_status_page.example
  id = "<id>"
}
```

or the command line:

```shell
terraform import homerun_status_page.example "<id>"
```
