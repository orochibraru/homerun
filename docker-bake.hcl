variable "TAG" {
  default = "latest"
  validation {
    condition     = TAG != ""
    error_message = "The variable 'TAG' must not be empty."
  }
}

variable "IMAGE" {
  default = "orochibraru/homerun"
  validation {
    condition     = IMAGE != ""
    error_message = "The variable 'IMAGE' must not be empty."
  }
}

variable "AGENT_IMAGE" {
  default = "orochibraru/homerun-agent"
  validation {
    condition     = AGENT_IMAGE != ""
    error_message = "The variable 'AGENT_IMAGE' must not be empty."
  }
}

// Special target: https://github.com/docker/metadata-action#bake-definition
// CI runs this once per image (app, then agent), each time with a fresh
// bake-meta.json merged in and env IMAGE pointed at that image's own
// registry path — so this single generic target name is safe to share
// across both, only one of them is ever built per invocation.
target "docker-metadata-action" {
  tags = ["${IMAGE}:latest", "${IMAGE}:${TAG}"]
}

target "docker-metadata-action-agent" {
  tags = ["${AGENT_IMAGE}:latest", "${AGENT_IMAGE}:${TAG}"]
}

group "default" {
  targets = ["app-local", "agent-local"]
}

// ---- Main app image ----

target "app" {
  inherits   = ["docker-metadata-action"]
  context    = "."
  dockerfile = "./Dockerfile"
  args = {
    APP_VERSION = "${TAG}"
  }
}

target "app-local" {
  inherits = ["app"]
  output   = ["type=docker"]
}

target "app-all" {
  inherits   = ["app"]
  cache-from = ["type=gha,scope=app"]
  cache-to   = ["type=gha,mode=max,scope=app"]
  platforms = [
    "linux/amd64",
    "linux/arm64"
  ]
}

// ---- Homerun Agent image ----

target "agent" {
  inherits = ["docker-metadata-action-agent"]
  // Repo root, not agent/ : the Dockerfile copies the root package.json +
  // agent/ + tsconfig.json.
  context    = "."
  dockerfile = "./agent/Dockerfile"
}

target "agent-local" {
  inherits = ["agent"]
  output   = ["type=docker"]
}

target "agent-all" {
  inherits   = ["agent"]
  cache-from = ["type=gha,scope=agent"]
  cache-to   = ["type=gha,mode=max,scope=agent"]
  platforms = [
    "linux/amd64",
    "linux/arm64"
  ]
}
