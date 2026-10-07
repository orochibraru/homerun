---
page_title: "homerun_template (Data Source)"
description: "A built-in or custom template, by id or name."
---

# homerun_template (Data Source)

A built-in or custom template, by id or name.

## Example usage

```terraform
data "homerun_template" "example" {
  name = "PostgreSQL"
}
```

## Schema

### Optional

- `id` (String) The object's id. Set it, or `name`, to pick the object.
- `name` (String)

### Read-only

- `category` (String)
- `container_port` (Number)
- `cpu_limit` (String)
- `description` (String)
- `env_vars` (Map of String)
- `image` (String)
- `memory_limit_mb` (Number)
- `tag` (String)
- `volumes` (List of String)
