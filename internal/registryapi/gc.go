package registryapi

import "strings"

// KeepTagPrefix prefixes the synthetic tag a kept but untagged manifest is
// pinned under, so the registry's own untagged sweep doesn't reap it.
const KeepTagPrefix = "homerun-keep-"

// KeepSet is what a garbage-collection pass must keep: whole tags (whatever
// digest they point at now) and specific digests.
type KeepSet struct {
	Digests []Digest `json:"digests"`
	Tags    []TagRef `json:"tags"`
}

// TagRef is one repository:tag.
type TagRef struct {
	Repository string `json:"repository"`
	Tag        string `json:"tag"`
}

// Plan is a garbage-collection pass: manifests to delete, kept digests to pin
// under a keep tag first, and repositories left with nothing in them.
type Plan struct {
	Deletes             []Digest
	EmptiedRepositories []string
	KeptManifests       int
	Pins                []Tag
}

// KeepTagFor is the synthetic tag a kept digest is pinned under.
func KeepTagFor(digest string) string {
	hex := strings.Replace(digest, "sha256:", "", 1)
	if len(hex) > 32 {
		hex = hex[:32]
	}
	return KeepTagPrefix + hex
}

// key is a repository+digest (or tag) map key.
func key(repository, value string) string {
	return repository + "@" + value
}

// PlanGC diffs the registry's inventory against keep: every manifest not kept
// is deleted, every kept digest with no tag in a known repository gets a pin,
// and every repository with no surviving manifest is reported as emptied.
func PlanGC(inventory []Tag, repositories []string, keep KeepSet) Plan {
	keptTags := map[string]bool{}
	for _, entry := range keep.Tags {
		keptTags[key(entry.Repository, entry.Tag)] = true
	}
	keptDigests := map[string]bool{}
	for _, entry := range keep.Digests {
		keptDigests[key(entry.Repository, entry.Digest)] = true
	}
	tagged := map[string]bool{}
	for _, entry := range inventory {
		tagged[key(entry.Repository, entry.Digest)] = true
		if keptTags[key(entry.Repository, entry.Tag)] {
			keptDigests[key(entry.Repository, entry.Digest)] = true
		}
	}

	var plan Plan
	seen := map[string]bool{}
	for _, entry := range inventory {
		id := key(entry.Repository, entry.Digest)
		if !keptDigests[id] && !seen[id] {
			seen[id] = true
			plan.Deletes = append(plan.Deletes, Digest{Digest: entry.Digest, Repository: entry.Repository})
		}
	}

	known := map[string]bool{}
	for _, name := range repositories {
		known[name] = true
	}
	pinned := map[string]bool{}
	for _, entry := range keep.Digests {
		id := key(entry.Repository, entry.Digest)
		if known[entry.Repository] && !tagged[id] && !pinned[id] {
			pinned[id] = true
			plan.Pins = append(plan.Pins, Tag{Digest: entry.Digest, Repository: entry.Repository, Tag: KeepTagFor(entry.Digest)})
		}
	}

	survivors := map[string]bool{}
	for id := range keptDigests {
		if tagged[id] {
			plan.KeptManifests++
		}
		if repository, _, ok := strings.Cut(id, "@"); ok && (tagged[id] || pinned[id]) {
			survivors[repository] = true
		}
	}
	plan.KeptManifests += len(plan.Pins)
	for _, name := range repositories {
		if !survivors[name] {
			plan.EmptiedRepositories = append(plan.EmptiedRepositories, name)
		}
	}
	return plan
}
