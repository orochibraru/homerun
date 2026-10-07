---
page_title: "homerun_stack (Resource)"
description: "A stack: a group of services sharing a network."
---

# homerun_stack (Resource)

A stack: a group of services sharing a network.

## Example usage

```terraform
resource "homerun_stack" "example" {
  name        = "Media"
  slug        = "media"
  description = "Everything that serves the media library."
}
```

## Schema

### Required

- `name` (String)
- `slug` (String)

### Optional

- `description` (String)
- `icon` (String)
- `parent_id` (String) The stack this one is nested in.

### Read-only

- `id` (String) The object's id.

## Import

Import an existing object by its id, with an `import` block:

```terraform
import {
  to = homerun_stack.example
  id = "<id>"
}
```

or the command line:

```shell
terraform import homerun_stack.example "<id>"
```
