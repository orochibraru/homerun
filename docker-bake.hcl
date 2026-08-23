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
