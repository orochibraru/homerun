---
page_title: "homerun_dns_connection (Resource)"
description: "An account at a DNS provider Homerun manages records through."
---

# homerun_dns_connection (Resource)

An account at a DNS provider Homerun manages records through.

## Example usage

```terraform
resource "homerun_dns_connection" "example" {
  name         = "cloudflare"
  dns_provider = "cloudflare"
  credentials = {
    apiToken = var.cloudflare_token
  }
}
```

## Schema

### Required

- `credentials` (Map of String, Sensitive) The provider's credential fields, by
  key. Write-only: the API never returns it, so Terraform can't detect a change
  made outside it.
- `dns_provider` (String) The DNS provider's id, e.g. cloudflare. Changing it
  replaces the resource.
- `name` (String)

### Read-only

- `id` (String) The object's id.
- `set_fields` (List of String)

## Import

Import an existing object by its id, with an `import` block:

```terraform
import {
  to = homerun_dns_connection.example
  id = "<id>"
}
```

or the command line:

```shell
terraform import homerun_dns_connection.example "<id>"
```
