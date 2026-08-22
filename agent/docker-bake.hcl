variable "TAG" {
  default = "latest"
  validation {
    condition = TAG != ""
    error_message = "The variable 'TAG' must not be empty."
  }
}

variable "IMAGE" {
  validation {
    condition = IMAGE != ""
    error_message = "The variable 'IMAGE' must not be empty."
  }
}

// Special target: https://github.com/docker/metadata-action#bake-definition
target "docker-metadata-action" {
  tags = ["${IMAGE}:latest", "${IMAGE}:${TAG}"]
}

group "default" {
  targets = ["image-local"]
}

target "image" {
  inherits   = ["docker-metadata-action"]
  // Repo root, not agent/ : the Dockerfile copies the root package.json +
  // agent/ + tsconfig.json, matching the root docker-bake.hcl's own
  // context convention.
  context    = "."
  dockerfile = "./agent/Dockerfile"
}

target "image-local" {
  inherits = ["image"]
  output   = ["type=docker"]
}

target "image-all" {
  inherits   = ["image"]
  cache-from = ["type=gha,scope=agent"]
  cache-to   = ["type=gha,mode=max,scope=agent"]
  platforms = [
    "linux/amd64",
    "linux/arm64"
  ]
}
