---
page_title: "homerun_service_dependency (Resource)"
description: "One service depending on another, started before it."
---

# homerun_service_dependency (Resource)

One service depending on another, started before it.

## Example usage

```terraform
resource "homerun_service_dependency" "example" {
  service_id    = homerun_service.app.id
  depends_on_id = homerun_service.database.id
}
```

## Schema

### Required

- `depends_on_id` (String) Changing it replaces the resource.
- `service_id` (String) Changing it replaces the resource.

### Read-only

- `id` (String) The object's id.

## Import

Import an existing object by its id, with an `import` block:

```terraform
import {
  to = homerun_service_dependency.example
  id = "<id>"
}
```

or the command line:

```shell
terraform import homerun_service_dependency.example "<id>"
```
