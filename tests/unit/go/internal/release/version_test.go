package release_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/release"
)

func TestIsNewer(t *testing.T) {
	cases := []struct {
		candidate, current string
		want               bool
	}{
		{"1.0.41", "1.0.40", true},
		{"v1.0.41", "1.0.40", true},
		{"1.0.40", "1.0.41-canary.100", false},
		{"1.0.41", "1.0.41-canary.100", true},
		{"1.0.41-canary.100", "1.0.41-canary.99", true},
		{"1.0.41-canary.9", "1.0.41-canary.10", false},
		{"1.0.41-canary.3", "1.0.40", true},
		{"1.0.41-canary.101", "1.0.41-nightly.100", true},
		{"1.0.41-nightly.100", "1.0.41-canary.100", false},
		{"1.0.41-nightly.9", "1.0.41-canary.10", false},
		{"1.0.40", "1.0.40", false},
		{"1.2.0", "1.10.0", false},
		{"latest", "1.0.0", false},
		{"1.0.1", "dev", false},
	}
	for _, testCase := range cases {
		if got := release.IsNewer(testCase.candidate, testCase.current); got != testCase.want {
			t.Errorf("IsNewer(%q, %q) = %v, want %v", testCase.candidate, testCase.current, got, testCase.want)
		}
	}
}

func TestLatestPrereleasePicksTheNewestOnItsChannel(t *testing.T) {
	serve(t, func(writer http.ResponseWriter, request *http.Request) {
		if !strings.HasSuffix(request.URL.Path, "/releases") {
			http.NotFound(writer, request)
			return
		}
		fmt.Fprint(writer, `[{"tag_name":"v1.0.41","prerelease":false},{"tag_name":"canary","prerelease":true},{"tag_name":"v1.0.41-nightly.13","prerelease":true},{"tag_name":"v1.0.41-canary.12","prerelease":true},{"tag_name":"v1.0.41-canary.11","prerelease":true}]`)
	})
	tag, version, err := release.LatestPrerelease(http.DefaultClient, "canary")
	if err != nil {
		t.Fatal(err)
	}
	if tag != "v1.0.41-canary.12" || version != "1.0.41-canary.12" {
		t.Errorf("canary: got tag %q version %q", tag, version)
	}
	tag, _, err = release.LatestPrerelease(http.DefaultClient, "nightly")
	if err != nil {
		t.Fatal(err)
	}
	if tag != "v1.0.41-nightly.13" {
		t.Errorf("nightly: got tag %q", tag)
	}
}

func TestLatestPrereleaseFailsWithoutOne(t *testing.T) {
	serve(t, func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, `[{"tag_name":"v1.0.40","prerelease":false}]`)
	})
	if _, _, err := release.LatestPrerelease(http.DefaultClient, "canary"); err == nil {
		t.Error("no canary must fail, not update to a stable release")
	}
}
