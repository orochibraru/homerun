// Package buildinfo carries what a Homerun binary knows about its own build.
package buildinfo

// Version is the release a binary was built from, stamped in by
// scripts/build-packages.ts with
// -ldflags "-X github.com/orochibraru/homerun/internal/buildinfo.Version=1.2.3",
// so every binary reports the one version the whole repo shares and none reads
// a file at runtime. "dev" means an unstamped local build.
var Version = "dev"
