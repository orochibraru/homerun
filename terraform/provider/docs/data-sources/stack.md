---
page_title: "homerun_stack (Data Source)"
description: "A stack, by id or slug."
---

# homerun_stack (Data Source)

A stack, by id or slug.

## Example usage

```terraform
data "homerun_stack" "example" {
  slug = "media"
}
```

## Schema

### Optional

- `id` (String) The object's id. Set it, or `slug`, to pick the object.
- `slug` (String)

### Read-only

- `description` (String)
- `icon` (String)
- `name` (String)
- `parent_id` (String) The stack this one is nested in.
