---
page_title: "homerun_volume_mount (Resource)"
description: "A volume mounted into a service, applied on its next deploy."
---

# homerun_volume_mount (Resource)

A volume mounted into a service, applied on its next deploy.

## Example usage

```terraform
resource "homerun_volume_mount" "example" {
  service_id     = homerun_service.example.id
  volume_id      = homerun_volume.example.id
  container_path = "/var/lib/postgresql/data"
}
```

## Schema

### Required

- `container_path` (String)
- `service_id` (String) Changing it replaces the resource.
- `volume_id` (String) Changing it replaces the resource.

### Optional

- `read_only` (Boolean) Defaults to `false`.

### Read-only

- `id` (String) The object's id.

## Import

Import an existing object by its id, with an `import` block:

```terraform
import {
  to = homerun_volume_mount.example
  id = "<id>"
}
```

or the command line:

```shell
terraform import homerun_volume_mount.example "<id>"
```
