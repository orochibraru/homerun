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

func TestCanaryVersionReadsTheReleaseName(t *testing.T) {
	serve(t, func(writer http.ResponseWriter, request *http.Request) {
		if !strings.HasSuffix(request.URL.Path, "/releases/tags/canary") {
			http.NotFound(writer, request)
			return
		}
		fmt.Fprint(writer, `{"name":"Canary 1.0.41-canary.12","tag_name":"canary"}`)
	})
	version, err := release.CanaryVersion(http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}
	if version != "1.0.41-canary.12" {
		t.Errorf("got %q", version)
	}
}

func TestCanaryVersionRefusesANameWithoutAVersion(t *testing.T) {
	serve(t, func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, `{"name":"canary","tag_name":"canary"}`)
	})
	if _, err := release.CanaryVersion(http.DefaultClient); err == nil {
		t.Error("a name the version can't be read from must fail, not update to garbage")
	}
}
