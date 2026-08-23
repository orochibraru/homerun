variable "TAG" {
  default = "latest"
}

group "default" {
  targets = ["app", "agent"]
}

target "base" {
  context    = "."
  platforms = [
    "linux/amd64",
    "linux/arm64"
  ]
  args = {
    APP_VERSION = "${TAG}"
  }
}

// cache-from/cache-to below are the single-platform default (a plain local
// `docker buildx bake app`, no matrix, nothing to collide with). CI's build
// job builds each platform in its own matrix job and overrides both of these
// per-platform (scope suffixed with PLATFORM_PAIR, see docker.yaml's bake-action
// `set:` block), two concurrent jobs writing mode=max to the *same* gha scope
// otherwise race the GitHub Actions cache API and one fails with
// "failed to reserve cache".
target "app" {
  inherits   = ["base"]
  dockerfile = "./Dockerfile"
  tags       = ["orochibraru/homerun:latest", "orochibraru/homerun:${TAG}"]
  cache-from = ["type=gha,scope=app"]
  cache-to   = ["type=gha,mode=max,scope=app"]
}

target "agent" {
  inherits   = ["base"]
  dockerfile = "./agent/Dockerfile"
  tags       = ["orochibraru/homerun-agent:latest", "orochibraru/homerun-agent:${TAG}"]
  cache-from = ["type=gha,scope=agent"]
  cache-to   = ["type=gha,mode=max,scope=agent"]
}
