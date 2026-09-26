package release

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

var (
	versionRe = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$`)
	buildRe   = regexp.MustCompile(`^[A-Za-z]+\.(\d+)$`)
)

// Version is a parsed semver-ish version: major, minor, patch and an optional
// prerelease, build metadata ignored.
type Version struct {
	Core       [3]int
	Prerelease string
}

// ParseVersion parses a version with an optional leading v, false when it
// isn't one.
func ParseVersion(input string) (Version, bool) {
	match := versionRe.FindStringSubmatch(strings.TrimSpace(input))
	if match == nil {
		return Version{}, false
	}
	var version Version
	for i := range 3 {
		version.Core[i], _ = strconv.Atoi(match[i+1])
	}
	version.Prerelease = match[4]
	return version, true
}

// IsNewer reports whether candidate is a strictly newer version than
// current: a release outranks its own prereleases, and prereleases compare
// identifier by identifier, numbers numerically (canary.10 after canary.9).
// Two main builds (canary.N, nightly.N) compare by build number alone, since
// both channels stamp the commit count of the same push to main.
// False when either doesn't parse, so a dev build never "updates" anywhere.
func IsNewer(candidate, current string) bool {
	left, okLeft := ParseVersion(candidate)
	right, okRight := ParseVersion(current)
	if !okLeft || !okRight {
		return false
	}
	for i := range 3 {
		if left.Core[i] != right.Core[i] {
			return left.Core[i] > right.Core[i]
		}
	}
	return comparePrerelease(left.Prerelease, right.Prerelease) > 0
}

// comparePrerelease orders two prerelease strings, an empty one (a release)
// above any other.
func comparePrerelease(a, b string) int {
	switch {
	case a == b:
		return 0
	case a == "":
		return 1
	case b == "":
		return -1
	}
	if buildA, buildB := buildRe.FindStringSubmatch(a), buildRe.FindStringSubmatch(b); buildA != nil && buildB != nil {
		return compareIdentifier(buildA[1], buildB[1])
	}
	left, right := strings.Split(a, "."), strings.Split(b, ".")
	for i := range min(len(left), len(right)) {
		if order := compareIdentifier(left[i], right[i]); order != 0 {
			return order
		}
	}
	return len(left) - len(right)
}

// compareIdentifier orders two prerelease identifiers: numerically when both
// are numbers, as strings otherwise.
func compareIdentifier(a, b string) int {
	left, errLeft := strconv.Atoi(a)
	right, errRight := strconv.Atoi(b)
	if errLeft == nil && errRight == nil {
		return left - right
	}
	return strings.Compare(a, b)
}

// LatestPrerelease asks GitHub for the newest published prerelease on
// channel ("canary" or "nightly"), one per merge to main tagged
// v<version>-<channel>.<n> by publish.yaml, and returns its tag and version.
func LatestPrerelease(client *http.Client, channel string) (string, string, error) {
	var releases []struct {
		githubRelease
		Prerelease bool `json:"prerelease"`
	}
	if err := fetchJSON(client, "?per_page=30", &releases); err != nil {
		return "", "", err
	}
	for _, candidate := range releases {
		if !candidate.Prerelease || !strings.Contains(candidate.TagName, "-"+channel+".") {
			continue
		}
		if _, ok := ParseVersion(candidate.TagName); ok {
			return candidate.TagName, strings.TrimPrefix(candidate.TagName, "v"), nil
		}
	}
	return "", "", fmt.Errorf("No %s release found.", channel)
}
